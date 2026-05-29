"use client";

import { useMemo, useState } from "react";
import { AppHeader, Button, Card, StatusBadge } from "@/components/ui";
import { demoOrders, demoProducts, demoThreads } from "@/lib/mock-data";
import { getLevelPrice, getPriceDelta, levelDetails, type DistributorLevel } from "@/lib/commercial-demo";

type CartItem = typeof demoProducts[number] & { quantityMultiplier: number };
const portalLevel: DistributorLevel = "A";

export default function PortalPage() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const total = useMemo(() => cart.reduce((sum, item) => sum + getLevelPrice(item, portalLevel) * item.moq * item.quantityMultiplier, 0), [cart]);

  function addToCart(product: typeof demoProducts[number]) {
    if (product.stock <= 0) return;
    setCart((prev) => {
      const found = prev.find((item) => item.id === product.id);
      if (found) return prev.map((item) => item.id === product.id ? { ...item, quantityMultiplier: item.quantityMultiplier + 1 } : item);
      return [...prev, { ...product, quantityMultiplier: 1 }];
    });
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader title="Distributor Portal" subtitle="Approved catalog, negotiated pricing and contextual product questions." />
      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[1fr_360px]">
        <section>
          <div className="mb-5 rounded-[8px] bg-slate-950 p-8 text-white">
            <p className="text-sm text-blue-100">EuroTrade GmbH / {levelDetails[portalLevel].label} / Net 30</p>
            <h1 className="mt-2 text-3xl font-bold">Order approved products from Nimbus Home Goods</h1>
            <p className="mt-2 text-sm text-slate-300">{levelDetails[portalLevel].description}</p>
          </div>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {demoProducts.map((product) => {
              const levelPrice = getLevelPrice(product, portalLevel);
              const delta = getPriceDelta(product, portalLevel);
              return (
              <Card key={product.id}>
                <div className="mb-3 flex items-center justify-between"><span className="text-sm text-slate-500">{product.category}</span><StatusBadge status={product.status} /></div>
                <h3 className="font-bold">{product.name}</h3>
                <p className="text-sm text-slate-500">SKU: {product.sku}</p>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-slate-400">{levelDetails[portalLevel].label}</p><p className="font-bold">${levelPrice.toFixed(2)}</p></div>
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
                {cart.map((item) => <div key={item.id} className="border-b border-slate-100 pb-3 text-sm"><p className="font-semibold">{item.name}</p><p className="text-slate-500">MOQ {item.moq} x {item.quantityMultiplier} / ${getLevelPrice(item, portalLevel).toFixed(2)} each</p></div>)}
                <div className="flex justify-between font-bold"><span>Total</span><span>${total.toLocaleString()}</span></div>
                <Button>Submit PO</Button>
              </div>
            )}
          </Card>
          <Card>
            <h2 className="mb-4 font-bold">My Messages</h2>
            <div className="space-y-3">{demoThreads.map((thread) => <div key={thread.id} className="rounded-[8px] bg-slate-50 p-4 text-sm"><p className="font-semibold">{thread.topic}</p><p className="text-slate-500">{thread.context}</p></div>)}</div>
          </Card>
          <Card>
            <h2 className="mb-4 font-bold">My Orders</h2>
            <div className="space-y-3">{demoOrders.filter((order) => order.distributor === "EuroTrade GmbH").map((order) => <div key={order.id} className="rounded-[8px] bg-slate-50 p-4 text-sm"><div className="flex items-center justify-between"><p className="font-semibold">{order.id}</p><StatusBadge status={order.status} /></div></div>)}</div>
          </Card>
        </aside>
      </div>
    </main>
  );
}
