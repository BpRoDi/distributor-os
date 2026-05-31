import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/lib/supabase/url";

const BRAND_ID = "00000000-0000-0000-0000-000000000001";
const DISTRIBUTOR_ID = "00000000-0000-0000-0000-000000000101";

function getSupabaseAdmin() {
  const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

function stockStatus(available: number) {
  if (available <= 0) return "Out of Stock";
  if (available < 500) return "Low Stock";
  return "Available";
}

function mapProduct(product: any, priceList: any, inventory: any) {
  const stock = Number(inventory?.available ?? 0);
  const reserved = Number(inventory?.reserved ?? 0);

  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    category: product.category,
    moq: Number(priceList?.moq ?? product.moq ?? 1),
    wholesalePrice: Number(product.wholesale_price ?? 0),
    distributorPrice: Number(priceList?.price ?? product.wholesale_price ?? 0),
    stock,
    reserved,
    status: stockStatus(stock),
    gradient: "from-blue-100 via-sky-50 to-slate-100",
  };
}

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 503 }
      );
    }

    const { data: products, error: productsError } = await supabaseAdmin
      .from("products")
      .select("*")
      .eq("brand_id", BRAND_ID)
      .order("created_at", { ascending: false });

    if (productsError) {
      return NextResponse.json({ error: productsError.message }, { status: 500 });
    }

    const productIds = (products ?? []).map((p) => p.id);

    if (productIds.length === 0) {
      return NextResponse.json({ products: [] });
    }

    const { data: priceLists, error: priceListsError } = await supabaseAdmin
      .from("price_lists")
      .select("*")
      .eq("brand_id", BRAND_ID)
      .eq("distributor_id", DISTRIBUTOR_ID)
      .in("product_id", productIds);

    if (priceListsError) {
      return NextResponse.json({ error: priceListsError.message }, { status: 500 });
    }

    const { data: inventoryRows, error: inventoryError } = await supabaseAdmin
      .from("inventory")
      .select("*")
      .eq("brand_id", BRAND_ID)
      .in("product_id", productIds);

    if (inventoryError) {
      return NextResponse.json({ error: inventoryError.message }, { status: 500 });
    }

    const productsForFrontend = (products ?? []).map((product) => {
      const priceList = (priceLists ?? []).find((p) => p.product_id === product.id);
      const inventory = (inventoryRows ?? []).find((i) => i.product_id === product.id);

      return mapProduct(product, priceList, inventory);
    });

    return NextResponse.json({
      products: productsForFrontend,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unknown products API error." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const stock = Number(body.stock || 0);

    const productPayload = {
      brand_id: BRAND_ID,
      name: body.name || "New Product",
      sku: body.sku || `SKU-${Date.now().toString().slice(-4)}`,
      category: body.category || "General",
      moq: Number(body.moq || 10),
      wholesale_price: Number(body.wholesalePrice || 10),
      status: "active",
    };

    const { data: product, error: productError } = await supabaseAdmin
      .from("products")
      .insert(productPayload)
      .select("*")
      .single();

    if (productError) {
      return NextResponse.json({ error: productError.message }, { status: 500 });
    }

    const { data: priceList, error: priceError } = await supabaseAdmin
      .from("price_lists")
      .insert({
        brand_id: BRAND_ID,
        distributor_id: DISTRIBUTOR_ID,
        product_id: product.id,
        price: Number(body.distributorPrice || body.wholesalePrice || 10),
        moq: Number(body.moq || 10),
      })
      .select("*")
      .single();

    if (priceError) {
      return NextResponse.json({ error: priceError.message }, { status: 500 });
    }

    const { data: inventory, error: inventoryError } = await supabaseAdmin
      .from("inventory")
      .insert({
        brand_id: BRAND_ID,
        product_id: product.id,
        available: stock,
        reserved: 0,
        safety_stock: 100,
      })
      .select("*")
      .single();

    if (inventoryError) {
      return NextResponse.json({ error: inventoryError.message }, { status: 500 });
    }

    return NextResponse.json({
      product: mapProduct(product, priceList, inventory),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unknown product create error." },
      { status: 500 }
    );
  }
}
