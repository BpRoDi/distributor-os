import { NextResponse } from "next/server";
import { z } from "zod";
import {
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/payments/status";
import { applyOrderPaymentUpdate, getPaymentEvent } from "@/lib/orders/payment";
import { getOrderByToken, getSupabaseAdmin } from "@/lib/orders/persistence";

const PaymentUpdateSchema = z.object({
  payment_status: z.enum(["unpaid", "requested", "paid", "partial", "overdue"]),
  payment_method: z.enum(["bank_transfer", "paypal", "card", "apple_pay", "offline"]).optional(),
  payment_due_date: z.string().optional().nullable(),
  amount_paid: z.coerce.number().nonnegative().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const parsed = PaymentUpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 503 }
      );
    }

    const existing = await getOrderByToken(supabase, token);
    const paymentStatus = parsed.data.payment_status as PaymentStatus;
    const paymentMethod = (parsed.data.payment_method || "offline") as PaymentMethod;
    const paymentUpdate = applyOrderPaymentUpdate(existing, {
      paymentStatus,
      paymentMethod,
      paymentDueDate: parsed.data.payment_due_date || null,
      amountPaid: parsed.data.amount_paid ?? existing.amountPaid,
    });
    const paymentEvent = getPaymentEvent(paymentStatus);

    const { error: updateError } = await supabase
      .from("orders")
      .update({
        payment_status: paymentStatus,
        payment_method: paymentUpdate.paymentMethod,
        payment_due_date: paymentUpdate.paymentDueDate,
        amount_paid: paymentUpdate.amountPaid,
        outstanding_amount: paymentUpdate.outstandingAmount,
      })
      .eq("id", existing.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    if (!existing.events.some((event) => event.eventType === paymentEvent.eventType)) {
      const { error: eventError } = await supabase.from("order_events").insert({
        order_id: existing.id,
        event_type: paymentEvent.eventType,
        label: paymentEvent.label,
        details: {
          payment_status: paymentStatus,
          payment_method: paymentUpdate.paymentMethod,
          amount_paid: paymentUpdate.amountPaid,
          outstanding_amount: paymentUpdate.outstandingAmount,
        },
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
      { error: error?.message || "Unknown payment update error." },
      { status }
    );
  }
}
