import type { DistributorLevel, SourceChannel } from "../commercial-demo.ts";
import { applyOrderPaymentUpdate } from "./payment.ts";
import type { PaymentMethod, PaymentStatus } from "../payments/status.ts";
import { polishDemoProductName, polishDemoSku } from "./product-display.ts";
import { brandStorageKey } from "../workspace/tenant.ts";

export type PortalOrderStatus =
  | "po_requested"
  | "draft"
  | "approved"
  | "link_created"
  | "distributor_confirmed"
  | "cancelled";

export type PortalOrderProduct = {
  id: string;
  name: string;
  sku: string;
  category?: string;
  moq: number;
  stock: number;
  levelPrices: Record<DistributorLevel, number>;
};

export type PortalOrderCartItem = PortalOrderProduct & {
  qty: number;
};

export type PortalOrderItem = {
  id?: string;
  productId?: string;
  productName: string;
  name: string;
  sku: string;
  quantity: number;
  qty: number;
  unitPrice: number;
  levelAPrice: number;
  levelBPrice: number;
  levelCPrice: number;
  moq: number;
  stockSnapshot: number;
  stock: number;
  confidence: number;
  lineTotal: number;
};

export type PortalOrderEvent = {
  id?: string;
  eventType: string;
  label: string;
  createdAt?: string;
};

export type PortalOrderSnapshot = {
  id?: string;
  orderNumber: string;
  orderId: string;
  brandId?: string;
  brandName: string;
  distributorId: string;
  distributorName: string;
  distributorLevel: DistributorLevel;
  sourceChannel: SourceChannel;
  originalMessage: string;
  status: PortalOrderStatus;
  shareToken: string;
  token: string;
  totalValue: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  paymentDueDate?: string | null;
  amountPaid: number;
  outstandingAmount: number;
  createdAt?: string;
  items: PortalOrderItem[];
  events: PortalOrderEvent[];
};

const orderRecordsKey = "distributor-os-order-records";
const sharedOrderPrefix = "distributor-os-shared-order-";

export function createPortalPoRequest({
  brandId,
  brandName,
  distributorId,
  distributorName,
  distributorLevel,
  cartItems,
  now = new Date(),
  tokenFactory = createPortalOrderToken,
}: {
  brandId?: string;
  brandName: string;
  distributorId: string;
  distributorName: string;
  distributorLevel: DistributorLevel;
  cartItems: PortalOrderCartItem[];
  now?: Date;
  tokenFactory?: () => string;
}): PortalOrderSnapshot {
  const token = tokenFactory();
  const createdAt = now.toISOString();
  const items = cartItems.map((item) => toPortalOrderItem(item, distributorLevel));
  const totalValue = roundCurrency(items.reduce((sum, item) => sum + item.lineTotal, 0));

  return {
    id: `portal-${token}`,
    orderNumber: `PO-${token.slice(-4)}`,
    orderId: `PO-${token.slice(-4)}`,
    brandId,
    brandName,
    distributorId,
    distributorName,
    distributorLevel,
    sourceChannel: "Distributor Portal",
    originalMessage: `${distributorName} submitted a PO request from the distributor buying portal.`,
    status: "po_requested",
    shareToken: token,
    token,
    totalValue,
    paymentStatus: "unpaid",
    paymentMethod: "offline",
    paymentDueDate: null,
    amountPaid: 0,
    outstandingAmount: totalValue,
    createdAt,
    items,
    events: [
      { eventType: "po_requested", label: "Distributor submitted PO", createdAt },
    ],
  };
}

export function approvePortalPoRequest(order: PortalOrderSnapshot, createdAt = new Date().toISOString()) {
  return appendPortalOrderEvent(
    { ...order, status: "approved" },
    "brand_approved",
    "Brand approved PO",
    createdAt
  );
}

export function requestPortalOrderPayment(order: PortalOrderSnapshot, dueDate = addDaysIso(7)) {
  return applyOrderPaymentUpdate(order, {
    paymentStatus: "requested",
    paymentMethod: "offline",
    paymentDueDate: dueDate,
    amountPaid: order.amountPaid,
  });
}

export function payPortalOrder(order: PortalOrderSnapshot) {
  return applyOrderPaymentUpdate(order, {
    paymentStatus: "paid",
    paymentMethod: "offline",
    amountPaid: order.totalValue,
  });
}

export function readPortalOrderRecords(brandId?: string) {
  const storage = getLocalStorage();
  if (!storage) return [];

  const orders: PortalOrderSnapshot[] = [];
  orders.push(...parseOrderArray(storage.getItem(orderRecordsKey)));
  if (brandId) orders.push(...parseOrderArray(storage.getItem(brandStorageKey(brandId, "order-records"))));

  const scopedPrefix = brandId ? brandStorageKey(brandId, "shared-order-") : "";
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    const isLegacyShared = key?.startsWith(sharedOrderPrefix);
    const isScopedShared = Boolean(scopedPrefix && key?.startsWith(scopedPrefix));
    if (!isLegacyShared && !isScopedShared) continue;

    const raw = key ? storage.getItem(key) : null;
    if (!raw) continue;
    try {
      orders.push(normalizePortalOrder(JSON.parse(raw)));
    } catch {
      if (key) storage.removeItem(key);
    }
  }

  return mergePortalOrderRecords(orders);
}

export function upsertPortalOrderRecord(order: PortalOrderSnapshot, brandId?: string) {
  const storage = getLocalStorage();
  if (!storage) return;

  const normalized = normalizePortalOrder(order);
  storage.setItem(`${sharedOrderPrefix}${normalized.shareToken}`, JSON.stringify(normalized));
  if (brandId) {
    storage.setItem(brandStorageKey(brandId, `shared-order-${normalized.shareToken}`), JSON.stringify(normalized));
  }

  upsertOrderArray(storage, orderRecordsKey, normalized);
  if (brandId) upsertOrderArray(storage, brandStorageKey(brandId, "order-records"), normalized);
}

export function normalizePortalOrder(raw: any): PortalOrderSnapshot {
  const items = (raw?.items || []).map(normalizePortalOrderItem);
  const totalValue = roundCurrency(
    Number(raw?.totalValue ?? raw?.total_value ?? items.reduce((sum: number, item: PortalOrderItem) => sum + item.lineTotal, 0))
  );
  const amountPaid = roundCurrency(Number(raw?.amountPaid ?? raw?.amount_paid ?? 0));

  return {
    id: raw?.id,
    orderNumber: raw?.orderNumber || raw?.order_number || raw?.orderId || "Portal PO",
    orderId: raw?.orderId || raw?.orderNumber || raw?.order_number || "Portal PO",
    brandId: raw?.brandId || raw?.brand_id,
    brandName: raw?.brandName || raw?.brand_name || "Nimbus Home Goods",
    distributorId: raw?.distributorId || raw?.distributor_id || "",
    distributorName: raw?.distributorName || raw?.distributor_name || "",
    distributorLevel: (raw?.distributorLevel || raw?.distributor_level || "B") as DistributorLevel,
    sourceChannel: normalizeSourceChannel(raw?.sourceChannel || raw?.source_channel),
    originalMessage: raw?.originalMessage || raw?.original_message || "Distributor submitted a PO request from the portal.",
    status: normalizePortalStatus(raw?.status),
    shareToken: raw?.shareToken || raw?.share_token || raw?.token || "",
    token: raw?.token || raw?.shareToken || raw?.share_token || "",
    totalValue,
    paymentStatus: normalizePaymentStatus(raw?.paymentStatus || raw?.payment_status),
    paymentMethod: normalizePaymentMethod(raw?.paymentMethod || raw?.payment_method),
    paymentDueDate: raw?.paymentDueDate || raw?.payment_due_date || null,
    amountPaid,
    outstandingAmount: roundCurrency(Number(raw?.outstandingAmount ?? raw?.outstanding_amount ?? Math.max(0, totalValue - amountPaid))),
    createdAt: raw?.createdAt || raw?.created_at,
    items,
    events: (raw?.events || []).map((event: any) => ({
      id: event.id,
      eventType: event.eventType || event.event_type,
      label: event.label,
      createdAt: event.createdAt || event.created_at,
    })),
  };
}

export function mergePortalOrderRecords(orders: PortalOrderSnapshot[]) {
  const byToken = new Map<string, PortalOrderSnapshot>();
  for (const rawOrder of orders) {
    const order = normalizePortalOrder(rawOrder);
    const key = order.shareToken || order.token || order.id || order.orderNumber;
    if (!key) continue;
    const existing = byToken.get(key);
    if (!existing || getOrderTime(order) >= getOrderTime(existing)) byToken.set(key, order);
  }
  return [...byToken.values()].sort((left, right) => getOrderTime(right) - getOrderTime(left));
}

export function addDaysIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function toPortalOrderItem(item: PortalOrderCartItem, level: DistributorLevel): PortalOrderItem {
  const unitPrice = Number(item.levelPrices[level] || 0);
  const quantity = Number(item.qty || 0);

  return {
    id: item.id,
    productId: item.id,
    productName: polishDemoProductName(item.name),
    name: polishDemoProductName(item.name),
    sku: polishDemoSku(item.sku, item.name),
    quantity,
    qty: quantity,
    unitPrice,
    levelAPrice: Number(item.levelPrices.A || 0),
    levelBPrice: Number(item.levelPrices.B || 0),
    levelCPrice: Number(item.levelPrices.C || 0),
    moq: Number(item.moq || 1),
    stockSnapshot: Number(item.stock || 0),
    stock: Number(item.stock || 0),
    confidence: 100,
    lineTotal: roundCurrency(quantity * unitPrice),
  };
}

function normalizePortalOrderItem(item: any): PortalOrderItem {
  const quantity = Number(item.quantity ?? item.qty ?? 0);
  const unitPrice = Number(item.unitPrice ?? item.unit_price ?? item.levelPrice ?? 0);
  const rawProductName = item.productName || item.product_name || item.name;
  const productName = polishDemoProductName(rawProductName);

  return {
    id: item.id,
    productId: item.productId || item.product_id || item.id,
    productName,
    name: polishDemoProductName(item.name || rawProductName),
    sku: polishDemoSku(item.sku, rawProductName),
    quantity,
    qty: quantity,
    unitPrice,
    levelAPrice: Number(item.levelAPrice ?? item.level_a_price ?? item.levelPrices?.A ?? unitPrice),
    levelBPrice: Number(item.levelBPrice ?? item.level_b_price ?? item.levelPrices?.B ?? unitPrice),
    levelCPrice: Number(item.levelCPrice ?? item.level_c_price ?? item.levelPrices?.C ?? unitPrice),
    moq: Number(item.moq ?? 1),
    stockSnapshot: Number(item.stockSnapshot ?? item.stock_snapshot ?? item.stock ?? 0),
    stock: Number(item.stock ?? item.stockSnapshot ?? item.stock_snapshot ?? 0),
    confidence: Number(item.confidence ?? 100),
    lineTotal: roundCurrency(Number(item.lineTotal ?? item.line_total ?? quantity * unitPrice)),
  };
}

function appendPortalOrderEvent(
  order: PortalOrderSnapshot,
  eventType: string,
  label: string,
  createdAt: string
): PortalOrderSnapshot {
  if (order.events.some((event) => event.eventType === eventType)) return order;
  return {
    ...order,
    events: [...order.events, { eventType, label, createdAt }],
  };
}

function upsertOrderArray(storage: Storage, key: string, order: PortalOrderSnapshot) {
  const existing = parseOrderArray(storage.getItem(key));
  const next = mergePortalOrderRecords([
    order,
    ...existing.filter((item) => item.shareToken !== order.shareToken && item.id !== order.id),
  ]);
  storage.setItem(key, JSON.stringify(next));
}

function parseOrderArray(raw: string | null) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizePortalOrder) : [];
  } catch {
    return [];
  }
}

function normalizePortalStatus(status: string | undefined): PortalOrderStatus {
  const map: Record<string, PortalOrderStatus> = {
    "PO Requested": "po_requested",
    Draft: "draft",
    "Brand Approved": "approved",
    "Link Shared": "link_created",
    "Distributor Confirmed": "distributor_confirmed",
    Cancelled: "cancelled",
    po_requested: "po_requested",
    draft: "draft",
    approved: "approved",
    link_created: "link_created",
    distributor_confirmed: "distributor_confirmed",
    cancelled: "cancelled",
  };
  return status ? map[status] || "link_created" : "link_created";
}

function normalizeSourceChannel(channel: string | undefined): SourceChannel {
  if (
    channel === "Telegram" ||
    channel === "Distributor Portal" ||
    channel === "Email" ||
    channel === "CSV" ||
    channel === "PDF" ||
    channel === "EDI"
  ) return channel;
  return "WhatsApp";
}

function normalizePaymentStatus(status: string | undefined): PaymentStatus {
  const map: Record<string, PaymentStatus> = {
    Pending: "unpaid",
    Unpaid: "unpaid",
    Requested: "requested",
    Paid: "paid",
    Partial: "partial",
    Overdue: "overdue",
    unpaid: "unpaid",
    requested: "requested",
    paid: "paid",
    partial: "partial",
    overdue: "overdue",
  };
  return status ? map[status] || "unpaid" : "unpaid";
}

function normalizePaymentMethod(method: string | undefined): PaymentMethod {
  const map: Record<string, PaymentMethod> = {
    bank_transfer: "bank_transfer",
    ach: "ach",
    wire: "wire",
    paypal: "paypal",
    card: "card",
    apple_pay: "apple_pay",
    stablecoin_usdc: "stablecoin_usdc",
    offline: "offline",
  };
  return method ? map[method] || "offline" : "offline";
}

function getOrderTime(order: PortalOrderSnapshot) {
  const eventTime = order.events.reduce((latest, event) => {
    const time = Date.parse(event.createdAt || "");
    return Number.isNaN(time) ? latest : Math.max(latest, time);
  }, 0);
  return eventTime || Date.parse(order.createdAt || "") || 0;
}

function createPortalOrderToken() {
  return `PO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function getLocalStorage() {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function roundCurrency(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}
