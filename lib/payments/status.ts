export type PaymentStatus = "unpaid" | "requested" | "paid" | "partial" | "overdue";
export type PaymentMethod =
  | "bank_transfer"
  | "ach"
  | "wire"
  | "paypal"
  | "card"
  | "apple_pay"
  | "stablecoin_usdc"
  | "offline";

const allowedTransitions: Record<PaymentStatus, PaymentStatus[]> = {
  unpaid: ["requested", "partial", "paid", "overdue"],
  requested: ["partial", "paid", "overdue"],
  partial: ["paid", "overdue"],
  overdue: ["partial", "paid"],
  paid: ["paid"],
};

export function canTransitionPaymentStatus(from: PaymentStatus, to: PaymentStatus) {
  return allowedTransitions[from].includes(to);
}

export function calculateOutstandingAmount(totalValue: number, amountPaid: number) {
  return Math.max(0, roundCurrency(totalValue) - roundCurrency(amountPaid));
}

export function inferPaymentStatus(totalValue: number, amountPaid: number, requested = false): PaymentStatus {
  if (amountPaid >= totalValue && totalValue > 0) return "paid";
  if (amountPaid > 0) return "partial";
  return requested ? "requested" : "unpaid";
}

function roundCurrency(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}
