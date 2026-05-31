import type { OrderStatus, Product } from "./types";

export const ORDER_STATUSES: OrderStatus[] = [
  "Draft",
  "Submitted",
  "Confirmed",
  "Ready to Ship",
  "Shipped",
  "Delivered",
  "Cancelled"
];

export function getProductStatus(stock: number): Product["status"] {
  if (stock <= 0) return "Out of Stock";
  if (stock < 500) return "Low Stock";
  return "Available";
}

export function calculateCartLine(price: number, moq: number, quantityMultiplier: number): number {
  if (price < 0 || moq < 0 || quantityMultiplier < 0) throw new Error("Cart values cannot be negative");
  return price * moq * quantityMultiplier;
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;
  if (from === "Cancelled" || from === "Delivered") return false;
  if (to === "Cancelled") return true;
  const order = ORDER_STATUSES.filter((status) => status !== "Cancelled");
  return order.indexOf(to) >= order.indexOf(from);
}

export function isContextualThread(thread: { order_id?: string | null; sku?: string | null }) {
  return Boolean(thread.order_id || thread.sku);
}
