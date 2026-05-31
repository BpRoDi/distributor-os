"use client";

import { useEffect, useMemo, useState } from "react";
import { readApiError } from "@/lib/api/errors";
import {
  getDemoSharedOrder,
  levelDetails,
  type DistributorLevel,
  type SourceChannel,
} from "@/lib/commercial-demo";
import { applyOrderPaymentUpdate } from "@/lib/orders/payment";
import { polishDemoProductName, polishDemoSku } from "@/lib/orders/product-display";
import type { PaymentMethod, PaymentStatus } from "@/lib/payments/status";

type BadgeTone = "slate" | "blue" | "emerald" | "amber" | "rose";
type OrderStatus = "po_requested" | "draft" | "approved" | "link_created" | "distributor_confirmed" | "cancelled";
type SharedOrderItem = {
  id?: string;
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
type SharedOrderEvent = {
  id?: string;
  eventType: string;
  label: string;
  createdAt?: string;
};
type SharedOrder = {
  id?: string;
  orderNumber: string;
  orderId: string;
  brandName: string;
  distributorName: string;
  distributorLevel: DistributorLevel;
  sourceChannel: SourceChannel;
  originalMessage: string;
  status: OrderStatus;
  shareToken: string;
  token: string;
  totalValue: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  paymentDueDate?: string | null;
  amountPaid: number;
  outstandingAmount: number;
  paymentRequestUrl?: string | null;
  items: SharedOrderItem[];
  events: SharedOrderEvent[];
};
type OrderActionLoading = "confirm" | "requestPayment" | "markPaid" | null;

export default function OrderReviewClient({ token }: { token: string }) {
  const [order, setOrder] = useState<SharedOrder | null>(null);
  const [loadState, setLoadState] = useState("Loading saved order...");
  const [loadError, setLoadError] = useState("");
  const [actionLoading, setActionLoading] = useState<OrderActionLoading>(null);

  useEffect(() => {
    loadOrder();
  }, [token]);

  async function loadOrder() {
    setLoadError("");
    setLoadState("Loading saved order...");
    let remoteError = "";
    try {
      const response = await fetch(`/api/orders/${token}`, { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        setOrder(normalizeSharedOrder(data.order));
        setLoadState("Loaded from Supabase");
        return;
      }
      if (response.status === 404) {
        setLoadState("Order link not found");
        remoteError = "Invalid order token. Ask the brand for a fresh confirmation link.";
      } else if (response.status !== 503) {
        setLoadState("Order lookup failed");
        remoteError = `Order lookup failed: ${await readApiError(response, "Unable to load order")}`;
      } else {
        setLoadState("Supabase env vars missing; checking local preview storage.");
      }
    } catch (error: any) {
      remoteError = `Order lookup failed: ${error?.message || "API unavailable"}`;
    }

    const raw = window.localStorage.getItem(`distributor-os-shared-order-${token}`);
    if (raw) {
      try {
        setOrder(normalizeSharedOrder(JSON.parse(raw)));
        setLoadState("Loaded from local preview storage");
        return;
      } catch {
        setLoadError("Saved local order data is invalid. Ask the brand to create a fresh link.");
        setLoadState("Local order could not be loaded");
        return;
      }
    }

    if (isDemoOrderToken(token)) {
      setOrder(normalizeSharedOrder(getDemoSharedOrder(token)));
      setLoadState("Loaded sample order");
      return;
    }

    setLoadError(remoteError || "Invalid order token. Ask the brand for a fresh confirmation link.");
    setLoadState("Order link not found");
  }

  const total = useMemo(
    () => order?.items.reduce((sum, item) => sum + item.lineTotal, 0) ?? 0,
    [order]
  );
  const riskCount = useMemo(
    () => order?.items.filter((item) => item.quantity < item.moq || item.stockSnapshot <= 0).length ?? 0,
    [order]
  );

  async function confirmOrder() {
    if (!order) return;
    setActionLoading("confirm");
    setLoadError("");
    try {
      const response = await fetch(`/api/orders/${token}/confirm`, { method: "POST" });
      if (response.ok) {
        const data = await response.json();
        const confirmedOrder = normalizeSharedOrder(data.order);
        setOrder(confirmedOrder);
        persistSharedOrderSnapshot(confirmedOrder, token);
        setLoadState("Confirmed in Supabase");
        setActionLoading(null);
        return;
      }
      const error = await readApiError(response, "Distributor confirmation failed");
      if (response.status !== 503) {
        setLoadError(`Failed distributor confirmation: ${error}`);
        setLoadState("Confirmation failed");
        setActionLoading(null);
        return;
      }
    } catch {
      // Use local preview confirmation below when Supabase is not configured.
    }

    const nextOrder = appendSharedOrderEvent(
      { ...order, status: "distributor_confirmed" as OrderStatus },
      "distributor_confirmed",
      "Distributor confirmed"
    );
    setOrder(nextOrder);
    persistSharedOrderSnapshot(nextOrder, token);
    window.localStorage.setItem(
      "distributor-os-confirmed-order",
      JSON.stringify({ token, status: "Distributor Confirmed", confirmedAt: new Date().toISOString() })
    );
    setLoadState("Confirmed in local preview storage");
    setActionLoading(null);
  }

  async function updatePayment(paymentStatus: PaymentStatus) {
    if (!order) return;
    setActionLoading(paymentStatus === "paid" ? "markPaid" : "requestPayment");
    setLoadError("");
    const dueDate = paymentStatus === "requested" ? addDaysIso(7) : null;
    try {
      const response = await fetch(`/api/orders/${token}/payment`, {
        method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payment_status: paymentStatus,
        payment_method: paymentStatus === "requested" ? "card" : "offline",
        amount_paid: paymentStatus === "paid" ? order.totalValue : order.amountPaid,
        payment_due_date: dueDate,
      }),
    });
    if (response.ok) {
      const data = await response.json();
      const nextOrder = normalizeSharedOrder(data.order);
      setOrder(nextOrder);
      persistSharedOrderSnapshot(nextOrder, token);
      if (data.paymentUrl) window.open(data.paymentUrl, "_blank", "noopener,noreferrer");
      setLoadState(paymentStatus === "paid" ? "Payment marked paid in Supabase" : "Payment requested in Supabase");
      setActionLoading(null);
      return;
    }
    const error = await readApiError(response, "Payment update failed");
    if (response.status !== 503) {
      setLoadError(`Failed payment update: ${error}`);
      setLoadState("Payment update failed");
      setActionLoading(null);
      return;
    }
    } catch {
      // Use local preview payment status below when Supabase is not configured.
    }

  const nextOrder = applySharedPaymentStatus(order, paymentStatus, dueDate);
  setOrder(nextOrder);
  persistSharedOrderSnapshot(nextOrder, token);
  setLoadState(paymentStatus === "paid" ? "Payment marked paid in local preview storage" : "Payment requested in local preview storage");
  setActionLoading(null);
}

  if (!order) {
    return (
      <main className="min-h-screen bg-[#f6f8fb] text-slate-950">
        <header className="border-b border-slate-200 bg-white px-6 py-4">
          <div className="mx-auto max-w-7xl">
            <p className="text-sm text-slate-500">Distributor OS</p>
            <h1 className="text-2xl font-bold">Distributor Order Review</h1>
          </div>
        </header>
        <div className="mx-auto max-w-3xl px-6 py-6">
          <Panel>
            <h2 className="font-bold">{loadError ? "Order link unavailable" : "Loading order"}</h2>
            <p className={`mt-2 text-sm leading-6 ${loadError ? "text-rose-700" : "text-slate-600"}`}>
              {loadError || loadState}
            </p>
          </Panel>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] text-slate-950">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-slate-500">{order.brandName}</p>
            <h1 className="text-2xl font-bold">Distributor Order Review</h1>
          </div>
          <Badge tone={order.status === "distributor_confirmed" ? "emerald" : "blue"}>{orderStatusLabel(order.status)}</Badge>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-6 xl:grid-cols-[1fr_380px]">
        <section className="space-y-6">
          <section className="rounded-[8px] bg-slate-950 p-6 text-white">
            <p className="text-sm text-slate-300">{order.distributorName} / {levelDetails[order.distributorLevel].label}</p>
            <h2 className="mt-2 text-2xl font-bold">{order.orderNumber}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Review the saved order, original message, stock snapshots, and A/B/C level prices before confirming.
            </p>
          </section>

          <Panel>
            <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center">
              <div>
                <h2 className="text-xl font-bold">Order lines</h2>
                <p className="text-sm text-slate-500">Each line is a saved snapshot from the brand-approved draft.</p>
              </div>
              <Badge tone={riskCount ? "amber" : "emerald"}>{riskCount ? "Review required" : "Ready to confirm"}</Badge>
            </div>
            <div className="space-y-4">
              {order.items.map((item) => (
                <div key={`${item.sku}-${item.id}`} className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-4 flex flex-col justify-between gap-2 md:flex-row md:items-start">
                    <div>
                      <p className="font-bold">{item.productName}</p>
                      <p className="text-sm text-slate-500">Saved SKU snapshot</p>
                    </div>
                    <Badge tone={item.quantity < item.moq || item.stockSnapshot <= 0 ? "amber" : "emerald"}>
                      {item.quantity < item.moq || item.stockSnapshot <= 0 ? "Check" : "Matched"}
                    </Badge>
                  </div>
                  <div className="grid gap-3 md:grid-cols-4 2xl:grid-cols-8">
                    <ReadField label="SKU" value={item.sku} />
                    <ReadField label="Quantity" value={item.quantity} />
                    <ReadField label="Level A price" value={`$${item.levelAPrice.toFixed(2)}`} />
                    <ReadField label="Level B price" value={`$${item.levelBPrice.toFixed(2)}`} />
                    <ReadField label="Level C price" value={`$${item.levelCPrice.toFixed(2)}`} />
                    <ReadField label="MOQ" value={item.moq} />
                    <ReadField label="Stock snapshot" value={item.stockSnapshot} />
                    <ReadField label="Confidence" value={`${item.confidence}%`} />
                  </div>
                  <div className="mt-3 flex items-center justify-between rounded-[8px] bg-white px-4 py-3 text-sm ring-1 ring-slate-200">
                    <span className="text-slate-500">Applied unit price / line total</span>
                    <span className="font-bold">${item.unitPrice.toFixed(2)} / ${item.lineTotal.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel>
            <h2 className="text-xl font-bold">Original {order.sourceChannel} source</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <ReadField label="Channel" value={order.sourceChannel} />
              <ReadField label="Order token" value={order.shareToken} />
              <ReadField label="Pricing level" value={levelDetails[order.distributorLevel].label} />
            </div>
            <div className="mt-3 rounded-[8px] bg-slate-50 p-4 text-sm leading-6 text-slate-700 ring-1 ring-slate-200">
              {order.originalMessage}
            </div>
          </Panel>
        </section>

        <aside className="space-y-6">
          <Panel>
            <h2 className="font-bold">Confirmation summary</h2>
            <p className="mt-1 text-xs font-semibold text-blue-700">{loadState}</p>
            {loadError && (
              <div className="mt-3 rounded-[8px] border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
                {loadError}
              </div>
            )}
            <div className="mt-4 space-y-3">
              <ReadField label="Distributor" value={order.distributorName} />
              <ReadField label="Level" value={levelDetails[order.distributorLevel].label} />
              <ReadField label="Items" value={order.items.length} />
              <ReadField label="Total value" value={`$${total.toFixed(2)}`} />
              <ReadField label="Payment" value={<Badge tone={paymentTone(order.paymentStatus)}>{paymentStatusLabel(order.paymentStatus)}</Badge>} />
              <ReadField label="Outstanding" value={`$${order.outstandingAmount.toFixed(2)}`} />
            </div>
            <button
              onClick={confirmOrder}
              disabled={order.status === "distributor_confirmed" || actionLoading === "confirm"}
              className="mt-5 w-full rounded-[8px] bg-blue-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              {actionLoading === "confirm" ? "Confirming..." : order.status === "distributor_confirmed" ? "Order confirmed" : "Confirm order"}
            </button>
          </Panel>

          <Panel>
            <h2 className="font-bold">Payment instructions</h2>
            <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
              <p>Method: bank transfer or approved offline terms with Nimbus Home Goods finance.</p>
              <p>Reference: {order.orderNumber}. Outstanding amount: ${order.outstandingAmount.toFixed(2)}.</p>
              {order.paymentDueDate && <p>Due date: {new Date(order.paymentDueDate).toLocaleDateString()}.</p>}
            </div>
            {order.paymentRequestUrl && order.paymentStatus === "requested" && (
              <a
                href={order.paymentRequestUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 block rounded-[8px] bg-slate-950 px-4 py-3 text-center text-sm font-semibold text-white"
              >
                Pay with secure checkout
              </a>
            )}
            {order.status === "distributor_confirmed" && (
              <div className="mt-4 grid gap-2">
                <button
                  onClick={() => updatePayment("requested")}
                  disabled={order.paymentStatus === "paid" || actionLoading === "requestPayment"}
                  className="rounded-[8px] bg-blue-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {actionLoading === "requestPayment" ? "Requesting..." : "Request Payment"}
                </button>
                <button
                  onClick={() => updatePayment("paid")}
                  disabled={order.paymentStatus === "paid" || actionLoading === "markPaid"}
                  className="rounded-[8px] border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-40"
                >
                  {actionLoading === "markPaid" ? "Marking..." : "Mark as Paid"}
                </button>
              </div>
            )}
          </Panel>

          <Panel>
            <h2 className="font-bold">Order event timeline</h2>
            <div className="mt-4 space-y-3">
              {getTimeline(order).map((event, index) => (
                <div key={`${event.label}-${index}`} className="flex gap-3">
                  <div className={event.done ? "mt-0.5 h-6 w-6 rounded-full bg-slate-950 text-center text-xs font-bold leading-6 text-white" : "mt-0.5 h-6 w-6 rounded-full bg-slate-100 text-center text-xs font-bold leading-6 text-slate-400"}>
                    {index + 1}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{event.label}</p>
                    <p className="text-xs text-slate-500">{event.createdAt ? new Date(event.createdAt).toLocaleString() : event.done ? "Complete" : "Waiting"}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel>
            <h2 className="font-bold">What happens next</h2>
            <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
              <p>The brand sees this order move to Distributor Confirmed in the pending confirmation panel.</p>
              <p>Finance or fulfillment can then convert the confirmed order into invoice, payment, or shipment workflow.</p>
            </div>
          </Panel>
        </aside>
      </div>
    </main>
  );
}

function normalizeSharedOrder(raw: any): SharedOrder {
  const fallback = getDemoSharedOrder(raw?.token || "ORD-NIMBUS-7F3K");
  const status = normalizeStatus(raw?.status || fallback.status);
  const items = (raw?.items || fallback.items).map((item: any) => {
    const rawProductName = item.productName || item.product_name || item.name;
    const productName = polishDemoProductName(rawProductName);
    const quantity = Number(item.quantity ?? item.qty ?? 0);
    const unitPrice = Number(item.unitPrice ?? item.unit_price ?? item.levelPrice ?? 0);
    return {
      id: item.id,
      productName,
      name: polishDemoProductName(item.name || rawProductName),
      sku: polishDemoSku(item.sku, rawProductName),
      quantity,
      qty: quantity,
      unitPrice,
      levelAPrice: Number(item.levelAPrice ?? item.level_a_price ?? item.levelPrices?.A ?? item.levelPrice ?? 0),
      levelBPrice: Number(item.levelBPrice ?? item.level_b_price ?? item.levelPrices?.B ?? item.standardPrice ?? 0),
      levelCPrice: Number(item.levelCPrice ?? item.level_c_price ?? item.levelPrices?.C ?? item.levelPrice ?? 0),
      moq: Number(item.moq ?? 1),
      stockSnapshot: Number(item.stockSnapshot ?? item.stock_snapshot ?? item.stock ?? 0),
      stock: Number(item.stock ?? item.stockSnapshot ?? item.stock_snapshot ?? 0),
      confidence: Number(item.confidence ?? 0),
      lineTotal: Number(item.lineTotal ?? item.line_total ?? quantity * unitPrice),
    };
  });

  return {
    id: raw?.id,
    orderNumber: raw?.orderNumber || raw?.order_number || raw?.orderId || fallback.orderId,
    orderId: raw?.orderId || raw?.orderNumber || raw?.order_number || fallback.orderId,
    brandName: raw?.brandName || raw?.brand_name || fallback.brandName,
    distributorName: raw?.distributorName || raw?.distributor_name || fallback.distributorName,
    distributorLevel: (raw?.distributorLevel || raw?.distributor_level || fallback.distributorLevel) as DistributorLevel,
    sourceChannel: (raw?.sourceChannel || raw?.source_channel || fallback.sourceChannel) as SourceChannel,
    originalMessage: raw?.originalMessage || raw?.original_message || fallback.originalMessage,
    status,
    shareToken: raw?.shareToken || raw?.share_token || raw?.token || fallback.token,
    token: raw?.token || raw?.shareToken || raw?.share_token || fallback.token,
    totalValue: Number(raw?.totalValue ?? raw?.total_value ?? items.reduce((sum: number, item: SharedOrderItem) => sum + item.lineTotal, 0)),
    paymentStatus: normalizePaymentStatus(raw?.paymentStatus || raw?.payment_status),
    paymentMethod: normalizePaymentMethod(raw?.paymentMethod || raw?.payment_method),
    paymentDueDate: raw?.paymentDueDate || raw?.payment_due_date || null,
    amountPaid: Number(raw?.amountPaid ?? raw?.amount_paid ?? 0),
    outstandingAmount: Number(raw?.outstandingAmount ?? raw?.outstanding_amount ?? raw?.totalValue ?? raw?.total_value ?? items.reduce((sum: number, item: SharedOrderItem) => sum + item.lineTotal, 0)),
    paymentRequestUrl: raw?.paymentRequestUrl || raw?.payment_request_url || raw?.requestUrl || raw?.request_url || null,
    items,
    events: (raw?.events || []).map((event: any) => ({
      id: event.id,
      eventType: event.eventType || event.event_type,
      label: event.label,
      createdAt: event.createdAt || event.created_at,
    })),
  };
}

function normalizeStatus(status: string): OrderStatus {
  const map: Record<string, OrderStatus> = {
    Draft: "draft",
    "PO Requested": "po_requested",
    "Brand Approved": "approved",
    "Link Shared": "link_created",
    "Distributor Confirmed": "distributor_confirmed",
    po_requested: "po_requested",
    draft: "draft",
    approved: "approved",
    link_created: "link_created",
    distributor_confirmed: "distributor_confirmed",
    cancelled: "cancelled",
  };
  return map[status] || "link_created";
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

function isDemoOrderToken(token: string) {
  return token.toLowerCase().startsWith("demo") || token === "ORD-NIMBUS-7F3K";
}

function paymentStatusLabel(status: PaymentStatus) {
  const labels: Record<PaymentStatus, string> = {
    unpaid: "Unpaid",
    requested: "Requested",
    paid: "Paid",
    partial: "Partial",
    overdue: "Overdue",
  };
  return labels[status];
}

function paymentTone(status: PaymentStatus): BadgeTone {
  if (status === "paid") return "emerald";
  if (status === "overdue") return "rose";
  if (status === "requested" || status === "partial") return "amber";
  return "slate";
}

function applySharedPaymentStatus(order: SharedOrder, paymentStatus: PaymentStatus, dueDate: string | null): SharedOrder {
  return applyOrderPaymentUpdate(order, {
    paymentStatus,
    paymentMethod: "offline",
    paymentDueDate: dueDate,
    amountPaid: paymentStatus === "paid" ? order.totalValue : order.amountPaid,
  });
}

function appendSharedOrderEvent(order: SharedOrder, eventType: string, label: string): SharedOrder {
  if (order.events.some((event) => event.eventType === eventType)) return order;
  return {
    ...order,
    events: [
      ...order.events,
      { eventType, label, createdAt: new Date().toISOString() },
    ],
  };
}

function persistSharedOrderSnapshot(order: SharedOrder, token: string) {
  window.localStorage.setItem(`distributor-os-shared-order-${token}`, JSON.stringify(order));

  let records: any[] = [];
  try {
    records = JSON.parse(window.localStorage.getItem("distributor-os-order-records") || "[]") as any[];
  } catch {
    records = [];
  }

  const nextRecords = [
    order,
    ...records.filter((item) => {
      const itemToken = item?.shareToken || item?.share_token || item?.token;
      return itemToken !== token && item?.id !== order.id;
    }),
  ];
  window.localStorage.setItem("distributor-os-order-records", JSON.stringify(nextRecords));
}

function addDaysIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function orderStatusLabel(status: OrderStatus) {
  const labels: Record<OrderStatus, string> = {
    po_requested: "PO requested",
    draft: "Draft",
    approved: "Approved",
    link_created: "Link created",
    distributor_confirmed: "Distributor confirmed",
    cancelled: "Cancelled",
  };
  return labels[status];
}

function getTimeline(order: SharedOrder) {
  const saved = order.events.map((event) => ({ ...event, done: true }));
  if (saved.length) {
    const hasConfirm = saved.some((event) => event.eventType === "distributor_confirmed");
    return order.status === "distributor_confirmed" && !hasConfirm
      ? [...saved, { eventType: "distributor_confirmed", label: "Distributor confirmed", done: true }]
      : saved;
  }

  return [
    { eventType: "message_pasted", label: "Message pasted", done: true },
    { eventType: "draft_generated", label: "Draft generated", done: true },
    { eventType: "brand_approved", label: "Brand approved", done: true },
    { eventType: "link_created", label: "Link created", done: true },
    { eventType: "distributor_confirmed", label: "Distributor confirmed", done: order.status === "distributor_confirmed" },
  ];
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="rounded-[8px] border border-slate-200 bg-white p-6 shadow-sm">{children}</section>;
}

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: BadgeTone }) {
  const classes: Record<BadgeTone, string> = {
    slate: "bg-slate-100 text-slate-700",
    blue: "bg-blue-50 text-blue-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
  };
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${classes[tone]}`}>{children}</span>;
}

function ReadField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[8px] bg-white p-3 ring-1 ring-slate-200">
      <p className="text-xs text-slate-500">{label}</p>
      <div className="mt-1 text-sm font-bold">{value}</div>
    </div>
  );
}
