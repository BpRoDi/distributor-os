import { NextResponse } from "next/server";
import { getOrderByToken, getSupabaseAdmin } from "@/lib/orders/persistence";

export async function GET(
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

    const order = await getOrderByToken(supabase, token);
    return NextResponse.json({ order });
  } catch (error: any) {
    const status = error?.code === "PGRST116" ? 404 : 500;
    return NextResponse.json(
      { error: error?.message || "Unknown order lookup error." },
      { status }
    );
  }
}
