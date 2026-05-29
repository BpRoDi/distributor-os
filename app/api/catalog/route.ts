import { NextResponse } from "next/server";
import {
  normalizeCatalogProduct,
  validateCatalogProduct,
  type CatalogProduct,
  type CatalogProductInput,
} from "@/lib/catalog/products";
import { PILOT_BRAND_ID, getSupabaseAdmin } from "@/lib/orders/persistence";

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 503 }
      );
    }

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("brand_id", PILOT_BRAND_ID)
      .order("sku");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      products: (data || []).map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        requestedName: product.name,
        category: product.category || "General",
        moq: Number(product.moq || 1),
        stock: Number(product.stock || 0),
        distributor_price: Number(product.level_b_price || product.default_distributor_price || 0),
        levelPrices: {
          A: Number(product.level_a_price || 0),
          B: Number(product.level_b_price || product.default_distributor_price || 0),
          C: Number(product.level_c_price || 0),
        },
        status: Number(product.stock || 0) <= 0 ? "Out of Stock" : Number(product.stock || 0) < 500 ? "Low Stock" : "Available",
        aliases: product.aliases || [],
        lead_time: product.lead_time || "To be confirmed",
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unknown catalog API error." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const inputs: CatalogProductInput[] = Array.isArray(body.products)
      ? body.products
      : body.product
        ? [body.product]
        : [];
    const products: CatalogProduct[] = inputs.map((input) => normalizeCatalogProduct(input));
    const errors = products.flatMap((product: CatalogProduct, index: number) =>
      validateCatalogProduct(product).map((error) => `Product ${index + 1}: ${error}`)
    );

    if (!products.length) return NextResponse.json({ error: ["At least one product is required"] }, { status: 400 });
    if (errors.length) return NextResponse.json({ error: errors }, { status: 400 });

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 503 }
      );
    }

    await supabase.from("brands").upsert({
      id: PILOT_BRAND_ID,
      name: "Nimbus Home Goods",
      slug: "nimbus-home-goods",
    });

    const { error } = await supabase.from("products").upsert(
      products.map((product: CatalogProduct) => ({
        brand_id: PILOT_BRAND_ID,
        sku: product.sku,
        name: product.name,
        category: product.category,
        moq: product.moq,
        stock: product.stock,
        wholesale_price: product.levelPrices.A,
        default_distributor_price: product.levelPrices.B,
        level_a_price: product.levelPrices.A,
        level_b_price: product.levelPrices.B,
        level_c_price: product.levelPrices.C,
        aliases: product.aliases,
        lead_time: product.lead_time,
        status: product.status,
      })),
      { onConflict: "brand_id,sku" }
    );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ products });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unknown catalog save error." },
      { status: 500 }
    );
  }
}
