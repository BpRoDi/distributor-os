import Stripe from "stripe";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/orders/persistence";
import { getStripeClient } from "@/lib/payments/stripe-checkout";
import { reconcileStripeCheckoutSession } from "@/lib/payments/stripe-webhook";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "Distributor OS Stripe webhook",
    status: "live",
    accepts: "POST requests from Stripe only",
    events: [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ],
  });
}

export async function POST(request: Request) {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");

  if (!stripe || !webhookSecret) {
    return NextResponse.json(
      { error: "Missing Stripe webhook environment variables." },
      { status: 503 }
    );
  }

  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, webhookSecret);
  } catch (error: any) {
    return NextResponse.json(
      { error: `Invalid Stripe webhook signature: ${error?.message || "verification failed"}` },
      { status: 400 }
    );
  }

  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== "paid") {
    return NextResponse.json({ received: true, skipped: "checkout_not_paid" });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "Missing Supabase environment variables." },
      { status: 503 }
    );
  }

  try {
    const result = await reconcileStripeCheckoutSession(supabase, session);
    return NextResponse.json({ received: true, result });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Stripe checkout reconciliation failed." },
      { status: 500 }
    );
  }
}
