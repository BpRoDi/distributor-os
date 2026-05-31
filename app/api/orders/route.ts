import { NextResponse } from "next/server";
import {
  OrderCreateSchema,
  attachSourceRecordToOrder,
  createSourceRecord,
  createShareToken,
  ensurePilotRows,
  getOrderByToken,
  getSupabaseAdmin,
  listOrders,
  mapPilotProductId,
  recordAiOrderParse,
} from "@/lib/orders/persistence";
import { polishDemoProductName, polishDemoSku } from "@/lib/orders/product-display";

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 503 }
      );
    }

    const url = new URL(request.url);
    const orders = await listOrders(supabase, {
      brandId: url.searchParams.get("brand_id"),
      distributorId: url.searchParams.get("distributor_id"),
      limit: Number(url.searchParams.get("limit") || 100),
    });

    return NextResponse.json({ orders });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unknown order list error." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const parsed = OrderCreateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 503 }
      );
    }

    const input = parsed.data;
    const { brandId, distributorId } = await ensurePilotRows(supabase, input);
    const orderStatus = input.order_status || (input.source_channel === "Distributor Portal" ? "po_requested" : "link_created");
    const sourceRecord = await createSourceRecord(supabase, {
      brandId,
      distributorId,
      channel: input.source_channel,
      originalBody: input.original_message,
      metadata: {
        distributor_name: input.distributor_name,
        distributor_level: input.distributor_level,
        item_count: input.items.length,
      },
    });
    const shareToken = createShareToken();
    const orderNumber = `DO-${shareToken.slice(-4)}`;

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        brand_id: brandId,
        distributor_id: distributorId,
        distributor_name: input.distributor_name,
        distributor_level: input.distributor_level,
        source_channel: input.source_channel,
        source_record_id: sourceRecord.id,
        original_message: input.original_message,
        status: orderStatus,
        share_token: shareToken,
        total_value: input.total_value,
        amount: input.total_value,
        order_number: orderNumber,
        payment_status: "unpaid",
        payment_method: "offline",
        amount_paid: 0,
        outstanding_amount: input.total_value,
      })
      .select("*")
      .single();

    if (orderError) {
      return NextResponse.json({ error: orderError.message }, { status: 500 });
    }

    await attachSourceRecordToOrder(supabase, { sourceRecordId: sourceRecord.id, orderId: order.id });

    const orderItems = input.items.map((item) => ({
      order_id: order.id,
      product_id: mapPilotProductId(item.product_id),
      product_name: polishDemoProductName(item.product_name),
      sku: polishDemoSku(item.sku, item.product_name),
      quantity: item.quantity,
      unit_price: item.unit_price,
      level_a_price: item.level_a_price,
      level_b_price: item.level_b_price,
      level_c_price: item.level_c_price,
      moq: item.moq,
      stock_snapshot: item.stock_snapshot,
      confidence: item.confidence,
      line_total: item.quantity * item.unit_price,
    }));

    const { error: itemsError } = await supabase.from("order_items").insert(orderItems);
    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    await recordAiOrderParse(supabase, {
      brandId,
      sourceRecordId: sourceRecord.id,
      orderId: order.id,
      items: input.items,
    });

    const eventDetails = { source_channel: input.source_channel, source_record_id: sourceRecord.id, distributor_name: input.distributor_name };
    const orderEvents = orderStatus === "po_requested"
      ? [
          { order_id: order.id, event_type: "portal_po_submitted", label: "Portal PO submitted", details: eventDetails },
        ]
      : [
          { order_id: order.id, event_type: "message_pasted", label: "Message pasted", details: eventDetails },
          { order_id: order.id, event_type: "draft_generated", label: "Draft generated", details: { item_count: input.items.length } },
          { order_id: order.id, event_type: "brand_approved", label: "Brand approved", details: { total_value: input.total_value } },
          { order_id: order.id, event_type: "link_created", label: "Link created", details: { share_token: shareToken } },
        ];
    const { error: eventsError } = await supabase.from("order_events").insert(orderEvents);

    if (eventsError) {
      return NextResponse.json({ error: eventsError.message }, { status: 500 });
    }

    const savedOrder = await getOrderByToken(supabase, shareToken);
    return NextResponse.json({ order: savedOrder }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unknown order create error." },
      { status: 500 }
    );
  }
}
