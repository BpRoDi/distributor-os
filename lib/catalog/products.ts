export type CatalogProduct = {
  id: string;
  sku: string;
  name: string;
  requestedName: string;
  category: string;
  moq: number;
  stock: number;
  distributor_price: number;
  levelPrices: { A: number; B: number; C: number };
  status: "Available" | "Low Stock" | "Out of Stock";
  aliases: string[];
  lead_time: string;
};

type DemoProductShape = Omit<CatalogProduct, "lead_time" | "status"> & {
  status: string;
  lead_time?: string;
};

export type CatalogProductInput = {
  id?: string;
  sku?: string;
  name?: string;
  category?: string;
  moq?: number | string;
  stock?: number | string;
  level_a_price?: number | string;
  level_b_price?: number | string;
  level_c_price?: number | string;
  aliases?: string[] | string;
  lead_time?: string;
};

const catalogHeaderAliases: Record<keyof Omit<CatalogProductInput, "id">, string[]> = {
  sku: ["sku", "barcode", "bar code", "product code", "\u5546\u54c1\u7f16\u7801", "\u5546\u54c1\u6761\u7801", "\u8d27\u53f7", "\u6b3e\u53f7"],
  name: ["name", "product name", "product_name", "\u5546\u54c1\u540d\u79f0", "\u5546\u54c1\u540d", "\u54c1\u540d", "\u540d\u79f0"],
  category: ["category", "\u5927\u7c7b", "\u5206\u7c7b", "\u54c1\u7c7b", "\u7c7b\u76ee"],
  moq: ["moq", "minimum order quantity", "minimum_order_quantity", "\u8d77\u8ba2\u91cf", "\u6700\u5c0f\u8d77\u8ba2\u91cf"],
  stock: ["stock", "inventory", "available stock", "\u5e93\u5b58", "\u5e93\u5b58\u91cf", "\u53ef\u7528\u5e93\u5b58"],
  level_a_price: ["level_a_price", "level a price", "levela", "a price", "a\u4ef7", "\u7b49\u7ea7a\u4ef7\u683c"],
  level_b_price: ["level_b_price", "level b price", "levelb", "b price", "b\u4ef7", "\u7b49\u7ea7b\u4ef7\u683c"],
  level_c_price: ["level_c_price", "level c price", "levelc", "c price", "c\u4ef7", "\u7b49\u7ea7c\u4ef7\u683c"],
  aliases: ["aliases", "alias", "keywords", "\u5546\u54c1\u7b80\u79f0", "\u7b80\u79f0", "\u522b\u540d", "\u5173\u952e\u8bcd"],
  lead_time: ["lead_time", "lead time", "delivery lead time", "delivery", "\u4ea4\u671f", "\u8d27\u671f", "\u53d1\u8d27\u5468\u671f"],
};

export function fromDemoProduct(product: DemoProductShape): CatalogProduct {
  return {
    ...product,
    status: getStockStatus(product.stock),
    lead_time: product.lead_time || "Next week",
  };
}

export function getStockStatus(stock: number): CatalogProduct["status"] {
  if (stock <= 0) return "Out of Stock";
  if (stock < 500) return "Low Stock";
  return "Available";
}

export function normalizeCatalogProduct(input: CatalogProductInput): CatalogProduct {
  const normalizedInput = input as CatalogProductInput & {
    distributor_price?: number;
    levelPrices?: { A: number; B: number; C: number };
    requestedName?: string;
  };
  const sku = cleanCell(input.sku);
  const name = cleanCell(input.name);
  const moq = Number(input.moq || 0);
  const stock = Number(input.stock || 0);
  const levelAPrice = Number(input.level_a_price ?? normalizedInput.levelPrices?.A ?? 0);
  const levelBPrice = Number(input.level_b_price ?? normalizedInput.levelPrices?.B ?? 0);
  const levelCPrice = Number(input.level_c_price ?? normalizedInput.levelPrices?.C ?? 0);
  const aliases = Array.isArray(input.aliases)
    ? input.aliases.map(cleanCell).filter(Boolean)
    : splitAliasText(cleanCell(input.aliases));

  return {
    id: input.id || `prod-${sku || Date.now()}`,
    sku,
    name,
    requestedName: normalizedInput.requestedName || name,
    category: cleanCell(input.category) || "General",
    moq,
    stock,
    distributor_price: Number(normalizedInput.distributor_price ?? levelBPrice),
    levelPrices: {
      A: levelAPrice,
      B: levelBPrice,
      C: levelCPrice,
    },
    status: getStockStatus(stock),
    aliases: aliases.length ? uniqueList(aliases) : [sku, name].filter(Boolean),
    lead_time: cleanCell(input.lead_time) || "To be confirmed",
  };
}

export function validateCatalogProduct(input: CatalogProductInput | CatalogProduct) {
  const product = normalizeCatalogProduct(input);
  const errors: string[] = [];

  if (!product.sku) errors.push("SKU is required");
  if (!product.name) errors.push("Product name is required");
  if (!Number.isFinite(product.moq) || product.moq <= 0) errors.push("MOQ must be positive");
  if (!Number.isFinite(product.stock) || product.stock < 0) errors.push("Stock cannot be negative");
  if (product.levelPrices.A > product.levelPrices.B) {
    errors.push("Level A price should be less than or equal to Level B price");
  }
  if (product.levelPrices.B > product.levelPrices.C) {
    errors.push("Level B price should be less than or equal to Level C price");
  }

  return errors;
}

export function parseProductCsv(csv: string) {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return { products: [] as CatalogProduct[], errors: ["CSV is empty"] };

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => parseCsvLine(line));
  return parseProductRows([headers, ...rows]);
}

export function parseProductRows(rows: Array<Array<string | number | boolean | null | undefined>>) {
  const cleanRows = rows.filter((row) => row.some((value) => cleanCell(value)));
  if (!cleanRows.length) return { products: [] as CatalogProduct[], errors: ["Catalog file is empty"] };

  const headers = cleanRows[0].map((header) => cleanCell(header));
  const products: CatalogProduct[] = [];
  const errors: string[] = [];

  cleanRows.slice(1).forEach((values, index) => {
    const raw: Record<string, string> = {};
    headers.forEach((header, headerIndex) => {
      raw[header] = cleanCell(values[headerIndex]);
    });

    const product = normalizeCatalogProduct(mapCatalogImportRow(raw));
    const rowErrors = validateCatalogProduct(product);
    if (rowErrors.length) {
      errors.push(`Row ${index + 2}: ${rowErrors.join("; ")}`);
      return;
    }
    products.push(product);
  });

  return { products, errors };
}

export function mapCatalogImportRow(raw: Record<string, string>): CatalogProductInput {
  const indexed = indexRowByNormalizedHeader(raw);
  const valueFor = (field: keyof Omit<CatalogProductInput, "id">) =>
    pickMappedValue(indexed, catalogHeaderAliases[field]);
  const sku = valueFor("sku");
  const name = valueFor("name");
  const category = valueFor("category");
  const aliases = uniqueList([
    valueFor("aliases"),
    raw["\u5546\u54c1\u7f16\u7801"],
    raw["\u5546\u54c1\u7b80\u79f0"],
    raw["\u989c\u8272"],
    raw["\u5c3a\u7801"],
    sku,
    name,
  ]);

  return {
    sku,
    name,
    category: category || "General",
    moq: valueFor("moq") || "1",
    stock: valueFor("stock") || "0",
    level_a_price: valueFor("level_a_price") || "0",
    level_b_price: valueFor("level_b_price") || "0",
    level_c_price: valueFor("level_c_price") || "0",
    aliases: aliases.join(", "),
    lead_time: valueFor("lead_time") || "To be confirmed",
  };
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function indexRowByNormalizedHeader(raw: Record<string, string>) {
  return Object.entries(raw).reduce<Record<string, string>>((acc, [header, value]) => {
    acc[normalizeHeader(header)] = cleanCell(value);
    return acc;
  }, {});
}

function pickMappedValue(indexed: Record<string, string>, aliases: string[]) {
  for (const alias of aliases) {
    const value = indexed[normalizeHeader(alias)];
    if (value) return value;
  }
  return "";
}

function normalizeHeader(value: string) {
  return cleanCell(value)
    .toLowerCase()
    .replace(/[\s_\-./()\uFF08\uFF09:\uFF1A]+/g, "");
}

function cleanCell(value: unknown) {
  return String(value ?? "").replace(/\t/g, "").trim();
}

function splitAliasText(value: string) {
  return value
    .split(/[|,\uFF0C\u3001/]/)
    .map((alias) => alias.trim())
    .filter(Boolean);
}

function uniqueList(values: string[]) {
  const seen = new Set<string>();
  return values
    .flatMap((value) => splitAliasText(cleanCell(value)))
    .filter((value) => {
      const key = value.toLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
