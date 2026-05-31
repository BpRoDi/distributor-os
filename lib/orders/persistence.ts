import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { PaymentMethod, PaymentStatus } from "../payments/status.ts";
import { polishDemoProductName, polishDemoSku } from "./product-display.ts";

export const PILOT_BRAND_ID = "00000000-0000-0000-0000-000000000001";

const distributorIds: Record<string, string> = {
  "dist-eurotrade": "00000000-0000-0000-0000-000000000101",
  "dist-bright": "00000000-0000-0000-0000-000000000102",
  "dist-asean": "00000000-0000-0000-0000-000000000103",
};

const productIds: Record<string, string> = {
  p1: "00000000-0000-0000-0000-000000000201",
  p2: "00000000-0000-0000-0000-000000000202",
  p3: "00000000-0000-0000-0000-000000000203",
  p4: "00000000-0000-0000-0000-000000000204",
};

export const SourceChannelSchema = z.enum(["WhatsApp", "Telegram", "Distributor Portal", "Email", "CSV", "PDF", "EDI"]);

export const OrderItemInputSchema = z.object({
  product_id: z.string().min(1),
  product_name: z.string().min(1),
  sku: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
  unit_price: z.coerce.number().nonnegative(),
  level_a_price: z.coerce.number().nonnegative(),
  level_b_price: z.coerce.number().nonnegative(),
  level_c_price: z.coerce.number().nonnegative(),
  moq: z.coerce.number().int().positive(),
  stock_snapshot: z.coerce.number().int().nonnegative(),
  confidence: z.coerce.number().int().min(0).max(100),
});

export const OrderCreateSchema = z.object({
  brand_id: z.string().min(1).optional(),
  brand_name: z.string().min(1).optional(),
  distributor_id: z.string().min(1),
  distributor_name: z.string().min(1),
  distributor_level: z.enum(["A", "B", "C"]),
  source_channel: SourceChannelSchema,
  original_message: z.string().min(1),
  total_value: z.coerce.number().nonnegative(),
  items: z.array(OrderItemInputSchema).min(1),
});

export type OrderCreateInput = z.infer<typeof OrderCreateSchema>;

export function getSupabaseAdmin() {
  if (typeof window !== "undefined") {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY can only be used from server-side code.");
  }

  const supabaseUrl = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

export function normalizeSupabaseUrl(url: string | undefined) {
  return url?.replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
}

export function mapPilotDistributorId(id: string) {
  return distributorIds[id] || id;
}

export function mapPilotProductId(id: string) {
  return productIds[id] || id;
}

export function createShareToken() {
  return `ORD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function createSourceRecord(
  supabase: SupabaseClient,
  input: {
    brandId: string;
    distributorId: string;
    channel: z.infer<typeof SourceChannelSchema>;
    originalBody: string;
    metadata?: Record<string, unknown>;
  }
) {
  const { data, error } = await supabase
    .from("source_records")
    .insert({
      brand_id: input.brandId,
      distributor_id: input.distributorId,
      channel: input.channel,
      original_body: input.originalBody,
      normalized_body: normalizeSourceBody(input.originalBody),
      metadata: input.metadata || {},
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function attachSourceRecordToOrder(
  supabase: SupabaseClient,
  input: { sourceRecordId: string; orderId: string }
) {
  const { error } = await supabase
    .from("source_records")
    .update({ order_id: input.orderId })
    .eq("id", input.sourceRecordId);

  if (error) throw error;
}

export async function recordAiOrderParse(
  supabase: SupabaseClient,
  input: {
    brandId: string;
    sourceRecordId: string;
    orderId: string;
    items: Array<z.infer<typeof OrderItemInputSchema>>;
    parserVersion?: string;
  }
) {
  const averageConfidence = input.items.length
    ? Math.round(input.items.reduce((total, item) => total + item.confidence, 0) / input.items.length)
    : 0;
  const issues = input.items
    .filter((item) => item.quantity < item.moq || item.quantity > item.stock_snapshot)
    .map((item) => ({
      sku: item.sku,
      issue: item.quantity < item.moq ? "below_moq" : "over_stock",
      quantity: item.quantity,
      moq: item.moq,
      stock_snapshot: item.stock_snapshot,
    }));

  const { error } = await supabase.from("ai_order_parses").insert({
    brand_id: input.brandId,
    source_record_id: input.sourceRecordId,
    order_id: input.orderId,
    parser_version: input.parserVersion || "rules-v1",
    confidence: averageConfidence,
    extracted_items: input.items.map((item) => ({
      product_id: mapPilotProductId(item.product_id),
      product_name: polishDemoProductName(item.product_name),
      sku: polishDemoSku(item.sku, item.product_name),
      quantity: item.quantity,
      unit_price: item.unit_price,
      confidence: item.confidence,
    })),
    issues,
  });

  if (error) throw error;
}

export async function recordPaymentRequest(
  supabase: SupabaseClient,
  input: {
    order: ReturnType<typeof normalizeOrder>;
    status: "requested" | "partial" | "paid" | "cancelled";
    rail: PaymentMethod;
    dueDate?: string | null;
    requestUrl?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const { error } = await supabase.from("payment_requests").insert({
    brand_id: input.order.brandId,
    distributor_id: mapPilotDistributorId(input.order.distributorId),
    order_id: input.order.id,
    amount: input.order.outstandingAmount,
    currency: "USD",
    rail: mapPaymentMethodToRail(input.rail),
    status: input.status,
    due_date: input.dueDate || null,
    request_url: input.requestUrl || null,
    paid_at: input.status === "paid" ? new Date().toISOString() : null,
    metadata: input.metadata || {},
  });

  if (error) throw error;
}

export async function ensurePilotRows(
  supabase: SupabaseClient,
  input: OrderCreateInput
) {
  const brandId = input.brand_id || PILOT_BRAND_ID;
  await supabase.from("brands").upsert({
    id: brandId,
    name: input.brand_name || "Nimbus Home Goods",
    slug: (input.brand_name || "Nimbus Home Goods").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
  });

  const distributorId = mapPilotDistributorId(input.distributor_id);
  await supabase.from("distributors").upsert({
    id: distributorId,
    brand_id: brandId,
    name: input.distributor_name,
    contact_email: `${input.distributor_name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.com`,
    region: "Pilot",
    tier: `Level ${input.distributor_level}`,
    level: input.distributor_level,
    payment_terms: "Net 30",
    status: "Active",
    trust_score: input.distributor_level === "A" ? 94 : input.distributor_level === "B" ? 81 : 67,
  });

  await Promise.all(
    input.items.map((item) =>
      supabase.from("products").upsert({
        id: mapPilotProductId(item.product_id),
        brand_id: brandId,
        name: item.product_name,
        sku: item.sku,
        category: "Pilot Catalog",
        moq: item.moq,
        wholesale_price: item.level_a_price,
        default_distributor_price: item.level_b_price,
        level_a_price: item.level_a_price,
        level_b_price: item.level_b_price,
        level_c_price: item.level_c_price,
        stock: item.stock_snapshot,
        status: item.stock_snapshot > 0 ? "Available" : "Out of Stock",
      })
    )
  );

  return { brandId, distributorId };
}

export async function getOrderByToken(supabase: SupabaseClient, token: string) {
  const { data: orders, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("share_token", token)
    .order("created_at", { ascending: false })
    .limit(1);

  if (orderError) throw orderError;

  const order = orders?.[0];
  if (!order) {
    const missingOrderError = new Error("Order link not found.") as Error & { code?: string };
    missingOrderError.code = "PGRST116";
    throw missingOrderError;
  }

  const [
    { data: items, error: itemsError },
    { data: events, error: eventsError },
    { data: brands, error: brandError },
  ] =
    await Promise.all([
      supabase.from("order_items").select("*").eq("order_id", order.id).order("sku"),
      supabase.from("order_events").select("*").eq("order_id", order.id).order("created_at", { ascending: true }),
      supabase.from("brands").select("name").eq("id", order.brand_id).limit(1),
    ]);

  if (itemsError) throw itemsError;
  if (eventsError) throw eventsError;
  if (brandError) throw brandError;

  return normalizeOrder({ ...order, brand_name: brands?.[0]?.name }, items || [], events || []);
}

export function normalizeOrder(order: any, items: any[], events: any[]) {
  return {
    id: order.id,
    orderNumber: order.order_number,
    orderId: order.order_number,
    brandId: order.brand_id,
    brandName: order.brand_name || "Nimbus Home Goods",
    distributorId: order.distributor_id,
    distributorName: order.distributor_name,
    distributorLevel: order.distributor_level,
    sourceChannel: order.source_channel,
    sourceRecordId: order.source_record_id || null,
    originalMessage: order.original_message,
    status: order.status,
    shareToken: order.share_token,
    token: order.share_token,
    totalValue: Number(order.total_value ?? order.amount ?? 0),
    paymentStatus: normalizePaymentStatus(order.payment_status),
    paymentMethod: order.payment_method || "offline",
    paymentDueDate: order.payment_due_date || null,
    amountPaid: Number(order.amount_paid ?? 0),
    outstandingAmount: Number(order.outstanding_amount ?? order.total_value ?? order.amount ?? 0),
    externalOrderId: order.external_order_id || null,
    buyerReference: order.buyer_reference || null,
    createdAt: order.created_at,
    items: items.map((item) => ({
      id: item.id,
      productId: item.product_id,
      productName: polishDemoProductName(item.product_name),
      name: polishDemoProductName(item.product_name),
      sku: polishDemoSku(item.sku, item.product_name),
      quantity: Number(item.quantity),
      qty: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      levelAPrice: Number(item.level_a_price),
      levelBPrice: Number(item.level_b_price),
      levelCPrice: Number(item.level_c_price),
      moq: Number(item.moq),
      stockSnapshot: Number(item.stock_snapshot),
      stock: Number(item.stock_snapshot),
      confidence: Number(item.confidence),
      lineTotal: Number(item.line_total),
    })),
    events: events.map((event) => ({
      id: event.id,
      eventType: event.event_type,
      label: event.label,
      details: event.details || {},
      createdAt: event.created_at,
    })),
  };
}

function normalizeSourceBody(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function mapPaymentMethodToRail(method: PaymentMethod) {
  if (method === "ach") return "ach";
  if (method === "wire") return "wire";
  if (method === "card" || method === "apple_pay") return "card";
  if (method === "stablecoin_usdc") return "stablecoin_usdc";
  if (method === "offline") return "offline";
  return "bank_transfer";
}

function normalizePaymentStatus(status: string | null | undefined): PaymentStatus {
  const map: Record<string, PaymentStatus> = {
    Pending: "unpaid",
    Unpaid: "unpaid",
    Requested: "requested",
    Paid: "paid",
    Partial: "partial",
    Overdue: "overdue",
    unpaid: "unpaid",
    requested: "requested",
    paid: "paid",
    partial: "partial",
    overdue: "overdue",
  };
  return status ? map[status] || "unpaid" : "unpaid";
}
