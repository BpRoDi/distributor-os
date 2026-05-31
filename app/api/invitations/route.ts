import { NextResponse } from "next/server";
import { z } from "zod";
import { sendInviteEmail } from "@/lib/email/resend";
import { mapPilotDistributorId, getSupabaseAdmin } from "@/lib/orders/persistence";
import {
  DEFAULT_BRAND_NAME,
  DEFAULT_BRAND_WORKSPACE_ID,
  createDistributorInvite,
  slugifyBrandName,
  type DistributorLevel,
} from "@/lib/workspace/tenant";

const InviteSchema = z.object({
  email: z.string().email(),
  brandId: z.string().min(1).optional(),
  brandName: z.string().min(1).default(DEFAULT_BRAND_NAME),
  distributorId: z.string().min(1),
  distributorName: z.string().min(1),
  distributorLevel: z.enum(["A", "B", "C"]).default("B"),
  region: z.string().optional(),
  paymentTerms: z.string().optional(),
  token: z.string().min(8).optional(),
});

export async function POST(request: Request) {
  try {
    const parsed = InviteSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const body = parsed.data;
    const brandId = body.brandId || DEFAULT_BRAND_WORKSPACE_ID;
    const distributorId = mapPilotDistributorId(body.distributorId);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const invitation = createDistributorInvite({
      brandId,
      brandName: body.brandName,
      distributorId,
      distributorName: body.distributorName,
      distributorLevel: body.distributorLevel as DistributorLevel,
      email: body.email,
      appUrl,
      tokenFactory: body.token ? () => body.token as string : undefined,
    });

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables.", invitation },
        { status: 503 }
      );
    }

    await supabase.from("brands").upsert({
      id: brandId,
      name: body.brandName,
      slug: slugifyBrandName(body.brandName),
    });

    const { error: distributorError } = await supabase.from("distributors").upsert({
      id: distributorId,
      brand_id: brandId,
      name: body.distributorName,
      contact_email: body.email,
      region: body.region || "Pilot",
      tier: `Level ${body.distributorLevel}`,
      level: body.distributorLevel,
      payment_terms: body.paymentTerms || "Net 30",
      status: "Invited",
      trust_score: body.distributorLevel === "A" ? 90 : body.distributorLevel === "B" ? 75 : 60,
    });

    if (distributorError) {
      return NextResponse.json({ error: distributorError.message }, { status: 500 });
    }

    const { error: inviteError } = await supabase.from("invitations").upsert(
      {
        brand_id: brandId,
        distributor_id: distributorId,
        email: body.email,
        token: invitation.token,
        expires_at: invitation.expiresAt,
      },
      { onConflict: "token" }
    );

    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 500 });
    }

    await supabase.from("activity_logs").insert({
      brand_id: brandId,
      action: "distributor_invited",
      entity_type: "invitation",
      entity_id: null,
      metadata: {
        distributor_id: distributorId,
        distributor_name: body.distributorName,
        email: body.email,
        level: body.distributorLevel,
      },
    });

    const result = await sendInviteEmail({
      to: body.email,
      brandName: body.brandName,
      inviteUrl: invitation.inviteUrl,
    });

    return NextResponse.json({ ok: true, invitation, result });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unknown invitation create error." },
      { status: 500 }
    );
  }
}
