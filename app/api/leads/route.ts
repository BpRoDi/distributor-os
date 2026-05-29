import { NextResponse } from "next/server";
import { z } from "zod";

const LeadSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  company: z.string().min(1),
  distributors: z.string().optional(),
  skuCount: z.string().optional(),
  region: z.string().optional()
});

export async function POST(request: Request) {
  const json = await request.json();
  const parsed = LeadSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Replace with Supabase insert or CRM webhook when ready.
  console.log("[lead]", parsed.data);

  return NextResponse.json({ ok: true });
}
