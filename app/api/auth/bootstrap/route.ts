import { NextResponse } from "next/server";
import { z } from "zod";
import { isBrandRole, isWorkspaceRole, type WorkspaceRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import {
  PILOT_BRAND_ID,
  getSupabaseAdmin,
  mapPilotDistributorId,
} from "@/lib/orders/persistence";

const BootstrapSchema = z.object({
  role: z.string(),
  full_name: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const parsed = BootstrapSchema.safeParse(await request.json());
    if (!parsed.success || !isWorkspaceRole(parsed.data.role)) {
      return NextResponse.json({ error: "Invalid workspace role." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: "Sign in before assigning a workspace role." }, { status: 401 });
    }

    const admin = getSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Missing Supabase service role key." }, { status: 503 });
    }

    const role = parsed.data.role as WorkspaceRole;
    const distributorId = mapPilotDistributorId("dist-eurotrade");

    await admin.from("brands").upsert({
      id: PILOT_BRAND_ID,
      name: "Nimbus Home Goods",
      slug: "nimbus-home-goods",
    });

    await admin.from("distributors").upsert({
      id: distributorId,
      brand_id: PILOT_BRAND_ID,
      name: "EuroTrade GmbH",
      contact_email: "buyer@eurotrade.example",
      region: "DACH",
      tier: "Level A",
      level: "A",
      payment_terms: "Net 30",
      status: "Active",
      trust_score: 94,
    });

    await admin.from("profiles").upsert({
      id: user.id,
      brand_id: PILOT_BRAND_ID,
      role,
      full_name: parsed.data.full_name || user.email || "Distributor OS user",
      email: user.email || "",
    });

    if (isBrandRole(role)) {
      await admin.from("brand_memberships").upsert({
        brand_id: PILOT_BRAND_ID,
        user_id: user.id,
        role,
        status: "active",
      }, { onConflict: "brand_id,user_id" });
    } else {
      await admin.from("distributor_users").upsert({
        distributor_id: distributorId,
        user_id: user.id,
      }, { onConflict: "distributor_id,user_id" });
    }

    return NextResponse.json({
      user: { id: user.id, email: user.email },
      role,
      brandId: PILOT_BRAND_ID,
      distributorId: role === "distributor_buyer" ? distributorId : null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unable to bootstrap auth role." },
      { status: 500 }
    );
  }
}
