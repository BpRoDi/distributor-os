import {
  calculateOutstandingAmount,
  type PaymentMethod,
  type PaymentStatus,
} from "../payments/status.ts";

export type PaymentOrderEvent = {
  id?: string;
  eventType: string;
  label: string;
  createdAt?: string;
  details?: Record<string, unknown>;
};

export type PaymentOrderSnapshot = {
  totalValue: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  paymentDueDate?: string | null;
  amountPaid: number;
  outstandingAmount: number;
  events: PaymentOrderEvent[];
};

export type PaymentUpdateInput = {
  paymentStatus: PaymentStatus;
  paymentMethod?: PaymentMethod | null;
  paymentDueDate?: string | null;
  amountPaid?: number | null;
  createdAt?: string;
};

export function applyOrderPaymentUpdate<T extends PaymentOrderSnapshot>(
  order: T,
  input: PaymentUpdateInput
): Omit<T, keyof PaymentOrderSnapshot> & PaymentOrderSnapshot {
  const amountPaid = resolveAmountPaid(order, input);
  const paymentMethod = input.paymentMethod || "offline";
  const event = getPaymentEvent(input.paymentStatus);

  return {
    ...order,
    paymentStatus: input.paymentStatus,
    paymentMethod,
    paymentDueDate: input.paymentStatus === "paid" ? null : input.paymentDueDate ?? null,
    amountPaid,
    outstandingAmount: calculateOutstandingAmount(order.totalValue, amountPaid),
    events: appendPaymentEvent(order.events, {
      eventType: event.eventType,
      label: event.label,
      createdAt: input.createdAt || new Date().toISOString(),
    }),
  };
}

export function getPaymentEvent(paymentStatus: PaymentStatus) {
  const labels: Record<PaymentStatus, string> = {
    unpaid: "Payment unpaid",
    requested: "Payment requested",
    paid: "Payment paid",
    partial: "Payment partial",
    overdue: "Payment overdue",
  };

  return {
    eventType: `payment_${paymentStatus}`,
    label: labels[paymentStatus],
  };
}

function appendPaymentEvent(events: PaymentOrderEvent[], event: PaymentOrderEvent) {
  if (events.some((item) => item.eventType === event.eventType)) return events;
  return [...events, event];
}

function resolveAmountPaid(order: PaymentOrderSnapshot, input: PaymentUpdateInput) {
  if (input.paymentStatus === "paid") return order.totalValue;
  if (input.paymentStatus === "unpaid") return 0;
  return Number(input.amountPaid ?? order.amountPaid ?? 0);
}
