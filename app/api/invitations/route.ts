import { NextResponse } from "next/server";
import { z } from "zod";
import { sendInviteEmail } from "@/lib/email/resend";

const InviteSchema = z.object({
  email: z.string().email(),
  brandName: z.string().min(1),
  token: z.string().min(8)
});

export async function POST(request: Request) {
  const parsed = InviteSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/invite/${parsed.data.token}`;
  const result = await sendInviteEmail({
    to: parsed.data.email,
    brandName: parsed.data.brandName,
    inviteUrl
  });

  return NextResponse.json({ ok: true, result });
}
