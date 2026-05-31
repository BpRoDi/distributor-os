import { NextResponse } from "next/server";
import { parseProductCsv } from "@/lib/catalog/products";
import { parseProductXlsx } from "@/lib/catalog/xlsx";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: ["Catalog file is required"] }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    const parsed = fileName.endsWith(".csv")
      ? parseProductCsv(await file.text())
      : fileName.endsWith(".xlsx")
        ? parseProductXlsx(Buffer.from(await file.arrayBuffer()))
        : { products: [], errors: ["Upload a CSV or XLSX product catalog"] };

    if (parsed.errors.length && !parsed.products.length) {
      return NextResponse.json({ error: parsed.errors }, { status: 400 });
    }

    return NextResponse.json({
      products: parsed.products,
      warnings: parsed.errors.slice(0, 10),
      skippedCount: parsed.errors.length,
      importedCount: parsed.products.length,
      fileName: file.name,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: [error?.message || "Unknown catalog import error"] },
      { status: 500 }
    );
  }
}
