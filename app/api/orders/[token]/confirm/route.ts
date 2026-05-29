import { NextResponse } from "next/server";
import { getOrderByToken, getSupabaseAdmin } from "@/lib/orders/persistence";

export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 503 }
      );
    }

    const existing = await getOrderByToken(supabase, token);

    const { error: updateError } = await supabase
      .from("orders")
      .update({ status: "distributor_confirmed" })
      .eq("id", existing.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    if (existing.status !== "distributor_confirmed") {
      const { error: eventError } = await supabase.from("order_events").insert({
        order_id: existing.id,
        event_type: "distributor_confirmed",
        label: "Distributor confirmed",
        details: { share_token: token },
      });

      if (eventError) {
        return NextResponse.json({ error: eventError.message }, { status: 500 });
      }
    }

    const order = await getOrderByToken(supabase, token);
    return NextResponse.json({ order });
  } catch (error: any) {
    const status = error?.code === "PGRST116" ? 404 : 500;
    return NextResponse.json(
      { error: error?.message || "Unknown order confirmation error." },
      { status }
    );
  }
}
