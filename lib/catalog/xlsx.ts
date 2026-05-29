import { inflateRawSync } from "node:zlib";
import { parseProductRows } from "./products.ts";

type ZipEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
};

export function parseProductXlsx(buffer: Buffer) {
  const files = readZipFiles(buffer);
  const sharedStrings = parseSharedStrings(files.get("xl/sharedStrings.xml") || "");
  const worksheetXml = getFirstWorksheetXml(files);
  if (!worksheetXml) {
    return { products: [], errors: ["XLSX file does not contain a worksheet"] };
  }

  const rows = parseWorksheetRows(worksheetXml, sharedStrings);
  return parseProductRows(rows);
}

function readZipFiles(buffer: Buffer) {
  const files = new Map<string, string>();
  for (const entry of readCentralDirectory(buffer)) {
    const data = readEntryData(buffer, entry);
    files.set(entry.name.replace(/\\/g, "/"), data.toString("utf8"));
  }
  return files;
}

function readCentralDirectory(buffer: Buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
    entries.push({ name, compressionMethod, compressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Invalid XLSX file");
}

function readEntryData(buffer: Buffer, entry: ZipEntry) {
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error(`Invalid XLSX entry ${entry.name}`);
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(start, start + entry.compressedSize);

  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported XLSX compression method ${entry.compressionMethod}`);
}

function getFirstWorksheetXml(files: Map<string, string>) {
  const workbookXml = files.get("xl/workbook.xml");
  const relsXml = files.get("xl/_rels/workbook.xml.rels");
  if (workbookXml && relsXml) {
    const firstSheet = workbookXml.match(/<sheet\b[^>]*r:id="([^"]+)"[^>]*>/);
    const relationshipId = firstSheet?.[1];
    if (relationshipId) {
      const relPattern = new RegExp(`<Relationship\\b[^>]*Id="${escapeRegExp(relationshipId)}"[^>]*Target="([^"]+)"[^>]*/?>`);
      const target = relsXml.match(relPattern)?.[1];
      if (target) {
        const normalized = target.startsWith("/")
          ? target.slice(1)
          : `xl/${target}`.replace(/\/[^/]+\/\.\.\//g, "/");
        const xml = files.get(normalized);
        if (xml) return xml;
      }
    }
  }

  const worksheetName = Array.from(files.keys())
    .filter((name) => name.startsWith("xl/worksheets/") && name.endsWith(".xml"))
    .sort()[0];
  return worksheetName ? files.get(worksheetName) : "";
}

function parseSharedStrings(xml: string) {
  if (!xml) return [];
  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)).map((match) =>
    Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
      .map((textMatch) => decodeXml(textMatch[1]))
      .join("")
  );
}

function parseWorksheetRows(xml: string, sharedStrings: string[]) {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const reference = attrs.match(/\br="([A-Z]+)\d+"/)?.[1] || "";
      const columnIndex = reference ? columnNameToIndex(reference) : cells.length;
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] || "";
      cells[columnIndex] = readCellValue(body, type, sharedStrings);
    }
    rows.push(cells);
  }
  return rows;
}

function readCellValue(body: string, type: string, sharedStrings: string[]) {
  if (type === "inlineStr") {
    return decodeXml(Array.from(body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((match) => match[1]).join(""));
  }

  const rawValue = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "";
  if (type === "s") return sharedStrings[Number(rawValue)] || "";
  return decodeXml(rawValue);
}

function columnNameToIndex(column: string) {
  return column.split("").reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
