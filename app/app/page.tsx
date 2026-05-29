"use client";

import { useEffect, useMemo, useState } from "react";
import { demoOrders, demoProducts, demoThreads } from "@/lib/mock-data";
import { readApiError } from "@/lib/api/errors";
import { calculateChannelAnalytics, type AnalyticsOrder } from "@/lib/analytics/channel";
import { parseCatalogOrder } from "@/lib/catalog/parser";
import {
  fromDemoProduct,
  normalizeCatalogProduct,
  validateCatalogProduct,
  type CatalogProduct,
  type CatalogProductInput,
} from "@/lib/catalog/products";
import {
  demoDistributors,
  getLevelPrice,
  getPriceDelta,
  levelDetails,
  type DemoDistributor,
  type DistributorLevel,
  type SourceChannel,
} from "@/lib/commercial-demo";
import { applyOrderPaymentUpdate } from "@/lib/orders/payment";
import type { PaymentMethod, PaymentStatus } from "@/lib/payments/status";

type Product = CatalogProduct;
type OrderItem = Product & {
  requestedName: string;
  qty: number;
  confidence: number;
  levelPrice: number;
  standardPrice: number;
  priceDelta: number;
  matchedAlias?: string;
  extractedPhrase?: string;
  needsReview?: boolean;
};
type CartItem = Product & { qty: number };
type WorkspaceStatus = "idle" | "parsing" | "ready" | "confirmed" | "shared" | "distributor_confirmed";
type ViewMode = "control" | "portal" | "launch";
type BadgeTone = "slate" | "blue" | "emerald" | "amber" | "rose" | "violet";
type SourceRecord = {
  id: string;
  channel: SourceChannel;
  originalMessage: string;
  capturedAt: string;
};
type PersistedOrderEvent = {
  id?: string;
  eventType: string;
  label: string;
  createdAt?: string;
};
type PersistedOrderItem = {
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
type PersistedOrder = {
  id?: string;
  orderNumber: string;
  orderId: string;
  distributorId: string;
  distributorName: string;
  distributorLevel: DistributorLevel;
  sourceChannel: SourceChannel;
  originalMessage: string;
  status: "draft" | "approved" | "link_created" | "distributor_confirmed" | "cancelled";
  shareToken: string;
  token: string;
  totalValue: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  paymentDueDate?: string | null;
  amountPaid: number;
  outstandingAmount: number;
  createdAt?: string;
  items: PersistedOrderItem[];
  events: PersistedOrderEvent[];
};
type ProductFormState = {
  sku: string;
  name: string;
  category: string;
  moq: string;
  stock: string;
  level_a_price: string;
  level_b_price: string;
  level_c_price: string;
  aliases: string;
  lead_time: string;
};
type CatalogImportSource = "manual" | "csv" | "xlsx";
type CatalogImportSummary = {
  rowsImported: number;
  rowsFailed: number;
  errors: string[];
};
type ActionLoading =
  | "generate"
  | "approve"
  | "createLink"
  | "confirmDistributor"
  | "requestPayment"
  | "markPaid"
  | "demoReset"
  | null;

const sampleMessage =
  "Hi, can you send 120 pcs of HydraGo Stainless Bottle and 30 pcs of AeroClean Smart Air Purifier next week? Use our approved Level A pricing.";

const launchTasks = [
  { name: "Import product catalog", owner: "Distributor OS", status: "Done" },
  { name: "Map Level A, B, and C price books", owner: "Brand ops", status: "Done" },
  { name: "Invite first 5 distributors", owner: "Sales lead", status: "In progress" },
  { name: "Approve payment and order terms", owner: "Finance", status: "Review" },
  { name: "Run first weekly channel review", owner: "Account team", status: "Next" },
];

const workflowSteps = [
  "Paste message",
  "Generate draft",
  "Review pricing/MOQ/stock",
  "Approve",
  "Create distributor link",
];

const initialCatalogProducts = demoProducts.map((product) => fromDemoProduct(product));

const emptyProductForm: ProductFormState = {
  sku: "",
  name: "",
  category: "",
  moq: "",
  stock: "",
  level_a_price: "",
  level_b_price: "",
  level_c_price: "",
  aliases: "",
  lead_time: "",
};

export default function BrandAppPage() {
  const [view, setView] = useState<ViewMode>("control");
  const [message, setMessage] = useState(sampleMessage);
  const [sourceChannel, setSourceChannel] = useState<SourceChannel>("WhatsApp");
  const [sourceRecord, setSourceRecord] = useState<SourceRecord | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [status, setStatus] = useState<WorkspaceStatus>("idle");
  const [toast, setToast] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [sharedOrderToken, setSharedOrderToken] = useState("");
  const [savedOrder, setSavedOrder] = useState<PersistedOrder | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [distributors, setDistributors] = useState<DemoDistributor[]>(demoDistributors);
  const [selectedDistributorId, setSelectedDistributorId] = useState(demoDistributors[0].id);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>(initialCatalogProducts);
  const [catalogSaveStatus, setCatalogSaveStatus] = useState("Demo catalog loaded");
  const [draftOrder, setDraftOrder] = useState<PersistedOrder | null>(null);
  const [orderRecords, setOrderRecords] = useState<PersistedOrder[]>([]);
  const [auditEvents, setAuditEvents] = useState<PersistedOrderEvent[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [loadingAction, setLoadingAction] = useState<ActionLoading>(null);

  const selectedDistributor =
    distributors.find((distributor) => distributor.id === selectedDistributorId) || distributors[0];
  const selectedLevel = selectedDistributor.level;

  const orderValue = useMemo(
    () => items.reduce((sum, item) => sum + item.qty * item.levelPrice, 0),
    [items]
  );
  const riskCount = useMemo(
    () => items.filter((item) => item.qty < item.moq || item.qty > item.stock).length,
    [items]
  );
  const cartValue = useMemo(
    () => cart.reduce((sum, item) => sum + item.qty * getLevelPrice(item, selectedLevel), 0),
    [cart, selectedLevel]
  );
  const cartUnits = useMemo(
    () => cart.reduce((sum, item) => sum + item.qty, 0),
    [cart]
  );
  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return catalogProducts;
    return catalogProducts.filter((product) =>
      [product.name, product.sku, product.category].some((value) => value.toLowerCase().includes(query))
    );
  }, [catalogProducts, search]);

  useEffect(() => {
    loadCatalogProducts();
    loadOrderRecords();
  }, []);

  useEffect(() => {
    syncConfirmedOrder();
    window.addEventListener("storage", syncConfirmedOrder);
    window.addEventListener("focus", syncConfirmedOrder);
    return () => {
      window.removeEventListener("storage", syncConfirmedOrder);
      window.removeEventListener("focus", syncConfirmedOrder);
    };
  }, [sharedOrderToken]);

  async function loadCatalogProducts() {
    const localCatalog = window.localStorage.getItem("distributor-os-product-catalog");
    if (localCatalog) {
      try {
        const parsed = JSON.parse(localCatalog) as Product[];
        if (parsed.length) {
          setCatalogProducts(parsed);
          setCatalogSaveStatus("Loaded from local catalog storage");
        }
      } catch {
        setCatalogSaveStatus("Demo catalog loaded");
      }
    }

    try {
      const response = await fetch("/api/catalog", { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 503) {
          setCatalogSaveStatus("Supabase env vars missing; using local/demo catalog.");
          return;
        }
        setCatalogSaveStatus(`Catalog load failed: ${await readApiError(response, "Unable to load product catalog")}`);
        return;
      }
      const data = await response.json();
      if (Array.isArray(data.products) && data.products.length) {
        setCatalogProducts(data.products);
        window.localStorage.setItem("distributor-os-product-catalog", JSON.stringify(data.products));
        setCatalogSaveStatus("Loaded from Supabase product catalog");
      }
    } catch {
      setCatalogSaveStatus("Catalog API unavailable; using local/demo catalog.");
    }
  }

  async function saveCatalogProducts(nextProducts: Product[], source: CatalogImportSource) {
    setErrorMessage("");
    setCatalogProducts(nextProducts);
    window.localStorage.setItem("distributor-os-product-catalog", JSON.stringify(nextProducts));
    const sourceLabel = source === "xlsx" ? "XLSX" : source === "csv" ? "CSV" : "Product";
    setCatalogSaveStatus(`${sourceLabel} catalog saved locally`);
    appendAuditEvent("product_imported", `${sourceLabel} product catalog imported`);

    try {
      const response = await fetch("/api/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: nextProducts }),
      });
      if (response.ok) {
        setCatalogSaveStatus(`${sourceLabel} catalog saved to Supabase`);
        return;
      }
      const error = await readApiError(response, "Catalog save failed");
      if (response.status === 503) {
        setCatalogSaveStatus(`${sourceLabel} catalog saved locally. Supabase env vars are missing.`);
      } else {
        setCatalogSaveStatus(`${sourceLabel} catalog saved locally. Supabase save failed.`);
        setErrorMessage(`Failed product upload: ${error}`);
      }
    } catch {
      setCatalogSaveStatus(`${sourceLabel} catalog saved locally. Catalog API unavailable.`);
    }
  }

  function loadOrderRecords() {
    const records: PersistedOrder[] = [];
    const raw = window.localStorage.getItem("distributor-os-order-records");
    if (raw) {
      try {
        records.push(...(JSON.parse(raw) as any[]).map(normalizePersistedOrder));
      } catch {
        window.localStorage.removeItem("distributor-os-order-records");
      }
    }

    records.push(...readLocalSharedOrders());
    const parsed = mergeLocalOrderSnapshots(records);
    if (!parsed.length) return;
    setOrderRecords(parsed);
    window.localStorage.setItem("distributor-os-order-records", JSON.stringify(parsed));
    const current = parsed.find((order) => order.status === "link_created" || order.status === "distributor_confirmed") || parsed[0];
    if (current) {
      setDraftOrder(current);
      if (current.status === "link_created" || current.status === "distributor_confirmed") {
        setSavedOrder(current);
        setSharedOrderToken(current.shareToken);
        setShareLink(`${window.location.origin}/order/${current.shareToken}`);
        setStatus(current.status === "distributor_confirmed" ? "distributor_confirmed" : "shared");
      }
    }
  }

  function upsertOrderRecord(order: PersistedOrder) {
    try {
      window.localStorage.setItem(`distributor-os-shared-order-${order.shareToken}`, JSON.stringify(order));
    } catch {
      // Local storage can be unavailable in private browsing; keep React state working.
    }
    setOrderRecords((current) => {
      const next = mergeLocalOrderSnapshots([
        order,
        ...current.filter((item) => item.shareToken !== order.shareToken && item.id !== order.id),
      ]);
      window.localStorage.setItem("distributor-os-order-records", JSON.stringify(next));
      return next;
    });
  }

  function appendAuditEvent(eventType: string, label: string) {
    const event = { eventType, label, createdAt: new Date().toISOString() };
    setAuditEvents((current) => [event, ...current].slice(0, 12));
    return event;
  }

  async function syncConfirmedOrder() {
    if (!sharedOrderToken) return;

    try {
      const response = await fetch(`/api/orders/${sharedOrderToken}`, { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        const persisted = normalizePersistedOrder(data.order);
        setSavedOrder(persisted);
        setDraftOrder(persisted);
        upsertOrderRecord(persisted);
        if (persisted.status === "distributor_confirmed") {
          setStatus("distributor_confirmed");
          setToast("Distributor confirmed the saved order link.");
        }
        return;
      }
    } catch {
      // Fall back to the local mock order below when Supabase is not configured.
    }

    const localSharedOrder = readLocalSharedOrder(sharedOrderToken);
    if (localSharedOrder) {
      setSavedOrder(localSharedOrder);
      setDraftOrder(localSharedOrder);
      upsertOrderRecord(localSharedOrder);
      if (localSharedOrder.status === "distributor_confirmed") {
        setStatus("distributor_confirmed");
      }
      return;
    }

    const raw = window.localStorage.getItem("distributor-os-confirmed-order");
    if (!raw) return;
    try {
      const confirmed = JSON.parse(raw) as { token?: string; status?: string };
      if (confirmed.token === sharedOrderToken && confirmed.status === "Distributor Confirmed") {
        setStatus("distributor_confirmed");
        setSavedOrder((current) => {
          if (!current) return current;
          const next = appendOrderEvent({ ...current, status: "distributor_confirmed" }, "distributor_confirmed", "Distributor confirmed");
          setDraftOrder(next);
          upsertOrderRecord(next);
          return next;
        });
        setToast("Distributor confirmed the shared order link.");
      }
    } catch {
      // Ignore stale local mock data.
    }
  }

  function parseMessage() {
    if (!message.trim()) {
      setErrorMessage("Paste a WhatsApp or Telegram message before generating a draft.");
      return;
    }
    if (!catalogProducts.length) {
      setErrorMessage("Add or import products before generating a draft.");
      return;
    }

    setErrorMessage("");
    setLoadingAction("generate");
    setStatus("parsing");
    setToast(`Saving ${sourceChannel} message as the source record and matching SKUs.`);
    window.setTimeout(() => {
      const record = {
        id: `SRC-${Date.now().toString().slice(-6)}`,
        channel: sourceChannel,
        originalMessage: message,
        capturedAt: new Date().toLocaleString(),
      };
      const parsed = parseOrder(message, selectedLevel, catalogProducts);
      setSourceRecord(record);
      setItems(parsed);
      const nextDraft = createWorkflowOrder({
        token: `DRAFT-${Date.now().toString().slice(-6)}`,
        status: "draft",
        selectedDistributor,
        selectedLevel,
        sourceRecord: record,
        items: parsed,
        orderValue: calculateOrderValue(parsed),
        events: [
          { eventType: "message_pasted", label: "Message pasted", createdAt: new Date().toISOString() },
          { eventType: "draft_generated", label: "Draft generated", createdAt: new Date().toISOString() },
        ],
      });
      setDraftOrder(nextDraft);
      upsertOrderRecord(nextDraft);
      setStatus("ready");
      setLoadingAction(null);
      setToast(parsed.length ? "Order draft is ready with source transparency and tier pricing." : "No SKU match found. Add aliases or review manually.");
    }, 450);
  }

  function updateItemQty(id: string, value: string) {
    const nextValue = Number(value);
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, qty: Number.isNaN(nextValue) ? 0 : nextValue } : item))
    );
  }

  function confirmOrder() {
    if (!items.length) {
      setErrorMessage("Generate a draft with at least one matched SKU before approval.");
      return;
    }
    if (!sourceRecord) {
      setErrorMessage("Generate a source record before approval.");
      return;
    }

    setErrorMessage("");
    setLoadingAction("approve");
    const baseOrder = draftOrder && sourceRecord
      ? { ...draftOrder, status: "approved" as PersistedOrder["status"], totalValue: orderValue }
      : sourceRecord
        ? createWorkflowOrder({
            token: `DRAFT-${Date.now().toString().slice(-6)}`,
            status: "approved",
            selectedDistributor,
            selectedLevel,
            sourceRecord,
            items,
            orderValue,
          })
        : null;
    if (baseOrder) {
      const approved = appendOrderEvent(baseOrder, "brand_approved", "Brand approved");
      setDraftOrder(approved);
      upsertOrderRecord(approved);
    }
    setStatus("confirmed");
    setLoadingAction(null);
    setToast("Brand approved the order. Create a distributor review link next.");
  }

  async function createLink() {
    if (!items.length || !sourceRecord) {
      setErrorMessage("Generate an order with a source record before creating a distributor link.");
      return;
    }

    setErrorMessage("");
    setLoadingAction("createLink");
    const payload = {
      distributor_id: selectedDistributor.id,
      distributor_name: selectedDistributor.name,
      distributor_level: selectedLevel,
      source_channel: sourceRecord.channel,
      original_message: sourceRecord.originalMessage,
      total_value: orderValue,
      items: items.map((item) => ({
        product_id: item.id,
        product_name: item.name,
        sku: item.sku,
        quantity: item.qty,
        unit_price: item.levelPrice,
        level_a_price: item.levelPrices.A,
        level_b_price: item.levelPrices.B,
        level_c_price: item.levelPrices.C,
        moq: item.moq,
        stock_snapshot: item.stock,
        confidence: item.confidence,
      })),
    };

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await readApiError(response, "Order creation failed");
        if (response.status !== 503) {
          setErrorMessage(`Failed order creation: ${error}`);
          setToast("Order link was not created. Review the error and try again.");
          return;
        }
        throw new Error(error);
      }

      const data = await response.json();
      const persisted = normalizePersistedOrder(data.order);
      const nextShareLink = `${window.location.origin}/order/${persisted.shareToken}`;
      setSavedOrder(persisted);
      setDraftOrder(persisted);
      upsertOrderRecord(persisted);
      setSharedOrderToken(persisted.shareToken);
      setShareLink(nextShareLink);
      setStatus("shared");
      setToast("Saved order to Supabase and created distributor review link.");
      return;
    } catch {
      const token = `ORD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const fallbackOrder = createFallbackOrder({
        token,
        selectedDistributor,
        selectedLevel,
        sourceRecord,
        items,
        orderValue,
      });
      const nextShareLink = `${window.location.origin}/order/${token}`;
      window.localStorage.setItem(`distributor-os-shared-order-${token}`, JSON.stringify(fallbackOrder));
      setSavedOrder(fallbackOrder);
      setDraftOrder(fallbackOrder);
      upsertOrderRecord(fallbackOrder);
      setSharedOrderToken(token);
      setShareLink(nextShareLink);
      setStatus("shared");
      setToast("Supabase is not configured locally, so this preview saved the order in browser storage.");
    } finally {
      setLoadingAction(null);
    }
  }

  function addToCart(product: Product) {
    if (product.stock <= 0) {
      setToast(`${product.name} is out of stock.`);
      return;
    }
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (existing) return current.map((item) => (item.id === product.id ? { ...item, qty: item.qty + product.moq } : item));
      return [...current, { ...product, qty: product.moq }];
    });
    setToast(`${product.name} added at ${levelDetails[selectedLevel].label} price.`);
  }

  function changeDistributorLevel(distributorId: string, level: DistributorLevel) {
    setDistributors((current) =>
      current.map((distributor) => (distributor.id === distributorId ? { ...distributor, level } : distributor))
    );
    if (distributorId === selectedDistributorId) {
      setItems((current) => current.map((item) => applyLevelPrice(item, level)));
      setToast(`${levelDetails[level].label} pricing applied to ${selectedDistributor.name}.`);
    }
  }

  function runDemoFlow() {
    setErrorMessage("");
    const demoCatalog = initialCatalogProducts;
    const demoDistributor = { ...demoDistributors[0], level: "A" as DistributorLevel };
    const demoDistributorsWithLevel = demoDistributors.map((distributor) =>
      distributor.id === demoDistributor.id ? demoDistributor : distributor
    );
    const demoMessage = sampleMessage;
    const demoSourceRecord = {
      id: `SRC-${Date.now().toString().slice(-6)}`,
      channel: "WhatsApp" as SourceChannel,
      originalMessage: demoMessage,
      capturedAt: new Date().toLocaleString(),
    };
    const demoItems = parseOrder(demoMessage, "A", demoCatalog);
    const demoOrderValue = calculateOrderValue(demoItems);
    const token = `ORD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const demoOrder = createWorkflowOrder({
      token,
      status: "link_created",
      selectedDistributor: demoDistributor,
      selectedLevel: "A",
      sourceRecord: demoSourceRecord,
      items: demoItems,
      orderValue: demoOrderValue,
      events: [
        { eventType: "product_imported", label: "Demo catalog loaded", createdAt: new Date().toISOString() },
        { eventType: "message_pasted", label: "Message pasted", createdAt: new Date().toISOString() },
        { eventType: "draft_generated", label: "Draft generated", createdAt: new Date().toISOString() },
        { eventType: "brand_approved", label: "Brand approved", createdAt: new Date().toISOString() },
        { eventType: "link_created", label: "Link created", createdAt: new Date().toISOString() },
      ],
    });

    setCatalogProducts(demoCatalog);
    window.localStorage.setItem("distributor-os-product-catalog", JSON.stringify(demoCatalog));
    setCatalogSaveStatus("Demo catalog loaded");
    setDistributors(demoDistributorsWithLevel);
    setSelectedDistributorId(demoDistributor.id);
    setSourceChannel("WhatsApp");
    setMessage(demoMessage);
    setSourceRecord(demoSourceRecord);
    setItems(demoItems);
    setDraftOrder(demoOrder);
    setSavedOrder(demoOrder);
    setSharedOrderToken(token);
    setShareLink(`${window.location.origin}/order/${token}`);
    setStatus("shared");
    setView("control");
    window.localStorage.setItem(`distributor-os-shared-order-${token}`, JSON.stringify(demoOrder));
    upsertOrderRecord(demoOrder);
    setAuditEvents(demoOrder.events);
    setToast("Demo flow loaded: catalog, EuroTrade Level A, WhatsApp draft, approval, and pending confirmation link.");
  }

  function resetAndSeedDemoData() {
    setLoadingAction("demoReset");
    setErrorMessage("");
    clearLocalDemoState();
    const seededOrders = createSeedDemoOrderRecords();
    const firstOrder = seededOrders[0] || null;

    setView("control");
    setCatalogProducts(initialCatalogProducts);
    setCatalogSaveStatus("Demo catalog loaded");
    setDistributors(demoDistributors);
    setSelectedDistributorId(demoDistributors[0].id);
    setMessage(sampleMessage);
    setSourceChannel("WhatsApp");
    setSourceRecord(null);
    setItems([]);
    setCart([]);
    setSearch("");
    setDraftOrder(firstOrder);
    setSavedOrder(firstOrder);
    setOrderRecords(seededOrders);
    setAuditEvents([]);
    setStatus(firstOrder ? "shared" : "idle");
    setSharedOrderToken(firstOrder?.shareToken || "");
    setShareLink(firstOrder ? `${window.location.origin}/order/${firstOrder.shareToken}` : "");

    window.localStorage.setItem("distributor-os-product-catalog", JSON.stringify(initialCatalogProducts));
    window.localStorage.setItem("distributor-os-order-records", JSON.stringify(seededOrders));
    seededOrders.forEach((order) => {
      window.localStorage.setItem(`distributor-os-shared-order-${order.shareToken}`, JSON.stringify(order));
    });

    setLoadingAction(null);
    setToast("Demo data reset: products, distributors, and demo orders are seeded.");
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] text-slate-950">
      <div className="flex min-h-screen">
        <aside className="hidden w-[272px] shrink-0 border-r border-slate-200 bg-white p-5 lg:block">
          <div className="mb-8">
            <p className="text-lg font-bold">Distributor OS</p>
            <p className="text-xs text-slate-500">Brand operations cockpit</p>
          </div>
          <nav className="space-y-2">
            <NavButton active={view === "control"} onClick={() => setView("control")} label="Control Center" />
            <NavButton active={view === "portal"} onClick={() => setView("portal")} label="Distributor Portal" />
            <NavButton active={view === "launch"} onClick={() => setView("launch")} label="Pilot Launch" />
          </nav>
          <div className="mt-8 rounded-[8px] border border-blue-100 bg-blue-50 p-4">
            <p className="font-semibold text-blue-950">Commercial pilot</p>
            <p className="mt-2 text-sm leading-6 text-blue-800">
              Demo the exact brand service: tier pricing, message source records, order links, confirmation, and distributor buying.
            </p>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="border-b border-slate-200 bg-white px-6 py-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-sm text-slate-500">Nimbus Home Goods / {selectedDistributor.name}</p>
                <h1 className="text-2xl font-bold">{viewTitle(view)}</h1>
              </div>
              <div className="flex flex-wrap gap-2">
                <TopButton active={view === "control"} onClick={() => setView("control")}>Control</TopButton>
                <TopButton active={view === "portal"} onClick={() => setView("portal")}>Portal</TopButton>
                <TopButton active={view === "launch"} onClick={() => setView("launch")}>Launch</TopButton>
              </div>
            </div>
          </header>

          {toast && (
            <div className="px-6 pt-4">
              <div className="rounded-[8px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                {toast}
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="px-6 pt-4">
              <div className="rounded-[8px] border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800 shadow-sm">
                {errorMessage}
              </div>
            </div>
          )}

          {view === "control" && (
            <ControlCenter
              message={message}
              setMessage={setMessage}
              sourceChannel={sourceChannel}
              setSourceChannel={setSourceChannel}
              sourceRecord={sourceRecord}
              parseMessage={parseMessage}
              items={items}
              status={status}
              updateItemQty={updateItemQty}
              confirmOrder={confirmOrder}
              createLink={createLink}
              shareLink={shareLink}
              sharedOrderToken={sharedOrderToken}
              savedOrder={savedOrder}
              orderValue={orderValue}
              riskCount={riskCount}
              showPortal={() => setView("portal")}
              distributors={distributors}
              selectedDistributor={selectedDistributor}
              setSelectedDistributorId={setSelectedDistributorId}
              changeDistributorLevel={changeDistributorLevel}
              catalogProducts={catalogProducts}
              saveCatalogProducts={saveCatalogProducts}
              catalogSaveStatus={catalogSaveStatus}
              orderRecords={orderRecords}
              auditEvents={auditEvents}
              requestPayment={() => updateOrderPayment(sharedOrderToken, "requested", savedOrder, setSavedOrder, setDraftOrder, upsertOrderRecord, setToast, setErrorMessage, setLoadingAction)}
              markPaid={() => updateOrderPayment(sharedOrderToken, "paid", savedOrder, setSavedOrder, setDraftOrder, upsertOrderRecord, setToast, setErrorMessage, setLoadingAction)}
              runDemoFlow={runDemoFlow}
              resetAndSeedDemoData={resetAndSeedDemoData}
              loadingAction={loadingAction}
            />
          )}

          {view === "portal" && (
            <DistributorPortal
              products={filteredProducts}
              search={search}
              setSearch={setSearch}
              addToCart={addToCart}
              cart={cart}
              setCart={setCart}
              cartUnits={cartUnits}
              cartValue={cartValue}
              items={items}
              status={status}
              sourceRecord={sourceRecord}
              selectedDistributor={selectedDistributor}
              selectedLevel={selectedLevel}
              confirmSharedOrder={() => {
                confirmOrderFromPortal(sharedOrderToken, setSavedOrder, setDraftOrder, upsertOrderRecord, setStatus, setToast, setErrorMessage, setLoadingAction);
              }}
              confirmLoading={loadingAction === "confirmDistributor"}
              orderRecords={orderRecords}
            />
          )}

          {view === "launch" && <PilotLaunch />}
        </section>
      </div>
    </main>
  );
}

function ControlCenter({
  message,
  setMessage,
  sourceChannel,
  setSourceChannel,
  sourceRecord,
  parseMessage,
  items,
  status,
  updateItemQty,
  confirmOrder,
  createLink,
  shareLink,
  sharedOrderToken,
  savedOrder,
  orderValue,
  riskCount,
  showPortal,
  distributors,
  selectedDistributor,
  setSelectedDistributorId,
  changeDistributorLevel,
  catalogProducts,
  saveCatalogProducts,
  catalogSaveStatus,
  orderRecords,
  auditEvents,
  requestPayment,
  markPaid,
  runDemoFlow,
  resetAndSeedDemoData,
  loadingAction,
}: {
  message: string;
  setMessage: (value: string) => void;
  sourceChannel: SourceChannel;
  setSourceChannel: (value: SourceChannel) => void;
  sourceRecord: SourceRecord | null;
  parseMessage: () => void;
  items: OrderItem[];
  status: WorkspaceStatus;
  updateItemQty: (id: string, value: string) => void;
  confirmOrder: () => void;
  createLink: () => void;
  shareLink: string;
  sharedOrderToken: string;
  savedOrder: PersistedOrder | null;
  orderValue: number;
  riskCount: number;
  showPortal: () => void;
  distributors: DemoDistributor[];
  selectedDistributor: DemoDistributor;
  setSelectedDistributorId: (id: string) => void;
  changeDistributorLevel: (distributorId: string, level: DistributorLevel) => void;
  catalogProducts: Product[];
  saveCatalogProducts: (products: Product[], source: CatalogImportSource) => Promise<void>;
  catalogSaveStatus: string;
  orderRecords: PersistedOrder[];
  auditEvents: PersistedOrderEvent[];
  requestPayment: () => void;
  markPaid: () => void;
  runDemoFlow: () => void;
  resetAndSeedDemoData: () => void;
  loadingAction: ActionLoading;
}) {
  const [copyLabel, setCopyLabel] = useState("Copy Link");
  const savingsVsB = calculateComparisonValue(items, selectedDistributor.level, "B", catalogProducts);
  const savingsVsC = calculateComparisonValue(items, selectedDistributor.level, "C", catalogProducts);
  const pendingCount = orderRecords.filter((order) => order.status === "link_created" || order.status === "approved").length;
  const analytics = useMemo(
    () => calculateChannelAnalytics({
      orders: buildAnalyticsOrders(orderRecords),
      products: catalogProducts,
    }),
    [catalogProducts, orderRecords]
  );
  const deliveryEstimate = detectDelivery(sourceRecord?.originalMessage || message);
  const shareOrderNumber = savedOrder?.orderNumber || (sharedOrderToken ? `DO-${sharedOrderToken.slice(-4)}` : "Draft order");
  const shareOrderValue = savedOrder?.totalValue ?? orderValue;
  const shareMessage = buildOrderShareMessage({
    distributorName: selectedDistributor.name,
    brandName: "Nimbus Home Goods",
    orderNumber: shareOrderNumber,
    orderValue: shareOrderValue,
    deliveryEstimate,
    shareLink,
  });
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;
  const telegramHref = `https://t.me/share/url?url=${encodeURIComponent(shareLink)}&text=${encodeURIComponent(shareMessage)}`;

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(shareLink);
    } catch {
      const field = document.createElement("textarea");
      field.value = shareLink;
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      document.body.removeChild(field);
    }

    setCopyLabel("Copied");
    window.setTimeout(() => setCopyLabel("Copy Link"), 1400);
  }

  return (
    <div className="grid gap-6 px-6 py-6 xl:grid-cols-[1fr_380px]">
      <section className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          <Stat label="Monthly portal GMV" value="$186K" helper="+28% vs email orders" />
          <Stat label="Pricing level" value={levelDetails[selectedDistributor.level].label} helper={selectedDistributor.name} />
          <Stat label="Open risk flags" value={String(riskCount)} helper={riskCount ? "Review before sharing" : "No current issues"} />
          <Stat label="Draft value" value={`$${orderValue.toFixed(0)}`} helper="Tier-priced order value" />
        </div>

        <WorkflowStrip status={status} hasItems={items.length > 0} hasLink={Boolean(shareLink)} />

        <Panel>
          <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div>
              <h2 className="text-xl font-bold">WhatsApp and Telegram intake</h2>
              <p className="text-sm text-slate-500">Paste the original distributor message. It stays attached to the generated order.</p>
            </div>
            <div className="flex gap-2">
              <ActionButton onClick={runDemoFlow}>Run Demo Flow</ActionButton>
              <ActionButton onClick={resetAndSeedDemoData} loading={loadingAction === "demoReset"}>Demo Reset</ActionButton>
              <ActionButton onClick={parseMessage} tone="dark" loading={loadingAction === "generate"}>
                {loadingAction === "generate" ? "Generating..." : "Generate Draft"}
              </ActionButton>
              <ActionButton onClick={confirmOrder} disabled={!items.length} loading={loadingAction === "approve"}>
                {loadingAction === "approve" ? "Approving..." : "Approve"}
              </ActionButton>
              <ActionButton onClick={createLink} disabled={!items.length} loading={loadingAction === "createLink"}>
                {loadingAction === "createLink" ? "Creating..." : "Create Link"}
              </ActionButton>
            </div>
          </div>
          <div className="mb-3 grid gap-3 md:grid-cols-[180px_1fr]">
            <SelectField label="Source channel" value={sourceChannel} onChange={(value) => setSourceChannel(value as SourceChannel)}>
              <option value="WhatsApp">WhatsApp</option>
              <option value="Telegram">Telegram</option>
            </SelectField>
            <SelectField label="Distributor" value={selectedDistributor.id} onChange={setSelectedDistributorId}>
              {distributors.map((distributor) => (
                <option key={distributor.id} value={distributor.id}>
                  {distributor.name} / {levelDetails[distributor.level].label}
                </option>
              ))}
            </SelectField>
          </div>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            className="h-36 w-full resize-none rounded-[8px] border border-slate-200 bg-slate-50 p-4 text-sm leading-6 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
          />
        </Panel>

        <ProductCatalogSetup
          products={catalogProducts}
          onProductsChange={saveCatalogProducts}
          catalogSaveStatus={catalogSaveStatus}
        />

        <Panel>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">AI generated order card</h2>
              <p className="text-sm text-slate-500">Source-transparent draft with SKU match, level pricing, inventory checks, and confirmation status.</p>
            </div>
            <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>
          </div>

          {!!items.length && (
            <div className="mb-4 grid gap-3 rounded-[8px] border border-slate-200 bg-slate-50 p-4 md:grid-cols-4">
              <ReadField label="Distributor" value={selectedDistributor.name} />
              <ReadField label="Level" value={levelDetails[selectedDistributor.level].label} />
              <ReadField label="Total value" value={`$${orderValue.toFixed(2)}`} />
              <ReadField label="Risk status" value={<Badge tone={riskCount ? "amber" : "emerald"}>{riskCount ? "Review" : "Clean"}</Badge>} />
              <ReadField label="Payment status" value={<Badge tone={paymentTone(savedOrder?.paymentStatus || "unpaid")}>{paymentStatusLabel(savedOrder?.paymentStatus || "unpaid")}</Badge>} />
            </div>
          )}

          {sourceRecord && (
            <div className="mb-4 rounded-[8px] border border-blue-200 bg-blue-50 p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <ReadField label="Source record" value={sourceRecord.id} />
                <ReadField label="Channel" value={sourceRecord.channel} />
                <ReadField label="Captured" value={sourceRecord.capturedAt} />
              </div>
              <div className="mt-3 rounded-[8px] bg-white p-4 text-sm leading-6 text-slate-700 ring-1 ring-blue-100">
                {sourceRecord.originalMessage}
              </div>
            </div>
          )}

          {!items.length && <EmptyState text="Generate a draft to review the source record, parsed SKUs, MOQ, stock, confidence, and tier price." />}
          <div className="space-y-4">
            {items.map((item) => {
              const belowMoq = item.qty < item.moq;
              const overStock = item.qty > item.stock;
              const needsReview = belowMoq || overStock || Boolean(item.needsReview);
              return (
                <div key={item.id} className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-4 flex flex-col justify-between gap-2 md:flex-row md:items-start">
                    <div>
                      <p className="font-bold">{item.name}</p>
                      <p className="text-sm text-slate-500">Requested as {item.requestedName}</p>
                    </div>
                    <Badge tone={needsReview ? "amber" : "emerald"}>{needsReview ? "Needs review" : "Ready"}</Badge>
                  </div>
                  <div className="grid gap-3 md:grid-cols-4 2xl:grid-cols-8">
                    <ReadField label="Source" value={sourceRecord?.channel || sourceChannel} />
                    <ReadField label="Parsed SKU" value={item.sku} />
                    <EditField label="Quantity" value={item.qty} onChange={(value) => updateItemQty(item.id, value)} />
                    <ReadField label="Level A price" value={`$${item.levelPrices.A.toFixed(2)}`} />
                    <ReadField label="Level B price" value={`$${item.levelPrices.B.toFixed(2)}`} />
                    <ReadField label="Level C price" value={`$${item.levelPrices.C.toFixed(2)}`} />
                    <ReadField label="MOQ" value={item.moq} />
                    <ReadField label="Stock" value={item.stock} />
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-4">
                    <ReadField label={`${levelDetails[selectedDistributor.level].label} applied`} value={`$${item.levelPrice.toFixed(2)}`} />
                    <ReadField label="Savings vs B" value={<SavingsValue value={(item.levelPrices.B - item.levelPrice) * item.qty} />} />
                    <ReadField label="Savings vs C" value={<SavingsValue value={(item.levelPrices.C - item.levelPrice) * item.qty} />} />
                    <ReadField label="Confidence" value={`${item.confidence}%`} />
                    <ReadField label="Matched alias" value={item.matchedAlias || item.requestedName} />
                    <ReadField label="Lead time" value={item.lead_time} />
                  </div>
                  <div className="mt-3 flex items-center justify-between rounded-[8px] bg-white px-4 py-3 text-sm ring-1 ring-slate-200">
                    <span className="text-slate-500">Line total / risk</span>
                    <span className="font-bold">
                      ${(item.qty * item.levelPrice).toFixed(2)} / {needsReview ? "Needs review" : "Ready"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <AIChannelAnalyticsPanel analytics={analytics} />
      </section>

      <aside className="space-y-6">
        <Panel>
          <h2 className="font-bold">Distributor level management</h2>
          <p className="mt-1 text-sm text-slate-500">
            Brands can control margins and reward trusted distributors without rebuilding price sheets.
          </p>
          <div className="mt-4 grid gap-2 text-sm">
            <LevelRule level="A" text="Best price for trusted, high-volume distributors" />
            <LevelRule level="B" text="Standard approved distributor price" />
            <LevelRule level="C" text="Entry price for new or lower-volume accounts" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <ReadField label="Savings vs Level B" value={<SavingsValue value={savingsVsB} />} />
            <ReadField label="Savings vs Level C" value={<SavingsValue value={savingsVsC} />} />
          </div>
          <div className="mt-4 space-y-3">
            {distributors.map((distributor) => (
              <div key={distributor.id} className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{distributor.name}</p>
                    <p className="text-xs text-slate-500">{distributor.region} / {distributor.terms}</p>
                  </div>
                  <Badge tone={levelTone(distributor.level)}>{levelDetails[distributor.level].label}</Badge>
                </div>
                <select
                  value={distributor.level}
                  onChange={(event) => changeDistributorLevel(distributor.id, event.target.value as DistributorLevel)}
                  className="mt-3 w-full rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-blue-100"
                >
                  <option value="A">Level A - best price</option>
                  <option value="B">Level B - standard price</option>
                  <option value="C">Level C - entry price</option>
                </select>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <h2 className="font-bold">Distributor trust score</h2>
          <div className="mt-4 rounded-[8px] border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{selectedDistributor.name}</p>
                <p className="text-sm text-slate-500">{levelDetails[selectedDistributor.level].description}</p>
              </div>
              <Badge tone={riskTone(selectedDistributor.risk)}>{selectedDistributor.risk}</Badge>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <ReadField label="Trust score" value={`${selectedDistributor.trustScore}/100`} />
              <ReadField label="Revenue" value={`$${selectedDistributor.revenue.toLocaleString()}`} />
            </div>
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-bold">Pending confirmations</h2>
            <Badge tone={pendingCount ? "blue" : "slate"}>{pendingCount} pending</Badge>
          </div>
          {!shareLink && <div className="mt-4"><EmptyState text="Approved order links will appear here until the distributor confirms." /></div>}
          {shareLink && (
            <div className="mt-4 rounded-[8px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold">{savedOrder?.orderNumber || sharedOrderToken}</p>
                <Badge tone={savedOrder?.status === "distributor_confirmed" ? "emerald" : "blue"}>
                  {savedOrder ? orderStatusLabel(savedOrder.status) : statusLabel(status)}
                </Badge>
              </div>
              {savedOrder && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <ReadField label="Distributor" value={savedOrder.distributorName} />
                  <ReadField label="Total" value={`$${savedOrder.totalValue.toFixed(2)}`} />
                  <ReadField label="Payment" value={<Badge tone={paymentTone(savedOrder.paymentStatus)}>{paymentStatusLabel(savedOrder.paymentStatus)}</Badge>} />
                  <ReadField label="Outstanding" value={`$${savedOrder.outstandingAmount.toFixed(2)}`} />
                </div>
              )}
              <a href={shareLink} target="_blank" className="mt-2 block break-all text-sm font-semibold text-blue-700">
                {shareLink}
              </a>
              <div className="mt-4 grid gap-2">
                <button
                  onClick={copyShareLink}
                  className="rounded-[8px] border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                >
                  {copyLabel}
                </button>
                <a
                  href={whatsappHref}
                  target="_blank"
                  className="rounded-[8px] bg-emerald-600 px-4 py-3 text-center text-sm font-semibold text-white"
                >
                  Send via WhatsApp
                </a>
                <a
                  href={telegramHref}
                  target="_blank"
                  className="rounded-[8px] bg-blue-700 px-4 py-3 text-center text-sm font-semibold text-white"
                >
                  Send via Telegram
                </a>
              </div>
              <button onClick={showPortal} className="mt-3 text-sm font-bold text-blue-700">Preview distributor view</button>
              {savedOrder?.status === "distributor_confirmed" && (
                <div className="mt-4 grid gap-2 border-t border-slate-200 pt-4">
                  <ActionButton onClick={requestPayment} disabled={savedOrder.paymentStatus === "paid"} loading={loadingAction === "requestPayment"}>
                    {loadingAction === "requestPayment" ? "Requesting..." : "Request Payment"}
                  </ActionButton>
                  <button
                    onClick={markPaid}
                    disabled={savedOrder.paymentStatus === "paid" || loadingAction === "markPaid"}
                    className="rounded-[8px] border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-40"
                  >
                    {loadingAction === "markPaid" ? "Marking..." : "Mark as Paid"}
                  </button>
                </div>
              )}
            </div>
          )}
        </Panel>

        {(sourceRecord || shareLink) && (
          <Panel>
            <h2 className="font-bold">Source Transparency</h2>
            <div className="mt-4 space-y-3">
              <ReadField label="Original source channel" value={sourceRecord?.channel || sourceChannel} />
              <div className="rounded-[8px] bg-slate-50 p-4 ring-1 ring-slate-200">
                <p className="text-xs text-slate-500">Original pasted message</p>
                <p className="mt-2 text-sm leading-6 text-slate-700">{sourceRecord?.originalMessage || message}</p>
              </div>
              <div className="rounded-[8px] bg-slate-50 p-4 ring-1 ring-slate-200">
                <p className="text-xs text-slate-500">Created order link</p>
                {shareLink ? (
                  <a href={shareLink} target="_blank" className="mt-2 block break-all text-sm font-bold text-blue-700">
                    {shareLink}
                  </a>
                ) : (
                  <p className="mt-2 text-sm font-semibold text-slate-400">Create link after approval</p>
                )}
              </div>
              <ReadField
                label="Confirmation status"
                value={savedOrder ? orderStatusLabel(savedOrder.status) : statusLabel(status)}
              />
            </div>
          </Panel>
        )}

        <Panel>
          <h2 className="font-bold">Order event timeline</h2>
          <OrderEventTimeline status={status} savedOrder={savedOrder || orderRecords[0] || null} sourceRecord={sourceRecord} auditEvents={auditEvents} />
        </Panel>

        <DataProtectionPanel />

        <Panel>
          <h2 className="font-bold">Contextual threads</h2>
          {sourceRecord && (
            <div className="mt-4 rounded-[8px] border border-blue-100 bg-blue-50 p-4">
              <p className="text-xs font-bold text-blue-700">Original {sourceRecord.channel} source</p>
              <p className="mt-1 text-sm font-semibold">{sourceRecord.id}</p>
              <p className="mt-1 text-xs leading-5 text-blue-900">{sourceRecord.originalMessage}</p>
            </div>
          )}
          <div className="mt-4 space-y-3">
            {demoThreads.map((thread) => (
              <div key={thread.id} className="rounded-[8px] bg-slate-50 p-4 ring-1 ring-slate-200">
                <p className="text-xs font-bold text-blue-700">{thread.type}</p>
                <p className="mt-1 text-sm font-semibold">{thread.topic}</p>
                <p className="text-xs text-slate-500">{thread.context} / {thread.status} / Source linked</p>
              </div>
            ))}
          </div>
        </Panel>
      </aside>
    </div>
  );
}

function DistributorPortal({
  products,
  search,
  setSearch,
  addToCart,
  cart,
  setCart,
  cartUnits,
  cartValue,
  items,
  status,
  sourceRecord,
  selectedDistributor,
  selectedLevel,
  confirmSharedOrder,
  confirmLoading,
  orderRecords,
}: {
  products: Product[];
  search: string;
  setSearch: (value: string) => void;
  addToCart: (product: Product) => void;
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  cartUnits: number;
  cartValue: number;
  items: OrderItem[];
  status: WorkspaceStatus;
  sourceRecord: SourceRecord | null;
  selectedDistributor: DemoDistributor;
  selectedLevel: DistributorLevel;
  confirmSharedOrder: () => void;
  confirmLoading: boolean;
  orderRecords: PersistedOrder[];
}) {
  const [poStatus, setPoStatus] = useState("");
  const cartMoqIssues = cart.filter((item) => item.qty < item.moq).length;

  return (
    <div className="grid gap-6 px-6 py-6 xl:grid-cols-[1fr_380px]">
      <section className="space-y-6">
        <div className="rounded-[8px] bg-slate-950 p-6 text-white">
          <p className="text-sm text-slate-300">{selectedDistributor.name} / {levelDetails[selectedLevel].label} / {selectedDistributor.terms}</p>
          <h2 className="mt-2 text-2xl font-bold">Approved buying portal for Nimbus Home Goods</h2>
          <p className="mt-2 text-sm text-slate-300">{levelDetails[selectedLevel].description}</p>
        </div>
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <h2 className="text-xl font-bold">Approved catalog</h2>
            <p className="text-sm text-slate-500">Products, MOQ, stock, and your level-specific prices.</p>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search product or SKU"
            className="w-full rounded-[8px] border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:ring-4 focus:ring-blue-100 md:w-80"
          />
        </div>
        <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
          {!products.length && <div className="md:col-span-2 2xl:col-span-3"><EmptyState text="No products are approved yet. Ask the brand to upload or seed the catalog." /></div>}
          {products.map((product) => (
            <ProductCard key={product.id} product={product} level={selectedLevel} onAdd={() => addToCart(product)} />
          ))}
        </div>
      </section>

      <aside className="space-y-6">
        <Panel>
          <h2 className="font-bold">Cart summary</h2>
          <p className="mt-1 text-sm text-slate-500">Cart prices use {levelDetails[selectedLevel].label}.</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <ReadField label="Items" value={cart.length} />
            <ReadField label="Quantity" value={cartUnits} />
            <ReadField label="Tier" value={levelDetails[selectedLevel].label} />
            <ReadField label="MOQ status" value={cart.length ? (cartMoqIssues ? `${cartMoqIssues} review` : "All clear") : "No items"} />
          </div>
          {!cart.length && <div className="mt-4"><EmptyState text="Add products to build a distributor PO." /></div>}
          <div className="mt-4 space-y-3">
            {cart.map((item) => {
              const levelPrice = getLevelPrice(item, selectedLevel);
              const belowMoq = item.qty < item.moq;
              return (
                <div key={item.id} className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.sku}</p>
                    </div>
                    <button
                      onClick={() => setCart((current) => current.filter((cartItem) => cartItem.id !== item.id))}
                      className="text-xs font-bold text-rose-600"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <EditField
                      label="Qty"
                      value={item.qty}
                      onChange={(value) =>
                        setCart((current) =>
                          current.map((cartItem) =>
                            cartItem.id === item.id ? { ...cartItem, qty: Number(value) || 0 } : cartItem
                          )
                        )
                      }
                    />
                    <ReadField label="Tier price" value={`$${levelPrice.toFixed(2)}`} />
                    <ReadField label="MOQ" value={belowMoq ? `${item.moq} min` : "Clear"} />
                  </div>
                  <div className="mt-3 flex items-center justify-between rounded-[8px] bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
                    <span className={belowMoq ? "font-semibold text-amber-700" : "text-slate-500"}>
                      {belowMoq ? "Below MOQ" : "MOQ met"}
                    </span>
                    <span className="font-bold">${(item.qty * levelPrice).toFixed(0)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {!!cart.length && (
            <div className="mt-5 border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between font-bold">
                <span>Total</span>
                <span>${cartValue.toFixed(0)}</span>
              </div>
              {poStatus && (
                <div className="mt-4 rounded-[8px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                  {poStatus}
                </div>
              )}
              <ActionButton
                className="mt-4 w-full"
                tone="dark"
                disabled={cartMoqIssues > 0}
                onClick={() => setPoStatus("PO request submitted to brand control center.")}
              >
                Request Order / Submit PO
              </ActionButton>
            </div>
          )}
        </Panel>

        <Panel>
          <h2 className="font-bold">Shared order confirmation</h2>
          {sourceRecord && (
            <p className="mt-1 text-sm text-slate-500">Source: {sourceRecord.channel} / {sourceRecord.id}</p>
          )}
          {!items.length && <div className="mt-4"><EmptyState text="Brand-approved orders appear here for distributor confirmation." /></div>}
          <div className="mt-4 space-y-3">
            {items.map((item) => (
              <div key={item.id} className="rounded-[8px] bg-slate-50 p-4 ring-1 ring-slate-200">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{item.name}</p>
                    <p className="text-xs text-slate-500">{item.qty} units / {item.sku}</p>
                  </div>
                  <p className="font-bold">${(item.qty * item.levelPrice).toFixed(0)}</p>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {levelDetails[selectedLevel].label} price ${item.levelPrice.toFixed(2)} / confidence {item.confidence}%
                </div>
              </div>
            ))}
          </div>
          {!!items.length && (
            <ActionButton className="mt-4 w-full" onClick={confirmSharedOrder} disabled={status === "distributor_confirmed"} loading={confirmLoading}>
              {confirmLoading ? "Confirming..." : status === "distributor_confirmed" ? "Order confirmed" : "Confirm shared order"}
            </ActionButton>
          )}
        </Panel>

        <Panel>
          <h2 className="font-bold">Order history</h2>
          <div className="mt-4 space-y-3">
            {!orderRecords.length && <EmptyState text="No orders yet. Confirmed and shared orders will appear here." />}
            {orderRecords.map((order) => (
              <div key={order.id || order.shareToken} className="rounded-[8px] bg-slate-50 p-4 ring-1 ring-slate-200">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{order.orderNumber}</p>
                  <Badge tone={order.status === "distributor_confirmed" ? "emerald" : order.status === "link_created" ? "blue" : "amber"}>{orderStatusLabel(order.status)}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500">${order.totalValue.toLocaleString()} / {paymentStatusLabel(order.paymentStatus)} / {levelDetails[order.distributorLevel].label}</p>
              </div>
            ))}
          </div>
        </Panel>
      </aside>
    </div>
  );
}

function PilotLaunch() {
  return (
    <div className="grid gap-6 px-6 py-6 xl:grid-cols-[1fr_380px]">
      <section className="space-y-6">
        <Panel>
          <h2 className="text-xl font-bold">Pilot launch plan</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            This is the service delivery view to sell brands: a concrete launch checklist, named owners, and a recurring operating cadence after the portal goes live.
          </p>
          <div className="mt-6 space-y-3">
            {launchTasks.map((task) => (
              <div key={task.name} className="grid gap-3 rounded-[8px] border border-slate-200 bg-slate-50 p-4 md:grid-cols-[1fr_160px_120px] md:items-center">
                <p className="font-semibold">{task.name}</p>
                <p className="text-sm text-slate-500">{task.owner}</p>
                <Badge tone={task.status === "Done" ? "emerald" : task.status === "Review" ? "amber" : "blue"}>{task.status}</Badge>
              </div>
            ))}
          </div>
        </Panel>
        <Panel>
          <h2 className="text-xl font-bold">7-day pilot outcome</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            By the end of week one, a brand can show live distributor price levels, source-backed order drafts, confirmation links, and a repeatable review process for real channel orders.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-4">
            <Stat label="Day 1-2" value="Catalog" helper="SKUs, MOQ, stock, levels" />
            <Stat label="Day 3-4" value="Distributors" helper="Assign A/B/C levels" />
            <Stat label="Day 5" value="Orders" helper="Parse chat into drafts" />
            <Stat label="Day 6-7" value="Confirm" helper="Links and status tracking" />
          </div>
        </Panel>
        <Panel>
          <h2 className="text-xl font-bold">Before / After</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-[8px] border border-rose-100 bg-rose-50 p-5">
              <p className="font-bold text-rose-800">Before</p>
              <div className="mt-4 space-y-3 text-sm text-rose-900">
                <p>WhatsApp and Telegram messages become scattered buying intent.</p>
                <p>Excel sheets carry unclear price versions and manual MOQ checks.</p>
                <p>Confirmations get lost between sales, operations, and distributors.</p>
              </div>
            </div>
            <div className="rounded-[8px] border border-emerald-100 bg-emerald-50 p-5">
              <p className="font-bold text-emerald-800">After</p>
              <div className="mt-4 space-y-3 text-sm text-emerald-900">
                <p>Every chat has a source record attached to the order draft.</p>
                <p>AI matches SKU, quantity, tier price, MOQ, stock, and confidence.</p>
                <p>Distributor confirmation links update order status for the brand.</p>
              </div>
            </div>
          </div>
        </Panel>
        <Panel>
          <h2 className="text-xl font-bold">Weekly brand review</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-4">
            <Stat label="New orders" value="18" helper="This week" />
            <Stat label="Blocked value" value="$14K" helper="Stock or payment review" />
            <Stat label="Fastest region" value="DACH" helper="4.1 day cycle" />
            <Stat label="Follow-ups" value="6" helper="Contextual threads" />
          </div>
        </Panel>
      </section>
      <aside className="space-y-6">
        <Panel>
          <h2 className="font-bold">What we sell to brands</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
            <p><strong className="text-slate-950">Positioning:</strong> Keep WhatsApp and Telegram, but turn serious buying conversations into transparent order records.</p>
            <p><strong className="text-slate-950">Setup:</strong> Catalog import, Level A/B/C price books, distributor onboarding, and branded portal configuration.</p>
            <p><strong className="text-slate-950">Workflow:</strong> Source record, tier price, SKU match, confirmation link, and order status in one controlled lane.</p>
          </div>
        </Panel>
        <Panel>
          <h2 className="font-bold">Pilot objection handling</h2>
          <div className="mt-4 space-y-3">
            <Objection title="We already use WhatsApp" text="Keep WhatsApp for relationship context; Distributor OS stores the original message and converts it into the operational order record." />
            <Objection title="Our pricing is complex" text="Start with Level A, B, and C price books. Add distributor-specific overrides after the first cohort is live." />
            <Objection title="Distributors will not log in" text="Send order links first, then move repeat buyers into the portal once value is clear." />
          </div>
        </Panel>
      </aside>
    </div>
  );
}

function ProductCatalogSetup({
  products,
  onProductsChange,
  catalogSaveStatus,
}: {
  products: Product[];
  onProductsChange: (products: Product[], source: CatalogImportSource) => Promise<void>;
  catalogSaveStatus: string;
}) {
  const [form, setForm] = useState<ProductFormState>(emptyProductForm);
  const [editingSku, setEditingSku] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [importSummary, setImportSummary] = useState<CatalogImportSummary | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const visibleProducts = products.slice(0, 50);

  function updateForm(field: keyof ProductFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveManualProduct() {
    setIsSavingProduct(true);
    const product = normalizeCatalogProduct(form);
    const validationErrors = validateCatalogProduct(product);
    if (validationErrors.length) {
      setErrors(validationErrors);
      setIsSavingProduct(false);
      return;
    }

    const nextProducts = [
      ...products.filter((item) => item.sku.toLowerCase() !== product.sku.toLowerCase()),
      product,
    ].sort((a, b) => a.sku.localeCompare(b.sku));

    try {
      await onProductsChange(nextProducts, "manual");
      setForm(emptyProductForm);
      setEditingSku("");
      setErrors([]);
      setImportSummary({ rowsImported: 1, rowsFailed: 0, errors: [] });
    } catch (error: any) {
      const message = error?.message || "Product save failed";
      setErrors([message]);
      setImportSummary({ rowsImported: 0, rowsFailed: 1, errors: [message] });
    } finally {
      setIsSavingProduct(false);
    }
  }

  async function importCatalogFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setErrors([]);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/catalog/import", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        const importErrors = Array.isArray(data.error) ? data.error : [data.error || "Catalog import failed"];
        setErrors(importErrors);
        setImportSummary({ rowsImported: 0, rowsFailed: importErrors.length, errors: importErrors });
        return;
      }

      const parsedProducts = data.products as Product[];
      const importedBySku = new Map(products.map((product) => [product.sku.toLowerCase(), product]));
      parsedProducts.forEach((product) => importedBySku.set(product.sku.toLowerCase(), product));
      const source = file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv";
      await onProductsChange(Array.from(importedBySku.values()).sort((a, b) => a.sku.localeCompare(b.sku)), source);
      setImportSummary({
        rowsImported: Number(data.importedCount || parsedProducts.length),
        rowsFailed: Number(data.skippedCount || 0),
        errors: Array.isArray(data.warnings) ? data.warnings : [],
      });
      setErrors([]);
    } catch (error: any) {
      const importErrors = [error?.message || "Failed product upload"];
      setErrors(importErrors);
      setImportSummary({ rowsImported: 0, rowsFailed: 1, errors: importErrors });
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  }

  function editProduct(product: Product) {
    setEditingSku(product.sku);
    setForm({
      sku: product.sku,
      name: product.name,
      category: product.category,
      moq: String(product.moq),
      stock: String(product.stock),
      level_a_price: String(product.levelPrices.A),
      level_b_price: String(product.levelPrices.B),
      level_c_price: String(product.levelPrices.C),
      aliases: product.aliases.join(", "),
      lead_time: product.lead_time,
    });
    setErrors([]);
    setImportSummary(null);
  }

  return (
    <Panel>
      <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h2 className="text-xl font-bold">Product Catalog Setup</h2>
          <p className="text-sm text-slate-500">Upload SKUs or maintain products manually for AI matching, price levels, MOQ, and stock.</p>
        </div>
        <label className={`cursor-pointer rounded-[8px] bg-slate-950 px-4 py-3 text-sm font-semibold text-white ${isUploading ? "opacity-60" : ""}`}>
          {isUploading ? "Uploading..." : "Upload CSV/XLSX"}
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={importCatalogFile}
            disabled={isUploading}
            className="hidden"
          />
        </label>
      </div>

      <div className="mb-4 rounded-[8px] border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
        <p className="font-semibold">{catalogSaveStatus}</p>
        <p className="mt-1">CSV/XLSX columns: sku, name, category, moq, stock, level_a_price, level_b_price, level_c_price, aliases, lead_time.</p>
        <p className="mt-1">Rows imported here immediately become available to the WhatsApp/Telegram parser.</p>
      </div>

      {importSummary && (
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <ReadField label="Rows imported" value={importSummary.rowsImported} />
          <ReadField label="Rows failed" value={importSummary.rowsFailed} />
          <ReadField label="Catalog size" value={products.length} />
        </div>
      )}

      {!!importSummary?.errors.length && (
        <div className="mb-4 rounded-[8px] border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
          {importSummary.errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      )}

      {!!errors.length && (
        <div className="mb-4 rounded-[8px] border border-rose-100 bg-rose-50 p-4 text-sm text-rose-800">
          {errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <CatalogInput label="SKU" value={form.sku} onChange={(value) => updateForm("sku", value)} />
        <CatalogInput label="Product name" value={form.name} onChange={(value) => updateForm("name", value)} />
        <CatalogInput label="Category" value={form.category} onChange={(value) => updateForm("category", value)} />
        <CatalogInput label="Lead time" value={form.lead_time} onChange={(value) => updateForm("lead_time", value)} />
        <CatalogInput label="MOQ" value={form.moq} onChange={(value) => updateForm("moq", value)} />
        <CatalogInput label="Stock" value={form.stock} onChange={(value) => updateForm("stock", value)} />
        <CatalogInput label="Level A price" value={form.level_a_price} onChange={(value) => updateForm("level_a_price", value)} />
        <CatalogInput label="Level B price" value={form.level_b_price} onChange={(value) => updateForm("level_b_price", value)} />
        <CatalogInput label="Level C price" value={form.level_c_price} onChange={(value) => updateForm("level_c_price", value)} />
        <label className="block rounded-[8px] bg-white p-3 ring-1 ring-slate-200 md:col-span-3">
          <span className="text-xs text-slate-500">Aliases for AI matching</span>
          <input
            value={form.aliases}
            onChange={(event) => updateForm("aliases", event.target.value)}
            placeholder="hydrago, bottle, stainless bottle"
            className="mt-1 w-full bg-transparent text-sm font-bold outline-none"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton onClick={saveManualProduct} tone="dark" loading={isSavingProduct}>
          {isSavingProduct ? "Saving..." : editingSku ? "Save Product" : "Add Product"}
        </ActionButton>
        {editingSku && (
          <button
            onClick={() => {
              setForm(emptyProductForm);
              setEditingSku("");
              setErrors([]);
            }}
            className="rounded-[8px] border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
          >
            Cancel Edit
          </button>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 text-sm text-slate-500">
        <span>Showing {visibleProducts.length} of {products.length} catalog products</span>
        {products.length > visibleProducts.length && <span>Use search in Distributor Portal to inspect the full catalog.</span>}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {!visibleProducts.length && <div className="md:col-span-2"><EmptyState text="No products yet. Upload a catalog or add the first SKU manually." /></div>}
        {visibleProducts.map((product) => (
          <div key={product.sku} className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{product.name}</p>
                <p className="text-xs text-slate-500">{product.sku} / {product.category} / {product.lead_time}</p>
              </div>
              <Badge tone={product.stock <= 0 ? "rose" : product.stock < 500 ? "amber" : "emerald"}>{product.status}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <ReadField label="A" value={`$${product.levelPrices.A.toFixed(2)}`} />
              <ReadField label="B" value={`$${product.levelPrices.B.toFixed(2)}`} />
              <ReadField label="C" value={`$${product.levelPrices.C.toFixed(2)}`} />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
              <span className="text-slate-500">MOQ {product.moq} / Stock {product.stock}</span>
              <button onClick={() => editProduct(product)} className="font-bold text-blue-700">Edit</button>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AIChannelAnalyticsPanel({ analytics }: { analytics: ReturnType<typeof calculateChannelAnalytics> }) {
  const hasAnalyticsData = Boolean(
    analytics.topRequestedSkus.length ||
    analytics.demandByDistributor.length ||
    Object.values(analytics.orderConversionStatus).some((count) => count > 0)
  );

  return (
    <Panel>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">AI Channel Analytics</h2>
          <p className="text-sm text-slate-500">Structured order, catalog, distributor, and message signals for the brand pilot.</p>
        </div>
        <Badge tone="violet">Foundation</Badge>
      </div>
      {!hasAnalyticsData && <div className="mb-4"><EmptyState text="No analytics data yet. Generate an order or seed demo data to populate channel metrics." /></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <AnalyticsList title="Top requested SKUs" rows={analytics.topRequestedSkus.slice(0, 4)} suffix=" units" />
        <AnalyticsList title="Demand by distributor" rows={analytics.demandByDistributor.slice(0, 4)} currency />
        <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
          <p className="font-semibold">Demand by source channel</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <ReadField label="WhatsApp" value={`$${analytics.demandBySourceChannel.WhatsApp.toFixed(0)}`} />
            <ReadField label="Telegram" value={`$${analytics.demandBySourceChannel.Telegram.toFixed(0)}`} />
          </div>
        </div>
        <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
          <p className="font-semibold">Order conversion status</p>
          <div className="mt-3 space-y-2">
            {Object.entries(analytics.orderConversionStatus).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{status.replace(/_/g, " ")}</span>
                <span className="font-bold">{count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
          <p className="font-semibold">Distributor level performance</p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {(["A", "B", "C"] as DistributorLevel[]).map((level) => (
              <ReadField
                key={level}
                label={levelDetails[level].label}
                value={`$${analytics.distributorLevelPerformance[level].value.toFixed(0)}`}
              />
            ))}
          </div>
        </div>
        <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
          <p className="font-semibold">Risk and pending value</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <ReadField label="Pending confirmation" value={`$${analytics.pendingConfirmationValue.toFixed(0)}`} />
            <ReadField label="Low stock risk" value={analytics.lowStockRisk.length} />
          </div>
        </div>
        <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
          <p className="font-semibold">Payment status</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <ReadField label="Requested" value={analytics.paymentStatusBreakdown.requested} />
            <ReadField label="Paid" value={analytics.paymentStatusBreakdown.paid} />
            <ReadField label="Paid value" value={`$${analytics.paidValue.toFixed(0)}`} />
            <ReadField label="Outstanding" value={`$${analytics.outstandingValue.toFixed(0)}`} />
          </div>
        </div>
      </div>
      <div className="mt-5 rounded-[8px] border border-blue-100 bg-blue-50 p-4">
        <p className="font-semibold text-blue-950">Suggested actions</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {analytics.suggestedActions.slice(0, 6).map((action) => (
            <div key={action} className="rounded-[8px] bg-white px-3 py-2 text-sm font-semibold text-blue-900 ring-1 ring-blue-100">
              {action}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function DataProtectionPanel() {
  return (
    <Panel>
      <h2 className="font-bold">Data Protection</h2>
      <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
        <p>Source messages are attached as order records.</p>
        <p>Price levels are permissioned by distributor.</p>
        <p>All confirmations are audit logged.</p>
        <p>Analytics use structured order data.</p>
        <p>Brand data is not exposed to other brands.</p>
      </div>
    </Panel>
  );
}

function AnalyticsList({
  title,
  rows,
  suffix = "",
  currency = false,
}: {
  title: string;
  rows: Array<{ label: string; value: number }>;
  suffix?: string;
  currency?: boolean;
}) {
  return (
    <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
      <p className="font-semibold">{title}</p>
      <div className="mt-3 space-y-2">
        {rows.length ? rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold">{row.label}</span>
            <span className="text-slate-500">{currency ? `$${row.value.toFixed(0)}` : `${row.value}${suffix}`}</span>
          </div>
        )) : <p className="text-sm text-slate-500">Waiting for order data.</p>}
      </div>
    </div>
  );
}

function CatalogInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block rounded-[8px] bg-white p-3 ring-1 ring-slate-200">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full bg-transparent text-sm font-bold outline-none"
      />
    </label>
  );
}

function ProductCard({ product, level, onAdd }: { product: Product; level: DistributorLevel; onAdd: () => void }) {
  const tone: BadgeTone = product.stock <= 0 ? "rose" : product.stock < 500 ? "amber" : "emerald";
  const levelPrice = getLevelPrice(product, level);
  const deltaB = getPriceDelta(product, level);
  const deltaC = product.levelPrices.C - levelPrice;
  return (
    <div className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Badge tone="blue">{product.category}</Badge>
        <Badge tone={tone}>{product.status}</Badge>
      </div>
      <p className="font-bold">{product.name}</p>
      <p className="mt-1 text-sm text-slate-500">SKU: {product.sku}</p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <ReadField label={`${levelDetails[level].label} price`} value={`$${levelPrice.toFixed(2)}`} />
        <ReadField label="Vs Level B" value={<PriceDelta value={deltaB} />} />
        <ReadField label="Savings vs C" value={<SavingsValue value={deltaC} />} />
        <ReadField label="MOQ" value={product.moq} />
        <ReadField label="Stock" value={product.stock} />
        <ReadField label="Lead time" value={product.lead_time} />
      </div>
      <ActionButton className="mt-5 w-full" tone="dark" onClick={onAdd} disabled={product.stock <= 0}>
        {product.stock <= 0 ? "Out of stock" : "Add to cart"}
      </ActionButton>
    </div>
  );
}

function parseOrder(message: string, level: DistributorLevel, products: Product[]): OrderItem[] {
  return parseCatalogOrder(message, level, products);
}

function applyLevelPrice(item: OrderItem, level: DistributorLevel): OrderItem {
  const levelPrice = getLevelPrice(item, level);
  return {
    ...item,
    levelPrice,
    standardPrice: item.levelPrices.B,
    priceDelta: levelPrice - item.levelPrices.B,
  };
}

function calculateOrderValue(items: OrderItem[]) {
  return items.reduce((sum, item) => sum + item.qty * item.levelPrice, 0);
}

function appendOrderEvent(order: PersistedOrder, eventType: string, label: string): PersistedOrder {
  if (order.events.some((event) => event.eventType === eventType)) return order;
  return {
    ...order,
    events: [
      ...order.events,
      { eventType, label, createdAt: new Date().toISOString() },
    ],
  };
}

function createWorkflowOrder({
  token,
  status,
  selectedDistributor,
  selectedLevel,
  sourceRecord,
  items,
  orderValue,
  events = [],
}: {
  token: string;
  status: PersistedOrder["status"];
  selectedDistributor: DemoDistributor;
  selectedLevel: DistributorLevel;
  sourceRecord: SourceRecord;
  items: OrderItem[];
  orderValue: number;
  events?: PersistedOrderEvent[];
}): PersistedOrder {
  return {
    id: `local-${token}`,
    orderNumber: status === "draft" || status === "approved" ? "Draft order" : `DO-${token.slice(-4)}`,
    orderId: status === "draft" || status === "approved" ? "Draft order" : `DO-${token.slice(-4)}`,
    distributorId: selectedDistributor.id,
    distributorName: selectedDistributor.name,
    distributorLevel: selectedLevel,
    sourceChannel: sourceRecord.channel,
    originalMessage: sourceRecord.originalMessage,
    status,
    shareToken: token,
    token,
    totalValue: orderValue,
    paymentStatus: "unpaid",
    paymentMethod: "offline",
    paymentDueDate: null,
    amountPaid: 0,
    outstandingAmount: orderValue,
    createdAt: new Date().toISOString(),
    items: items.map((item) => ({
      id: item.id,
      productId: item.id,
      productName: item.name,
      name: item.name,
      sku: item.sku,
      quantity: item.qty,
      qty: item.qty,
      unitPrice: item.levelPrice,
      levelAPrice: item.levelPrices.A,
      levelBPrice: item.levelPrices.B,
      levelCPrice: item.levelPrices.C,
      moq: item.moq,
      stockSnapshot: item.stock,
      stock: item.stock,
      confidence: item.confidence,
      lineTotal: item.qty * item.levelPrice,
    })),
    events,
  };
}

function normalizePersistedOrder(order: any): PersistedOrder {
  return {
    id: order.id,
    orderNumber: order.orderNumber || order.order_number || order.orderId || "Saved order",
    orderId: order.orderId || order.orderNumber || order.order_number || "Saved order",
    distributorId: order.distributorId || order.distributor_id || "",
    distributorName: order.distributorName || order.distributor_name || "",
    distributorLevel: (order.distributorLevel || order.distributor_level || "B") as DistributorLevel,
    sourceChannel: (order.sourceChannel || order.source_channel || "WhatsApp") as SourceChannel,
    originalMessage: order.originalMessage || order.original_message || "",
    status: (order.status || "link_created") as PersistedOrder["status"],
    shareToken: order.shareToken || order.share_token || order.token,
    token: order.token || order.shareToken || order.share_token,
    totalValue: Number(order.totalValue ?? order.total_value ?? 0),
    paymentStatus: normalizePaymentStatus(order.paymentStatus || order.payment_status),
    paymentMethod: normalizePaymentMethod(order.paymentMethod || order.payment_method),
    paymentDueDate: order.paymentDueDate || order.payment_due_date || null,
    amountPaid: Number(order.amountPaid ?? order.amount_paid ?? 0),
    outstandingAmount: Number(order.outstandingAmount ?? order.outstanding_amount ?? order.totalValue ?? order.total_value ?? 0),
    createdAt: order.createdAt || order.created_at,
    items: (order.items || []).map((item: any) => ({
      id: item.id,
      productId: item.productId || item.product_id,
      productName: item.productName || item.product_name || item.name,
      name: item.name || item.productName || item.product_name,
      sku: item.sku,
      quantity: Number(item.quantity ?? item.qty ?? 0),
      qty: Number(item.qty ?? item.quantity ?? 0),
      unitPrice: Number(item.unitPrice ?? item.unit_price ?? item.levelPrice ?? 0),
      levelAPrice: Number(item.levelAPrice ?? item.level_a_price ?? item.levelPrices?.A ?? 0),
      levelBPrice: Number(item.levelBPrice ?? item.level_b_price ?? item.levelPrices?.B ?? 0),
      levelCPrice: Number(item.levelCPrice ?? item.level_c_price ?? item.levelPrices?.C ?? 0),
      moq: Number(item.moq ?? 1),
      stockSnapshot: Number(item.stockSnapshot ?? item.stock_snapshot ?? item.stock ?? 0),
      stock: Number(item.stock ?? item.stockSnapshot ?? item.stock_snapshot ?? 0),
      confidence: Number(item.confidence ?? 0),
      lineTotal: Number(item.lineTotal ?? item.line_total ?? 0),
    })),
    events: (order.events || []).map((event: any) => ({
      id: event.id,
      eventType: event.eventType || event.event_type,
      label: event.label,
      createdAt: event.createdAt || event.created_at,
    })),
  };
}

function readLocalSharedOrders() {
  const orders: PersistedOrder[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith("distributor-os-shared-order-")) continue;
    const token = key.replace("distributor-os-shared-order-", "");
    const order = readLocalSharedOrder(token);
    if (order) orders.push(order);
  }
  return orders;
}

function readLocalSharedOrder(token: string) {
  const raw = window.localStorage.getItem(`distributor-os-shared-order-${token}`);
  if (!raw) return null;
  try {
    return normalizePersistedOrder(JSON.parse(raw));
  } catch {
    window.localStorage.removeItem(`distributor-os-shared-order-${token}`);
    return null;
  }
}

function mergeLocalOrderSnapshots(orders: PersistedOrder[]) {
  const byOrder = new Map<string, PersistedOrder>();
  for (const order of orders) {
    const key = order.shareToken || order.token || order.id || order.orderNumber;
    const existing = byOrder.get(key);
    if (!existing || getOrderSnapshotTime(order) >= getOrderSnapshotTime(existing)) {
      byOrder.set(key, order);
    }
  }
  return [...byOrder.values()].sort((left, right) => getOrderSnapshotTime(right) - getOrderSnapshotTime(left));
}

function getOrderSnapshotTime(order: PersistedOrder) {
  const eventTime = order.events.reduce((latest, event) => {
    const time = Date.parse(event.createdAt || "");
    return Number.isNaN(time) ? latest : Math.max(latest, time);
  }, 0);
  return eventTime || Date.parse(order.createdAt || "") || 0;
}

function clearLocalDemoState() {
  const keysToRemove: string[] = [
    "distributor-os-product-catalog",
    "distributor-os-order-records",
    "distributor-os-confirmed-order",
  ];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith("distributor-os-shared-order-")) keysToRemove.push(key);
  }

  keysToRemove.forEach((key) => window.localStorage.removeItem(key));
}

function createSeedDemoOrderRecords() {
  const now = new Date().toISOString();
  return demoOrders.map((demoOrder, index) => {
    const distributor = demoDistributors[index] || demoDistributors[0];
    const level = distributor.level;
    const product = initialCatalogProducts[index % initialCatalogProducts.length];
    const quantity = Math.max(product.moq, index === 0 ? 120 : product.moq);
    const unitPrice = getLevelPrice(product, level);
    const token = `DEMO-${String(index + 1).padStart(2, "0")}`;
    const paymentStatus: PaymentStatus = demoOrder.payment === "Paid" ? "paid" : demoOrder.payment.includes("Deposit") ? "requested" : "unpaid";
    const amountPaid = paymentStatus === "paid" ? demoOrder.amount : 0;

    return {
      id: `local-${token}`,
      orderNumber: demoOrder.id,
      orderId: demoOrder.id,
      distributorId: distributor.id,
      distributorName: distributor.name,
      distributorLevel: level,
      sourceChannel: index === 1 ? "Telegram" : "WhatsApp",
      originalMessage: sampleMessage,
      status: index === 0 ? "link_created" : index === 1 ? "distributor_confirmed" : "approved",
      shareToken: token,
      token,
      totalValue: demoOrder.amount,
      paymentStatus,
      paymentMethod: paymentStatus === "paid" ? "offline" : "bank_transfer",
      paymentDueDate: paymentStatus === "requested" ? addDaysIso(7) : null,
      amountPaid,
      outstandingAmount: Math.max(0, demoOrder.amount - amountPaid),
      createdAt: now,
      items: [{
        id: product.id,
        productId: product.id,
        productName: product.name,
        name: product.name,
        sku: product.sku,
        quantity,
        qty: quantity,
        unitPrice,
        levelAPrice: product.levelPrices.A,
        levelBPrice: product.levelPrices.B,
        levelCPrice: product.levelPrices.C,
        moq: product.moq,
        stockSnapshot: product.stock,
        stock: product.stock,
        confidence: 94 - index,
        lineTotal: quantity * unitPrice,
      }],
      events: [
        { eventType: "message_pasted", label: "Message pasted", createdAt: now },
        { eventType: "draft_generated", label: "Draft generated", createdAt: now },
        { eventType: "brand_approved", label: "Brand approved", createdAt: now },
        ...(index === 0 ? [{ eventType: "link_created", label: "Link created", createdAt: now }] : []),
        ...(index === 1 ? [{ eventType: "distributor_confirmed", label: "Distributor confirmed", createdAt: now }] : []),
        ...(paymentStatus === "paid" ? [{ eventType: "payment_paid", label: "Payment paid", createdAt: now }] : []),
        ...(paymentStatus === "requested" ? [{ eventType: "payment_requested", label: "Payment requested", createdAt: now }] : []),
      ],
    } satisfies PersistedOrder;
  });
}

function createFallbackOrder({
  token,
  selectedDistributor,
  selectedLevel,
  sourceRecord,
  items,
  orderValue,
}: {
  token: string;
  selectedDistributor: DemoDistributor;
  selectedLevel: DistributorLevel;
  sourceRecord: SourceRecord;
  items: OrderItem[];
  orderValue: number;
}): PersistedOrder {
  const events = [
    { eventType: "message_pasted", label: "Message pasted", createdAt: new Date().toISOString() },
    { eventType: "draft_generated", label: "Draft generated", createdAt: new Date().toISOString() },
    { eventType: "brand_approved", label: "Brand approved", createdAt: new Date().toISOString() },
    { eventType: "link_created", label: "Link created", createdAt: new Date().toISOString() },
  ];

  return {
    id: `local-${token}`,
    orderNumber: `DO-${token.slice(-4)}`,
    orderId: `DO-${token.slice(-4)}`,
    distributorId: selectedDistributor.id,
    distributorName: selectedDistributor.name,
    distributorLevel: selectedLevel,
    sourceChannel: sourceRecord.channel,
    originalMessage: sourceRecord.originalMessage,
    status: "link_created",
    shareToken: token,
    token,
    totalValue: orderValue,
    paymentStatus: "unpaid",
    paymentMethod: "offline",
    paymentDueDate: null,
    amountPaid: 0,
    outstandingAmount: orderValue,
    createdAt: new Date().toISOString(),
    items: items.map((item) => ({
      id: item.id,
      productId: item.id,
      productName: item.name,
      name: item.name,
      sku: item.sku,
      quantity: item.qty,
      qty: item.qty,
      unitPrice: item.levelPrice,
      levelAPrice: item.levelPrices.A,
      levelBPrice: item.levelPrices.B,
      levelCPrice: item.levelPrices.C,
      moq: item.moq,
      stockSnapshot: item.stock,
      stock: item.stock,
      confidence: item.confidence,
      lineTotal: item.qty * item.levelPrice,
    })),
    events,
  };
}

async function confirmOrderFromPortal(
  sharedOrderToken: string,
  setSavedOrder: React.Dispatch<React.SetStateAction<PersistedOrder | null>>,
  setDraftOrder: React.Dispatch<React.SetStateAction<PersistedOrder | null>>,
  upsertOrderRecord: (order: PersistedOrder) => void,
  setStatus: React.Dispatch<React.SetStateAction<WorkspaceStatus>>,
  setToast: React.Dispatch<React.SetStateAction<string>>,
  setErrorMessage: React.Dispatch<React.SetStateAction<string>>,
  setLoadingAction: React.Dispatch<React.SetStateAction<ActionLoading>>
) {
  setErrorMessage("");
  setLoadingAction("confirmDistributor");
  if (sharedOrderToken) {
    try {
      const response = await fetch(`/api/orders/${sharedOrderToken}/confirm`, { method: "POST" });
      if (response.ok) {
        const data = await response.json();
        const confirmedOrder = normalizePersistedOrder(data.order);
        setSavedOrder(confirmedOrder);
        setDraftOrder(confirmedOrder);
        upsertOrderRecord(confirmedOrder);
        setStatus("distributor_confirmed");
        setToast("Distributor confirmed the saved Supabase order.");
        setLoadingAction(null);
        return;
      }
      const error = await readApiError(response, "Distributor confirmation failed");
      if (response.status !== 503) {
        setErrorMessage(`Failed distributor confirmation: ${error}`);
        setToast("Distributor confirmation was not saved.");
        setLoadingAction(null);
        return;
      }
    } catch {
      // Fall back to local preview confirmation below.
    }

    window.localStorage.setItem(
      "distributor-os-confirmed-order",
      JSON.stringify({ token: sharedOrderToken, status: "Distributor Confirmed", confirmedAt: new Date().toISOString() })
    );
    setSavedOrder((current) => {
      if (!current) return current;
      const confirmedOrder = appendOrderEvent({ ...current, status: "distributor_confirmed" }, "distributor_confirmed", "Distributor confirmed");
      setDraftOrder(confirmedOrder);
      upsertOrderRecord(confirmedOrder);
      return confirmedOrder;
    });
  }

  setStatus("distributor_confirmed");
  setToast("Distributor confirmed the shared order.");
  setLoadingAction(null);
}

function extractQuantity(message: string, alias: string) {
  const index = message.toLowerCase().indexOf(alias.toLowerCase());
  const before = message.slice(Math.max(0, index - 50), index);
  const matches = before.match(/(\d+)\s*(pcs|pieces|units|unit)?/gi);
  if (!matches?.length) return null;
  const last = matches[matches.length - 1].match(/\d+/);
  return last ? Number(last[0]) : null;
}

function detectDelivery(message: string) {
  const text = message.toLowerCase();
  if (text.includes("next week")) return "Next week";
  if (text.includes("this week")) return "This week";
  if (text.includes("tomorrow")) return "Tomorrow";
  if (text.includes("asap")) return "ASAP";
  return "To be confirmed";
}

function buildOrderShareMessage({
  distributorName,
  brandName,
  orderNumber,
  orderValue,
  deliveryEstimate,
  shareLink,
}: {
  distributorName: string;
  brandName: string;
  orderNumber: string;
  orderValue: number;
  deliveryEstimate: string;
  shareLink: string;
}) {
  return [
    `Hi ${distributorName}, ${brandName} created an order for your review.`,
    `Order: ${orderNumber}`,
    `Order value: $${orderValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
    `Delivery: ${deliveryEstimate}`,
    `Please confirm here: ${shareLink}`,
  ].join("\n");
}

function buildAnalyticsOrders(orderRecords: PersistedOrder[]): AnalyticsOrder[] {
  return orderRecords.map((order) => ({
    distributorName: order.distributorName,
    distributorLevel: order.distributorLevel,
    sourceChannel: order.sourceChannel,
    status: order.status,
    paymentStatus: order.paymentStatus,
    totalValue: order.totalValue,
    outstandingAmount: order.outstandingAmount,
    items: order.items.map((item) => ({
      sku: item.sku,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
      stockSnapshot: item.stockSnapshot,
      moq: item.moq,
    })),
  }));
}

async function updateOrderPayment(
  sharedOrderToken: string,
  paymentStatus: PaymentStatus,
  currentOrder: PersistedOrder | null,
  setSavedOrder: React.Dispatch<React.SetStateAction<PersistedOrder | null>>,
  setDraftOrder: React.Dispatch<React.SetStateAction<PersistedOrder | null>>,
  upsertOrderRecord: (order: PersistedOrder) => void,
  setToast: React.Dispatch<React.SetStateAction<string>>,
  setErrorMessage: React.Dispatch<React.SetStateAction<string>>,
  setLoadingAction: React.Dispatch<React.SetStateAction<ActionLoading>>
) {
  if (!sharedOrderToken) {
    setErrorMessage("Create and confirm an order link before updating payment.");
    return;
  }

  setErrorMessage("");
  setLoadingAction(paymentStatus === "paid" ? "markPaid" : "requestPayment");
  const dueDate = paymentStatus === "requested" ? addDaysIso(7) : null;
  try {
    const response = await fetch(`/api/orders/${sharedOrderToken}/payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payment_status: paymentStatus,
        payment_method: "offline",
        amount_paid: paymentStatus === "paid" ? currentOrder?.totalValue : currentOrder?.amountPaid ?? 0,
        payment_due_date: dueDate,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const paidOrder = normalizePersistedOrder(data.order);
      window.localStorage.setItem(`distributor-os-shared-order-${sharedOrderToken}`, JSON.stringify(paidOrder));
      setSavedOrder(paidOrder);
      setDraftOrder(paidOrder);
      upsertOrderRecord(paidOrder);
      setToast(paymentStatus === "paid" ? "Payment marked paid." : "Payment requested from distributor.");
      setLoadingAction(null);
      return;
    }
    const error = await readApiError(response, "Payment update failed");
    if (response.status !== 503) {
      setErrorMessage(`Failed payment update: ${error}`);
      setToast("Payment update was not saved.");
      setLoadingAction(null);
      return;
    }
  } catch {
    // Local preview orders are updated below when Supabase is not configured.
  }

  setSavedOrder((current) => {
    if (!current) return current;
    const nextOrder = applyPaymentStatus(current, paymentStatus, dueDate);
    window.localStorage.setItem(`distributor-os-shared-order-${sharedOrderToken}`, JSON.stringify(nextOrder));
    setDraftOrder(nextOrder);
    upsertOrderRecord(nextOrder);
    return nextOrder;
  });
  setToast(paymentStatus === "paid" ? "Payment marked paid in local preview." : "Payment requested in local preview.");
  setLoadingAction(null);
}

function applyPaymentStatus(order: PersistedOrder, paymentStatus: PaymentStatus, dueDate: string | null): PersistedOrder {
  return applyOrderPaymentUpdate(order, {
    paymentStatus,
    paymentMethod: "offline",
    paymentDueDate: dueDate,
    amountPaid: paymentStatus === "paid" ? order.totalValue : order.amountPaid,
  });
}

function addDaysIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function viewTitle(view: ViewMode) {
  if (view === "portal") return "Distributor Buying Portal";
  if (view === "launch") return "Pilot Launch Room";
  return "Brand Control Center";
}

function statusLabel(status: WorkspaceStatus) {
  const labels: Record<WorkspaceStatus, string> = {
    idle: "Idle",
    parsing: "Parsing",
    ready: "Draft ready",
    confirmed: "Brand approved",
    shared: "Link shared",
    distributor_confirmed: "Distributor confirmed",
  };
  return labels[status];
}

function orderStatusLabel(status: PersistedOrder["status"]) {
  const labels: Record<PersistedOrder["status"], string> = {
    draft: "Draft",
    approved: "Approved",
    link_created: "Link created",
    distributor_confirmed: "Distributor confirmed",
    cancelled: "Cancelled",
  };
  return labels[status];
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
    paypal: "paypal",
    card: "card",
    apple_pay: "apple_pay",
    offline: "offline",
  };
  return method ? map[method] || "offline" : "offline";
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

function statusTone(status: WorkspaceStatus): BadgeTone {
  if (status === "idle") return "slate";
  if (status === "parsing") return "blue";
  if (status === "distributor_confirmed") return "emerald";
  return "blue";
}

function levelTone(level: DistributorLevel): BadgeTone {
  if (level === "A") return "emerald";
  if (level === "B") return "blue";
  return "amber";
}

function riskTone(risk: DemoDistributor["risk"]): BadgeTone {
  if (risk === "Low") return "emerald";
  if (risk === "Review") return "amber";
  return "blue";
}

function PriceDelta({ value }: { value: number }) {
  if (value === 0) return <span className="text-slate-700">$0.00</span>;
  const label = `${value > 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
  return <span className={value < 0 ? "text-emerald-700" : "text-amber-700"}>{label}</span>;
}

function SavingsValue({ value }: { value: number }) {
  if (value === 0) return <span className="text-slate-700">$0.00</span>;
  const label = `${value > 0 ? "Save" : "Premium"} $${Math.abs(value).toFixed(2)}`;
  return <span className={value > 0 ? "text-emerald-700" : "text-amber-700"}>{label}</span>;
}

function calculateComparisonValue(
  items: OrderItem[],
  selectedLevel: DistributorLevel,
  compareLevel: DistributorLevel,
  products: Product[]
) {
  if (items.length) {
    return items.reduce(
      (sum, item) => sum + (item.levelPrices[compareLevel] - item.levelPrices[selectedLevel]) * item.qty,
      0
    );
  }

  return products.reduce(
    (sum, product) => sum + (product.levelPrices[compareLevel] - product.levelPrices[selectedLevel]) * product.moq,
    0
  );
}

function WorkflowStrip({
  status,
  hasItems,
  hasLink,
}: {
  status: WorkspaceStatus;
  hasItems: boolean;
  hasLink: boolean;
}) {
  const activeIndex =
    hasLink || status === "distributor_confirmed"
      ? 4
      : status === "confirmed"
        ? 3
        : hasItems
          ? 2
          : status === "parsing"
            ? 1
            : 0;

  return (
    <Panel>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">WhatsApp/Telegram to confirmed order</h2>
          <p className="text-sm text-slate-500">The whole pilot flow in one visible operating lane.</p>
        </div>
        <Badge tone={activeIndex >= 4 ? "emerald" : "blue"}>{workflowSteps[activeIndex]}</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        {workflowSteps.map((step, index) => {
          const done = index <= activeIndex;
          return (
            <div
              key={step}
              className={done ? "rounded-[8px] border border-blue-200 bg-blue-50 p-4" : "rounded-[8px] border border-slate-200 bg-slate-50 p-4"}
            >
              <div className={done ? "text-xs font-bold text-blue-700" : "text-xs font-bold text-slate-400"}>
                Step {index + 1}
              </div>
              <div className="mt-2 text-sm font-semibold">{step}</div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function OrderEventTimeline({
  status,
  savedOrder,
  sourceRecord,
  auditEvents,
}: {
  status: WorkspaceStatus;
  savedOrder: PersistedOrder | null;
  sourceRecord: SourceRecord | null;
  auditEvents?: PersistedOrderEvent[];
}) {
  const fallbackEvents = [
    { eventType: "product_imported", label: "Product imported", done: Boolean(auditEvents?.some((event) => event.eventType === "product_imported")) },
    { eventType: "message_pasted", label: "Message pasted", done: Boolean(sourceRecord) },
    { eventType: "draft_generated", label: "Draft generated", done: status !== "idle" && status !== "parsing" },
    { eventType: "brand_approved", label: "Brand approved", done: ["confirmed", "shared", "distributor_confirmed"].includes(status) },
    { eventType: "link_created", label: "Link created", done: ["shared", "distributor_confirmed"].includes(status) },
    { eventType: "distributor_confirmed", label: "Distributor confirmed", done: status === "distributor_confirmed" },
  ];

  const events = savedOrder?.events?.length
    ? [
        ...(auditEvents || []).filter((event) => !savedOrder.events.some((saved) => saved.eventType === event.eventType)).map((event) => ({ ...event, done: true })),
        ...savedOrder.events.map((event) => ({ ...event, done: true })),
        ...(savedOrder.status === "distributor_confirmed" && !savedOrder.events.some((event) => event.eventType === "distributor_confirmed")
          ? [{ eventType: "distributor_confirmed", label: "Distributor confirmed", done: true }]
          : []),
      ]
    : fallbackEvents;

  return (
    <div className="mt-4 space-y-3">
      {events.map((event, index) => {
        const createdAt = "createdAt" in event && typeof event.createdAt === "string" ? event.createdAt : "";
        return (
          <div key={`${event.eventType}-${index}`} className="flex gap-3">
            <div className={event.done ? "mt-0.5 h-6 w-6 rounded-full bg-slate-950 text-center text-xs font-bold leading-6 text-white" : "mt-0.5 h-6 w-6 rounded-full bg-slate-100 text-center text-xs font-bold leading-6 text-slate-400"}>
              {index + 1}
            </div>
            <div>
              <p className="text-sm font-semibold">{event.label}</p>
              <p className="text-xs text-slate-500">
                {createdAt ? new Date(createdAt).toLocaleString() : event.done ? "Completed in current workflow" : "Waiting"}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LevelRule({ level, text }: { level: DistributorLevel; text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-[8px] bg-white p-3 ring-1 ring-slate-200">
      <Badge tone={levelTone(level)}>{levelDetails[level].label}</Badge>
      <span className="text-slate-600">{text}</span>
    </div>
  );
}

function NavButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={active ? "w-full rounded-[8px] bg-slate-950 px-4 py-3 text-left text-sm font-semibold text-white" : "w-full rounded-[8px] px-4 py-3 text-left text-sm font-semibold text-slate-600 hover:bg-slate-50"}
    >
      {label}
    </button>
  );
}

function TopButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={active ? "rounded-[8px] bg-slate-950 px-4 py-2 text-sm font-semibold text-white" : "rounded-[8px] border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600"}
    >
      {children}
    </button>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="rounded-[8px] border border-slate-200 bg-white p-6 shadow-sm">{children}</section>;
}

function Stat({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
      <p className="mt-2 text-xs text-blue-700">{helper}</p>
    </div>
  );
}

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: BadgeTone }) {
  const classes: Record<BadgeTone, string> = {
    slate: "bg-slate-100 text-slate-700",
    blue: "bg-blue-50 text-blue-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
    violet: "bg-violet-50 text-violet-700",
  };
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${classes[tone]}`}>{children}</span>;
}

function ActionButton({
  children,
  onClick,
  disabled,
  tone = "blue",
  className = "",
  loading = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "blue" | "dark";
  className?: string;
  loading?: boolean;
}) {
  const color = tone === "dark" ? "bg-slate-950 text-white" : "bg-blue-700 text-white";
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`rounded-[8px] px-4 py-3 text-sm font-semibold disabled:opacity-40 ${color} ${className}`}
    >
      {children}
    </button>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block rounded-[8px] bg-white p-3 ring-1 ring-slate-200">
      <span className="text-xs text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full bg-transparent text-sm font-bold outline-none"
      >
        {children}
      </select>
    </label>
  );
}

function EditField({ label, value, onChange }: { label: string; value: number; onChange: (value: string) => void }) {
  return (
    <label className="block rounded-[8px] bg-white p-3 ring-1 ring-slate-200">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full bg-transparent text-sm font-bold outline-none"
      />
    </label>
  );
}

function ReadField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[8px] bg-white p-3 ring-1 ring-slate-200">
      <p className="text-xs text-slate-500">{label}</p>
      <div className="mt-1 text-sm font-bold">{value}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-[8px] border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">{text}</div>;
}

function Objection({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-[8px] bg-slate-50 p-4 ring-1 ring-slate-200">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm leading-6 text-slate-600">{text}</p>
    </div>
  );
}
