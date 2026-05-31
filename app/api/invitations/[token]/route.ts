import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/orders/persistence";
import {
  DEFAULT_BRAND_NAME,
  acceptDistributorInvite,
  getInviteStatus,
  type DistributorInvite,
  type DistributorLevel,
} from "@/lib/workspace/tenant";

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

    const invitation = await loadInvitationByToken(supabase, token);
    if (!invitation) {
      return NextResponse.json({ error: "Invalid invitation token." }, { status: 404 });
    }

    return NextResponse.json({ invitation });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unknown invitation lookup error." },
      { status: 500 }
    );
  }
}

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

    const invitation = await loadInvitationByToken(supabase, token);
    if (!invitation) {
      return NextResponse.json({ error: "Invalid invitation token." }, { status: 404 });
    }

    const accepted = acceptDistributorInvite(invitation);
    if (accepted.status === "expired") {
      return NextResponse.json({ error: "Invitation expired.", invitation: accepted }, { status: 410 });
    }

    const { error: inviteError } = await supabase
      .from("invitations")
      .update({ accepted_at: accepted.acceptedAt })
      .eq("token", token);

    if (inviteError) return NextResponse.json({ error: inviteError.message }, { status: 500 });

    const { error: distributorError } = await supabase
      .from("distributors")
      .update({ status: "Active", level: accepted.distributorLevel, tier: `Level ${accepted.distributorLevel}` })
      .eq("id", accepted.distributorId);

    if (distributorError) return NextResponse.json({ error: distributorError.message }, { status: 500 });

    await supabase.from("activity_logs").insert({
      brand_id: accepted.brandId,
      action: "distributor_invite_accepted",
      entity_type: "distributor",
      entity_id: accepted.distributorId,
      metadata: {
        token,
        distributor_name: accepted.distributorName,
        email: accepted.email,
      },
    });

    return NextResponse.json({ invitation: accepted });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unknown invitation accept error." },
      { status: 500 }
    );
  }
}

async function loadInvitationByToken(supabase: ReturnType<typeof getSupabaseAdmin>, token: string) {
  if (!supabase) return null;

  const { data: invites, error: inviteError } = await supabase
    .from("invitations")
    .select("*")
    .eq("token", token)
    .order("created_at", { ascending: false })
    .limit(1);

  if (inviteError) throw inviteError;
  const invite = invites?.[0];
  if (!invite) return null;

  const [{ data: distributors, error: distributorError }, { data: brands, error: brandError }] =
    await Promise.all([
      invite.distributor_id
        ? supabase.from("distributors").select("*").eq("id", invite.distributor_id).limit(1)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("brands").select("*").eq("id", invite.brand_id).limit(1),
    ]);

  if (distributorError) throw distributorError;
  if (brandError) throw brandError;

  const distributor = distributors?.[0];
  const brand = brands?.[0];
  const status = getInviteStatus({ acceptedAt: invite.accepted_at, expiresAt: invite.expires_at });
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");

  return {
    id: invite.id,
    brandId: invite.brand_id,
    brandName: brand?.name || DEFAULT_BRAND_NAME,
    distributorId: invite.distributor_id || "",
    distributorName: distributor?.name || invite.email,
    distributorLevel: (distributor?.level || "B") as DistributorLevel,
    email: invite.email,
    token: invite.token,
    inviteUrl: `${appUrl}/invite/${invite.token}`,
    status,
    expiresAt: invite.expires_at,
    acceptedAt: invite.accepted_at,
    createdAt: invite.created_at,
  } satisfies DistributorInvite;
}
