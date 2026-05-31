"use client";

import { useEffect, useMemo, useState } from "react";
import { AppHeader, Card, StatusBadge } from "@/components/ui";
import { demoOrders, demoProducts, demoThreads } from "@/lib/mock-data";
import { getLevelPrice, getPriceDelta, levelDetails, type DistributorLevel } from "@/lib/commercial-demo";
import {
  createPortalPoRequest,
  payPortalOrder,
  readPortalOrderRecords,
  upsertPortalOrderRecord,
  type PortalOrderSnapshot,
} from "@/lib/orders/portal-demo";
import { polishDemoProductName, polishDemoSku } from "@/lib/orders/product-display";
import { createDefaultBrandWorkspace } from "@/lib/workspace/tenant";
import type { DistributorInvite } from "@/lib/workspace/tenant";

type CartItem = typeof demoProducts[number] & { quantityMultiplier: number };
const portalLevel: DistributorLevel = "A";
const workspace = createDefaultBrandWorkspace();

export default function PortalPage() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [acceptedInvite, setAcceptedInvite] = useState<DistributorInvite | null>(null);
  const [orders, setOrders] = useState<PortalOrderSnapshot[]>([]);
  const [notice, setNotice] = useState("");
  const activeLevel = acceptedInvite?.distributorLevel || portalLevel;
  const distributorName = acceptedInvite?.distributorName || "EuroTrade GmbH";
  const brandName = acceptedInvite?.brandName || "Nimbus Home Goods";
  const total = useMemo(() => cart.reduce((sum, item) => sum + getLevelPrice(item, activeLevel) * item.moq * item.quantityMultiplier, 0), [cart, activeLevel]);
  const distributorOrders = useMemo(
    () => orders.filter((order) => order.distributorName === distributorName),
    [orders, distributorName]
  );
  const paymentOrder = distributorOrders.find((order) => order.paymentStatus === "requested" && order.outstandingAmount > 0);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("distributor-os-accepted-invite");
      if (raw) setAcceptedInvite(JSON.parse(raw));
    } catch {
      window.localStorage.removeItem("distributor-os-accepted-invite");
    }
  }, []);

  useEffect(() => {
    loadOrders();
    window.addEventListener("storage", loadOrders);
    window.addEventListener("focus", loadOrders);
    return () => {
      window.removeEventListener("storage", loadOrders);
      window.removeEventListener("focus", loadOrders);
    };
  }, [acceptedInvite?.distributorId]);

  function addToCart(product: typeof demoProducts[number]) {
    if (product.stock <= 0) return;
    setCart((prev) => {
      const found = prev.find((item) => item.id === product.id);
      if (found) return prev.map((item) => item.id === product.id ? { ...item, quantityMultiplier: item.quantityMultiplier + 1 } : item);
      return [...prev, { ...product, quantityMultiplier: 1 }];
    });
  }

  async function loadOrders() {
    const localOrders = readPortalOrderRecords(workspace.id);
    try {
      const response = await fetch(`/api/orders?brand_id=${encodeURIComponent(workspace.id)}&distributor_id=${encodeURIComponent(acceptedInvite?.distributorId || "dist-eurotrade")}`, { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.orders)) {
          setOrders([...data.orders, ...localOrders]);
          return;
        }
      }
    } catch {
      // Local orders keep the standalone portal usable without Supabase.
    }
    setOrders(localOrders);
  }

  async function submitPo() {
    if (!cart.length) return;
    const localOrder = createPortalPoRequest({
      brandId: workspace.id,
      brandName,
      distributorId: acceptedInvite?.distributorId || "dist-eurotrade",
      distributorName,
      distributorLevel: activeLevel,
      cartItems: cart.map((item) => ({ ...item, qty: item.moq * item.quantityMultiplier })),
    });
    let order = localOrder;
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_id: workspace.id,
          brand_name: brandName,
          distributor_id: acceptedInvite?.distributorId || "dist-eurotrade",
          distributor_name: distributorName,
          distributor_level: activeLevel,
          source_channel: "Distributor Portal",
          order_status: "po_requested",
          original_message: `Portal PO from ${distributorName}`,
          total_value: total,
          items: cart.map((item) => ({
            product_id: item.id,
            product_name: polishDemoProductName(item.name),
            sku: polishDemoSku(item.sku, item.name),
            quantity: item.moq * item.quantityMultiplier,
            unit_price: getLevelPrice(item, activeLevel),
            level_a_price: item.levelPrices.A,
            level_b_price: item.levelPrices.B,
            level_c_price: item.levelPrices.C,
            moq: item.moq,
            stock_snapshot: item.stock,
            confidence: 100,
          })),
        }),
      });
      if (response.ok) {
        const data = await response.json();
        order = data.order;
      }
    } catch {
      // Local fallback below.
    }
    upsertPortalOrderRecord(order, workspace.id);
    await loadOrders();
    setNotice(`${order.orderNumber} sent to ${brandName} for approval.`);
    setCart([]);
  }

  async function payOrder(order: PortalOrderSnapshot) {
    let paid = payPortalOrder(order);
    try {
      const response = await fetch(`/api/orders/${order.shareToken}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_status: "paid",
          payment_method: "card",
          amount_paid: order.totalValue,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        paid = data.order;
      }
    } catch {
      // Local fallback below.
    }
    upsertPortalOrderRecord(paid, workspace.id);
    await loadOrders();
    setNotice(`${order.orderNumber} payment submitted. The brand control panel now shows paid.`);
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader title="Distributor Portal" subtitle="Approved catalog, negotiated pricing and contextual product questions." />
      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[1fr_360px]">
        <section>
          <div className="mb-5 rounded-[8px] bg-slate-950 p-8 text-white">
            <p className="text-sm text-blue-100">{distributorName} / {levelDetails[activeLevel].label} / Net 30</p>
            <h1 className="mt-2 text-3xl font-bold">Order approved products from {brandName}</h1>
            <p className="mt-2 text-sm text-slate-300">{levelDetails[activeLevel].description}</p>
          </div>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {demoProducts.map((product) => {
              const levelPrice = getLevelPrice(product, activeLevel);
              const delta = getPriceDelta(product, activeLevel);
              return (
              <Card key={product.id}>
                <div className="mb-3 flex items-center justify-between"><span className="text-sm text-slate-500">{product.category}</span><StatusBadge status={product.status} /></div>
                <h3 className="font-bold">{product.name}</h3>
                <p className="text-sm text-slate-500">SKU: {product.sku}</p>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-slate-400">{levelDetails[activeLevel].label}</p><p className="font-bold">${levelPrice.toFixed(2)}</p></div>
                  <div><p className="text-slate-400">Vs Level B</p><p className={delta < 0 ? "font-bold text-emerald-700" : "font-bold text-amber-700"}>{delta === 0 ? "$0.00" : `${delta > 0 ? "+" : "-"}$${Math.abs(delta).toFixed(2)}`}</p></div>
                  <div><p className="text-slate-400">MOQ</p><p className="font-bold">{product.moq}</p></div>
                  <div><p className="text-slate-400">Stock</p><p className="font-bold">{product.stock}</p></div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button disabled={product.stock <= 0} onClick={() => addToCart(product)} className="rounded-[8px] bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-300">Add</button>
                  <button className="rounded-[8px] border border-slate-200 px-4 py-3 text-sm font-semibold">Ask Brand</button>
                </div>
              </Card>
              );
            })}
          </div>
        </section>

        <aside className="space-y-5">
          <Card>
            <h2 className="mb-4 font-bold">PO Cart</h2>
            {cart.length === 0 ? <p className="text-sm text-slate-500">Add products to build an order.</p> : (
              <div className="space-y-3">
                {cart.map((item) => <div key={item.id} className="border-b border-slate-100 pb-3 text-sm"><p className="font-semibold">{item.name}</p><p className="text-slate-500">MOQ {item.moq} x {item.quantityMultiplier} / ${getLevelPrice(item, activeLevel).toFixed(2)} each</p></div>)}
                <div className="flex justify-between font-bold"><span>Total</span><span>${total.toLocaleString()}</span></div>
                <button onClick={submitPo} className="inline-flex rounded-[8px] bg-blue-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-800">Submit PO</button>
              </div>
            )}
            {notice && <div className="mt-4 rounded-[8px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div>}
          </Card>
          {paymentOrder && (
            <Card>
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-bold">Payment requested</h2>
                <StatusBadge status="Submitted" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <ReadBox label="Order" value={paymentOrder.orderNumber} />
                <ReadBox label="Due" value={paymentOrder.paymentDueDate ? new Date(paymentOrder.paymentDueDate).toLocaleDateString() : "Net terms"} />
                <ReadBox label="Amount due" value={`$${paymentOrder.outstandingAmount.toFixed(2)}`} />
                <ReadBox label="Method" value="Demo payment" />
              </div>
              <button onClick={() => payOrder(paymentOrder)} className="mt-4 w-full rounded-[8px] bg-slate-950 px-4 py-3 text-sm font-semibold text-white">Pay now</button>
            </Card>
          )}
          <Card>
            <h2 className="mb-4 font-bold">My Messages</h2>
            <div className="space-y-3">{demoThreads.map((thread) => <div key={thread.id} className="rounded-[8px] bg-slate-50 p-4 text-sm"><p className="font-semibold">{thread.topic}</p><p className="text-slate-500">{thread.context}</p></div>)}</div>
          </Card>
          <Card>
            <h2 className="mb-4 font-bold">My Orders</h2>
            <div className="space-y-3">
              {distributorOrders.map((order) => (
                <div key={order.shareToken || order.id} className="rounded-[8px] bg-slate-50 p-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{order.orderNumber}</p>
                    <StatusBadge status={order.paymentStatus === "paid" ? "Delivered" : order.status === "po_requested" ? "Submitted" : "Confirmed"} />
                  </div>
                  <p className="mt-1 text-slate-500">${order.totalValue.toLocaleString()} / {paymentStatusLabel(order.paymentStatus)}</p>
                </div>
              ))}
              {demoOrders.filter((order) => order.distributor === "EuroTrade GmbH" || order.distributor === distributorName).map((order) => <div key={order.id} className="rounded-[8px] bg-slate-50 p-4 text-sm"><div className="flex items-center justify-between"><p className="font-semibold">{order.id}</p><StatusBadge status={order.status} /></div></div>)}
            </div>
          </Card>
        </aside>
      </div>
    </main>
  );
}

function ReadBox({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[8px] bg-slate-50 p-3 ring-1 ring-slate-200">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-bold">{value}</p>
    </div>
  );
}

function paymentStatusLabel(status: PortalOrderSnapshot["paymentStatus"]) {
  const labels: Record<PortalOrderSnapshot["paymentStatus"], string> = {
    unpaid: "Unpaid",
    requested: "Payment requested",
    paid: "Paid",
    partial: "Partial",
    overdue: "Overdue",
  };
  return labels[status];
}
