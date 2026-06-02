import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

type CheckoutSessionLike = Pick<
  Stripe.Checkout.Session,
  "id" | "client_reference_id" | "amount_total" | "currency" | "metadata" | "payment_intent" | "payment_status"
>;

type StripeOrderRow = {
  id: string;
  order_number: string;
  status: string | null;
  total_value: number | string | null;
  payment_status: string | null;
  payment_due_date: string | null;
  amount_paid: number | string | null;
};

export function getStripeCheckoutSessionReference(session: CheckoutSessionLike) {
  const metadata = session.metadata || {};
  const clientReference = session.client_reference_id || "";
  return {
    sessionId: session.id,
    orderId: metadata.order_id || (isUuid(clientReference) ? clientReference : ""),
    orderToken: metadata.order_token || (!isUuid(clientReference) ? clientReference : ""),
    orderNumber: metadata.order_number || "",
    amountPaid: centsToDollars(session.amount_total),
    currency: (session.currency || "usd").toUpperCase(),
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
  };
}

export function buildStripeCheckoutReconciliation(
  order: StripeOrderRow,
  session: CheckoutSessionLike,
  paidAt = new Date().toISOString()
) {
  const reference = getStripeCheckoutSessionReference(session);
  const totalValue = roundCurrency(Number(order.total_value || 0));
  const existingPaid = roundCurrency(Number(order.amount_paid || 0));
  const stripePaid = reference.amountPaid ?? Math.max(0, totalValue - existingPaid);
  const amountPaid = order.payment_status === "paid"
    ? existingPaid
    : roundCurrency(Math.min(totalValue, existingPaid + stripePaid));
  const outstandingAmount = roundCurrency(Math.max(0, totalValue - amountPaid));
  const paymentStatus = outstandingAmount > 0 ? "partial" : "paid";
  const eventType = paymentStatus === "paid" ? "payment_paid" : "payment_partial";
  const label = paymentStatus === "paid" ? "Payment paid" : "Payment partial";
  const details = {
    provider: "stripe",
    stripe_checkout_session_id: reference.sessionId,
    stripe_payment_intent_id: reference.paymentIntentId,
    amount_paid: amountPaid,
    stripe_amount_paid: stripePaid,
    outstanding_amount: outstandingAmount,
    currency: reference.currency,
    paid_at: paidAt,
  };

  return {
    reference,
    paymentStatus,
    eventType,
    label,
    details,
    orderUpdate: {
      status: "distributor_confirmed",
      payment_status: paymentStatus,
      payment_method: "card",
      payment_due_date: paymentStatus === "paid" ? null : order.payment_due_date,
      amount_paid: amountPaid,
      outstanding_amount: outstandingAmount,
      stripe_checkout_session_id: reference.sessionId,
    },
    paymentRequestUpdate: {
      status: paymentStatus,
      paid_at: paidAt,
      metadata: details,
    },
  };
}

export async function reconcileStripeCheckoutSession(
  supabase: SupabaseClient,
  session: CheckoutSessionLike,
  paidAt = new Date().toISOString()
) {
  const reference = getStripeCheckoutSessionReference(session);
  const order = await findStripeOrder(supabase, reference);
  const reconciliation = buildStripeCheckoutReconciliation(order, session, paidAt);

  const { error: orderError } = await supabase
    .from("orders")
    .update(reconciliation.orderUpdate)
    .eq("id", order.id);

  if (orderError) throw orderError;

  const { data: existingEvents, error: existingEventError } = await supabase
    .from("order_events")
    .select("id")
    .eq("order_id", order.id)
    .eq("event_type", reconciliation.eventType)
    .limit(1);

  if (existingEventError) throw existingEventError;

  if (!existingEvents?.length) {
    const { error: eventError } = await supabase.from("order_events").insert({
      order_id: order.id,
      event_type: reconciliation.eventType,
      label: reconciliation.label,
      details: reconciliation.details,
    });

    if (eventError) throw eventError;
  }

  const updatedPaymentRequests = await markStripePaymentRequestsPaid(supabase, order.id, reconciliation);

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    paymentStatus: reconciliation.paymentStatus,
    amountPaid: reconciliation.orderUpdate.amount_paid,
    outstandingAmount: reconciliation.orderUpdate.outstanding_amount,
    updatedPaymentRequests,
  };
}

async function findStripeOrder(
  supabase: SupabaseClient,
  reference: ReturnType<typeof getStripeCheckoutSessionReference>
): Promise<StripeOrderRow> {
  const lookups = [
    reference.orderId ? { column: "id", value: reference.orderId } : null,
    reference.orderToken ? { column: "share_token", value: reference.orderToken } : null,
  ].filter(Boolean) as Array<{ column: string; value: string }>;

  for (const lookup of lookups) {
    const { data, error } = await supabase
      .from("orders")
      .select("id, order_number, status, total_value, payment_status, payment_due_date, amount_paid")
      .eq(lookup.column, lookup.value)
      .limit(1);

    if (error) throw error;
    if (data?.[0]) return data[0] as StripeOrderRow;
  }

  throw new Error("Stripe checkout session did not match a Distributor OS order.");
}

async function markStripePaymentRequestsPaid(
  supabase: SupabaseClient,
  orderId: string,
  reconciliation: ReturnType<typeof buildStripeCheckoutReconciliation>
) {
  const { data: bySession, error: sessionError } = await supabase
    .from("payment_requests")
    .update(reconciliation.paymentRequestUpdate)
    .eq("provider", "stripe")
    .eq("provider_session_id", reconciliation.reference.sessionId)
    .select("id");

  if (sessionError) throw sessionError;
  if (bySession?.length) return bySession.length;

  const { data: byOrder, error: orderError } = await supabase
    .from("payment_requests")
    .update(reconciliation.paymentRequestUpdate)
    .eq("order_id", orderId)
    .in("status", ["requested", "viewed", "partial"])
    .select("id");

  if (orderError) throw orderError;
  return byOrder?.length || 0;
}

function centsToDollars(cents: number | null | undefined) {
  if (typeof cents !== "number") return null;
  return roundCurrency(cents / 100);
}

function roundCurrency(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
