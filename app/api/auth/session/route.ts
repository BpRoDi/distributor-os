import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/orders/persistence";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ user: null, role: null, profile: null });
    }

    const admin = getSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({
        user: { id: user.id, email: user.email },
        role: user.user_metadata?.role || null,
        profile: null,
      });
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    const { data: membership } = await admin
      .from("brand_memberships")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      user: { id: user.id, email: user.email },
      role: membership?.role || profile?.role || user.user_metadata?.role || null,
      profile,
      membership,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unable to load auth session." },
      { status: 500 }
    );
  }
}
