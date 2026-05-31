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
import { buildFinanceControl, type CollectionAction, type FinanceControl } from "@/lib/finance/control";
import { applyOrderPaymentUpdate } from "@/lib/orders/payment";
import { polishDemoProductName, polishDemoSku } from "@/lib/orders/product-display";
import {
  approvePortalPoRequest,
  createPortalPoRequest,
  payPortalOrder,
  requestPortalOrderPayment,
  type PortalOrderSnapshot,
  upsertPortalOrderRecord,
} from "@/lib/orders/portal-demo";
import { closeCheckoutWindow, isStripeCheckoutUrl, navigateCheckoutWindow, openCheckoutWindow } from "@/lib/payments/checkout-window";
import type { PaymentMethod, PaymentStatus } from "@/lib/payments/status";
import {
  acceptDistributorInvite,
  brandStorageKey,
  createDefaultBrandWorkspace,
  createDistributorInvite,
  upsertInviteByToken,
  type BrandWorkspace,
  type DistributorInvite,
} from "@/lib/workspace/tenant";

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
  status: "po_requested" | "draft" | "approved" | "link_created" | "distributor_confirmed" | "cancelled";
  shareToken: string;
  token: string;
  totalValue: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  paymentDueDate?: string | null;
  amountPaid: number;
  outstandingAmount: number;
  paymentRequestUrl?: string | null;
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
  | "invite"
  | "demoReset"
  | null;

const sampleMessage =
  "Hi, can you send 120 pcs of HydraGo Stainless Bottle and 30 pcs of AeroClean Smart Air Purifier next week? Use our approved Level A pricing.";

const launchPackages = [
  {
    name: "Launch Partner",
    price: "$1.5K setup + $799/mo",
    fit: "First official paid brands",
    promise: "Live catalog, 5 distributors, order-to-cash cockpit, weekly review.",
  },
  {
    name: "Growth",
    price: "$3.5K setup + $1.5K/mo",
    fit: "Brands with active distributor teams",
    promise: "25 distributors, payment workflow, analytics, onboarding support.",
  },
  {
    name: "Scale",
    price: "Custom",
    fit: "Multi-region or ERP-connected brands",
    promise: "Custom price books, approvals, integrations, finance controls.",
  },
];

const launchSegments = [
  { label: "Wholesale brand with 20-300 active distributors", score: "Best fit" },
  { label: "Orders arrive through WhatsApp, Telegram, email, or spreadsheets", score: "High pain" },
  { label: "Different prices by distributor, region, MOQ, or relationship tier", score: "Strong ROI" },
  { label: "Finance wants faster payment collection and cleaner AR visibility", score: "Budget owner" },
];

const launchMilestones = [
  { day: "Day 1", title: "Brand workspace", detail: "Import catalog, clean aliases, confirm MOQ and stock fields." },
  { day: "Day 3", title: "Distributor cohort", detail: "Load first 5-25 distributors, terms, levels, and invite links." },
  { day: "Day 7", title: "First live orders", detail: "Convert real messages and portal POs into approved order records." },
  { day: "Day 14", title: "Finance loop", detail: "Request payment, track AR, route rails, and review credit signals." },
  { day: "Day 30", title: "Expansion case", detail: "Report GMV, hours saved, cash pulled forward, and next distributors." },
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
  const [workspace] = useState<BrandWorkspace>(() => createDefaultBrandWorkspace());
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
  const [inviteRecords, setInviteRecords] = useState<DistributorInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState(demoDistributors[0].contactEmail || "");
  const [inviteStatus, setInviteStatus] = useState("No distributor invite sent in this session.");
  const [errorMessage, setErrorMessage] = useState("");
  const [loadingAction, setLoadingAction] = useState<ActionLoading>(null);

  const selectedDistributor =
    distributors.find((distributor) => distributor.id === selectedDistributorId) || distributors[0];
  const selectedLevel = selectedDistributor.level;
  const workspaceKey = (key: string) => brandStorageKey(workspace.id, key);

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
    loadDistributorInvites();
  }, []);

  useEffect(() => {
    const syncOrderRecords = () => loadOrderRecords();
    window.addEventListener("storage", syncOrderRecords);
    window.addEventListener("focus", syncOrderRecords);
    return () => {
      window.removeEventListener("storage", syncOrderRecords);
      window.removeEventListener("focus", syncOrderRecords);
    };
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
    const localCatalog =
      window.localStorage.getItem(workspaceKey("product-catalog")) ||
      window.localStorage.getItem("distributor-os-product-catalog");
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
      const response = await fetch("/api/catalog", {
        cache: "no-store",
        headers: { "x-distributor-os-brand-id": workspace.id },
      });
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
        window.localStorage.setItem(workspaceKey("product-catalog"), JSON.stringify(data.products));
        setCatalogSaveStatus("Loaded from Supabase product catalog");
      }
    } catch {
      setCatalogSaveStatus("Catalog API unavailable; using local/demo catalog.");
    }
  }

  async function saveCatalogProducts(nextProducts: Product[], source: CatalogImportSource) {
    setErrorMessage("");
    setCatalogProducts(nextProducts);
    window.localStorage.setItem(workspaceKey("product-catalog"), JSON.stringify(nextProducts));
    const sourceLabel = source === "xlsx" ? "XLSX" : source === "csv" ? "CSV" : "Product";
    setCatalogSaveStatus(`${sourceLabel} catalog saved locally`);
    appendAuditEvent("product_imported", `${sourceLabel} product catalog imported`);

    try {
      const response = await fetch("/api/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand_id: workspace.id, brand_name: workspace.name, products: nextProducts }),
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

  async function loadOrderRecords() {
    const localRecords: PersistedOrder[] = [];
    const remoteRecords: PersistedOrder[] = [];
    const raw =
      window.localStorage.getItem(workspaceKey("order-records")) ||
      window.localStorage.getItem("distributor-os-order-records");
    if (raw) {
      try {
        localRecords.push(...(JSON.parse(raw) as any[]).map(normalizePersistedOrder));
      } catch {
        window.localStorage.removeItem("distributor-os-order-records");
      }
    }

    localRecords.push(...readLocalSharedOrders(workspace.id));
    try {
      const response = await fetch(`/api/orders?brand_id=${encodeURIComponent(workspace.id)}`, { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.orders)) {
          remoteRecords.push(...data.orders.map(normalizePersistedOrder));
        }
      }
    } catch {
      // Local records keep the demo usable when the API is unavailable.
    }

    const remoteKeys = new Set(remoteRecords.map(getOrderSnapshotKey).filter(Boolean));
    const records = [
      ...localRecords.filter((order) => !remoteKeys.has(getOrderSnapshotKey(order))),
      ...remoteRecords,
    ];
    const parsed = ensureFinanceDemoStory(mergeLocalOrderSnapshots(records));
    if (!parsed.length) return;
    setOrderRecords(parsed);
    window.localStorage.setItem(workspaceKey("order-records"), JSON.stringify(parsed));
    parsed.forEach((order) => {
      window.localStorage.setItem(workspaceKey(`shared-order-${order.shareToken}`), JSON.stringify(order));
      window.localStorage.setItem(`distributor-os-shared-order-${order.shareToken}`, JSON.stringify(order));
    });
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

  function ensureFinanceDemoStory(records: PersistedOrder[]) {
    const seedKey = workspaceKey("finance-demo-story-v3");
    const hasOpenCash = records.some((order) => order.outstandingAmount > 0 && order.paymentStatus !== "paid");
    const alreadySeeded = window.localStorage.getItem(seedKey) === "true";
    if (records.length && (hasOpenCash || alreadySeeded)) return records;

    const financeSamples = createSeedDemoOrderRecords();
    window.localStorage.setItem(seedKey, "true");
    return mergeLocalOrderSnapshots([...financeSamples, ...records]);
  }

  function upsertOrderRecord(order: PersistedOrder) {
    try {
      window.localStorage.setItem(workspaceKey(`shared-order-${order.shareToken}`), JSON.stringify(order));
      window.localStorage.setItem(`distributor-os-shared-order-${order.shareToken}`, JSON.stringify(order));
    } catch {
      // Local storage can be unavailable in private browsing; keep React state working.
    }
    setOrderRecords((current) => {
      const next = mergeLocalOrderSnapshots([
        order,
        ...current.filter((item) => item.shareToken !== order.shareToken && item.id !== order.id),
      ]);
      window.localStorage.setItem(workspaceKey("order-records"), JSON.stringify(next));
      return next;
    });
  }

  function loadDistributorInvites() {
    const raw =
      window.localStorage.getItem(workspaceKey("distributor-invites")) ||
      window.localStorage.getItem("distributor-os-distributor-invites");
    if (!raw) {
      setInviteEmail(selectedDistributor.contactEmail || "");
      return;
    }

    try {
      const parsed = JSON.parse(raw) as DistributorInvite[];
      setInviteRecords(parsed.filter((invite) => invite.brandId === workspace.id));
      const latestForDistributor = parsed.find((invite) => invite.distributorId === selectedDistributor.id);
      if (latestForDistributor) {
        setInviteEmail(latestForDistributor.email);
        setInviteStatus(`${latestForDistributor.distributorName} invite is ${latestForDistributor.status}.`);
      }
    } catch {
      window.localStorage.removeItem(workspaceKey("distributor-invites"));
    }
  }

  function upsertInviteRecord(invite: DistributorInvite) {
    setInviteRecords((current) => {
      const next = upsertInviteByToken(current, invite);
      window.localStorage.setItem(workspaceKey("distributor-invites"), JSON.stringify(next));
      return next;
    });
  }

  async function sendDistributorInvite() {
    const email = inviteEmail.trim();
    if (!email) {
      setErrorMessage("Add the distributor email before creating an invite.");
      return;
    }

    setErrorMessage("");
    setLoadingAction("invite");
    const localInvite = createDistributorInvite({
      brandId: workspace.id,
      brandName: workspace.name,
      distributorId: selectedDistributor.id,
      distributorName: selectedDistributor.name,
      distributorLevel: selectedDistributor.level,
      email,
      appUrl: window.location.origin,
    });

    try {
      const response = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: workspace.id,
          brandName: workspace.name,
          distributorId: selectedDistributor.id,
          distributorName: selectedDistributor.name,
          distributorLevel: selectedDistributor.level,
          region: selectedDistributor.region,
          paymentTerms: selectedDistributor.terms,
          email,
          token: localInvite.token,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const savedInvite = normalizeDistributorInvite(data.invitation || localInvite, localInvite);
        upsertInviteRecord(savedInvite);
        setInviteStatus(`Invite created for ${savedInvite.email}.`);
        setToast(`Distributor invite ready: ${savedInvite.inviteUrl}`);
        setDistributors((current) =>
          current.map((distributor) =>
            distributor.id === selectedDistributor.id
              ? { ...distributor, contactEmail: email, portalStatus: "Invited" }
              : distributor
          )
        );
        return;
      }

      const error = await readApiError(response, "Invitation create failed");
      if (response.status !== 503) {
        setErrorMessage(`Failed distributor invite: ${error}`);
        setInviteStatus("Invite was not saved.");
        return;
      }
    } catch {
      // Use the local invite below when Supabase or email delivery is not configured.
    } finally {
      setLoadingAction(null);
    }

    upsertInviteRecord(localInvite);
    setInviteStatus("Invite created locally. Supabase env vars are missing.");
    setToast(`Local distributor invite ready: ${localInvite.inviteUrl}`);
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

    const localSharedOrder = readLocalSharedOrder(sharedOrderToken, workspace.id);
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
      brand_id: workspace.id,
      brand_name: workspace.name,
      distributor_name: selectedDistributor.name,
      distributor_level: selectedLevel,
      source_channel: sourceRecord.channel,
      original_message: sourceRecord.originalMessage,
      total_value: orderValue,
      items: items.map((item) => ({
        product_id: item.id,
        product_name: polishDemoProductName(item.name),
        sku: polishDemoSku(item.sku, item.name),
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
      window.localStorage.setItem(workspaceKey(`shared-order-${token}`), JSON.stringify(fallbackOrder));
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

  async function submitPortalOrderFromCart() {
    if (!cart.length) {
      setErrorMessage("Add at least one approved product before submitting a PO.");
      return null;
    }

    const belowMoq = cart.filter((item) => item.qty < item.moq);
    if (belowMoq.length) {
      setErrorMessage("Raise each line to MOQ before submitting the distributor PO.");
      return null;
    }

    setErrorMessage("");
    const localPortalOrder = normalizePersistedOrder(
      createPortalPoRequest({
        brandId: workspace.id,
        brandName: workspace.name,
        distributorId: selectedDistributor.id,
        distributorName: selectedDistributor.name,
        distributorLevel: selectedLevel,
        cartItems: cart,
      })
    );

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_id: workspace.id,
          brand_name: workspace.name,
          distributor_id: selectedDistributor.id,
          distributor_name: selectedDistributor.name,
          distributor_level: selectedLevel,
          source_channel: "Distributor Portal",
          order_status: "po_requested",
          original_message: `Portal PO from ${selectedDistributor.name}`,
          total_value: cartValue,
          items: cart.map((item) => ({
            product_id: item.id,
            product_name: polishDemoProductName(item.name),
            sku: polishDemoSku(item.sku, item.name),
            quantity: item.qty,
            unit_price: getLevelPrice(item, selectedLevel),
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
        const portalOrder = normalizePersistedOrder(data.order);
        persistPortalOrder(portalOrder);
        setCart([]);
        setShareLink("");
        setSharedOrderToken(portalOrder.shareToken);
        setToast(`Supabase PO ${portalOrder.orderNumber} received from ${portalOrder.distributorName}.`);
        return portalOrder;
      }
    } catch {
      // Fall back to local portal order below.
    }

    persistPortalOrder(localPortalOrder);
    setCart([]);
    setShareLink("");
    setSharedOrderToken(localPortalOrder.shareToken);
    setToast(`New PO request received from ${localPortalOrder.distributorName}. Open Control Center to approve it.`);
    return localPortalOrder;
  }

  async function approvePortalOrder(order: PersistedOrder) {
    let approved = normalizePersistedOrder(approvePortalPoRequest(asPortalOrderSnapshot(order)));
    try {
      const response = await fetch(`/api/orders/${order.shareToken}/approve`, { method: "POST" });
      if (response.ok) {
        const data = await response.json();
        approved = normalizePersistedOrder(data.order);
      }
    } catch {
      // Local fallback remains usable when API persistence is unavailable.
    }
    persistPortalOrder(approved);
    setStatus("confirmed");
    setShareLink("");
    setToast(`${approved.orderNumber} approved. Request payment when finance is ready.`);
  }

  async function requestPaymentForPortalOrder(order: PersistedOrder) {
    let requested = normalizePersistedOrder(requestPortalOrderPayment(asPortalOrderSnapshot(order)));
    let paymentUrl = requested.paymentRequestUrl || "";
    try {
      const response = await fetch(`/api/orders/${order.shareToken}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_status: "requested",
          payment_method: "card",
          payment_due_date: addDaysIso(7),
        }),
      });
      if (response.ok) {
        const data = await response.json();
        requested = normalizePersistedOrder(data.order);
        paymentUrl = data.paymentUrl || requested.paymentRequestUrl || "";
      }
    } catch {
      // Local fallback remains usable when API persistence is unavailable.
    }
    persistPortalOrder(requested);
    setStatus("confirmed");
    setShareLink(paymentUrl || "");
    setToast(paymentUrl
      ? `Stripe payment link ready for ${requested.orderNumber}.`
      : `Payment requested from ${requested.distributorName} for $${requested.outstandingAmount.toFixed(2)}.`
    );
  }

  async function markPortalOrderPaid(order: PersistedOrder) {
    let paid = normalizePersistedOrder(payPortalOrder(asPortalOrderSnapshot(order)));
    try {
      const response = await fetch(`/api/orders/${order.shareToken}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_status: "paid",
          payment_method: order.paymentMethod === "offline" ? "card" : order.paymentMethod,
          amount_paid: order.totalValue,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        paid = normalizePersistedOrder(data.order);
      }
    } catch {
      // Local fallback remains usable when API persistence is unavailable.
    }
    persistPortalOrder(paid);
    setStatus("confirmed");
    setShareLink("");
    setToast(`${paid.orderNumber} marked paid.`);
  }

  async function openPortalPaymentCheckout(order: PersistedOrder) {
    const checkoutWindow = openCheckoutWindow();
    let requested = normalizePersistedOrder(requestPortalOrderPayment(asPortalOrderSnapshot(order)));
    let paymentUrl = isStripeCheckoutUrl(order.paymentRequestUrl) ? order.paymentRequestUrl || "" : "";

    setErrorMessage("");

    if (!paymentUrl) {
      try {
        const response = await fetch(`/api/orders/${order.shareToken}/payment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payment_status: "requested",
            payment_method: "card",
            payment_due_date: requested.paymentDueDate,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          requested = normalizePersistedOrder(data.order);
          paymentUrl = data.paymentUrl || (isStripeCheckoutUrl(requested.paymentRequestUrl) ? requested.paymentRequestUrl || "" : "");
        } else {
          const error = await readApiError(response, "Stripe checkout failed");
          closeCheckoutWindow(checkoutWindow);
          setErrorMessage(`Stripe checkout could not open: ${error}`);
          setToast("Stripe checkout was not created.");
          return;
        }
      } catch (error: any) {
        closeCheckoutWindow(checkoutWindow);
        setErrorMessage(`Stripe checkout could not open: ${error?.message || "payment API unavailable"}`);
        setToast("Stripe checkout was not created.");
        return;
      }
    }

    if (!paymentUrl) {
      closeCheckoutWindow(checkoutWindow);
      persistPortalOrder(requested);
      setErrorMessage("Stripe checkout URL was not created. Check STRIPE_SECRET_KEY in Vercel, then request payment again.");
      setToast("Payment request saved, but Stripe checkout is not configured.");
      return;
    }

    persistPortalOrder({ ...requested, paymentRequestUrl: paymentUrl });
    setStatus("confirmed");
    setShareLink(paymentUrl);
    setToast(`Opening Stripe checkout for ${requested.orderNumber}.`);
    navigateCheckoutWindow(checkoutWindow, paymentUrl);
  }

  function persistPortalOrder(order: PersistedOrder) {
    upsertPortalOrderRecord(asPortalOrderSnapshot(order), workspace.id);
    upsertOrderRecord(order);
    setSavedOrder(order);
    setDraftOrder(order);
    setSharedOrderToken(order.shareToken);
  }

  function asPortalOrderSnapshot(order: PersistedOrder): PortalOrderSnapshot {
    return {
      ...order,
      brandId: workspace.id,
      brandName: workspace.name,
    };
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
    clearLocalDemoState(workspace.id);
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
    setInviteRecords([]);
    setInviteEmail(demoDistributors[0].contactEmail || "");
    setInviteStatus("Demo distributors seeded. Create invite links when ready.");
    setAuditEvents([]);
    setStatus(firstOrder ? "shared" : "idle");
    setSharedOrderToken(firstOrder?.shareToken || "");
    setShareLink(firstOrder ? `${window.location.origin}/order/${firstOrder.shareToken}` : "");

    window.localStorage.setItem(workspaceKey("product-catalog"), JSON.stringify(initialCatalogProducts));
    window.localStorage.setItem(workspaceKey("order-records"), JSON.stringify(seededOrders));
    window.localStorage.setItem("distributor-os-product-catalog", JSON.stringify(initialCatalogProducts));
    window.localStorage.setItem("distributor-os-order-records", JSON.stringify(seededOrders));
    seededOrders.forEach((order) => {
      window.localStorage.setItem(workspaceKey(`shared-order-${order.shareToken}`), JSON.stringify(order));
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
            <NavButton active={view === "launch"} onClick={() => setView("launch")} label="V1 Launch" />
          </nav>
          <div className="mt-8 rounded-[8px] border border-blue-100 bg-blue-50 p-4">
            <p className="font-semibold text-blue-950">Commercial launch</p>
            <p className="mt-2 text-sm leading-6 text-blue-800">
              Sell the exact brand service: tier pricing, source-backed orders, portal buying, AR, payment requests, and launch support.
            </p>
            <p className="mt-3 break-all text-xs font-semibold text-blue-900">Workspace: {workspace.slug}</p>
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <header className="border-b border-slate-200 bg-white px-6 py-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-sm text-slate-500">{workspace.name} / {selectedDistributor.name}</p>
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
              approvePortalOrder={approvePortalOrder}
              requestPaymentForPortalOrder={requestPaymentForPortalOrder}
              markPortalOrderPaid={markPortalOrderPaid}
              requestPayment={() => updateOrderPayment(sharedOrderToken, "requested", savedOrder, setSavedOrder, setDraftOrder, upsertOrderRecord, setToast, setErrorMessage, setLoadingAction)}
              markPaid={() => updateOrderPayment(sharedOrderToken, "paid", savedOrder, setSavedOrder, setDraftOrder, upsertOrderRecord, setToast, setErrorMessage, setLoadingAction)}
              runDemoFlow={runDemoFlow}
              resetAndSeedDemoData={resetAndSeedDemoData}
              loadingAction={loadingAction}
              workspace={workspace}
              inviteRecords={inviteRecords}
              inviteEmail={inviteEmail}
              setInviteEmail={setInviteEmail}
              inviteStatus={inviteStatus}
              sendDistributorInvite={sendDistributorInvite}
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
              brandName={workspace.name}
              confirmSharedOrder={() => {
                confirmOrderFromPortal(sharedOrderToken, setSavedOrder, setDraftOrder, upsertOrderRecord, setStatus, setToast, setErrorMessage, setLoadingAction);
              }}
              confirmLoading={loadingAction === "confirmDistributor"}
              orderRecords={orderRecords}
              submitPortalOrder={submitPortalOrderFromCart}
              openPortalPayment={openPortalPaymentCheckout}
            />
          )}

          {view === "launch" && (
            <PilotLaunch
              orderRecords={orderRecords}
              distributors={distributors}
              catalogProducts={catalogProducts}
            />
          )}
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
  approvePortalOrder,
  requestPaymentForPortalOrder,
  markPortalOrderPaid,
  requestPayment,
  markPaid,
  runDemoFlow,
  resetAndSeedDemoData,
  loadingAction,
  workspace,
  inviteRecords,
  inviteEmail,
  setInviteEmail,
  inviteStatus,
  sendDistributorInvite,
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
  approvePortalOrder: (order: PersistedOrder) => void;
  requestPaymentForPortalOrder: (order: PersistedOrder) => void;
  markPortalOrderPaid: (order: PersistedOrder) => void;
  requestPayment: () => void;
  markPaid: () => void;
  runDemoFlow: () => void;
  resetAndSeedDemoData: () => void;
  loadingAction: ActionLoading;
  workspace: BrandWorkspace;
  inviteRecords: DistributorInvite[];
  inviteEmail: string;
  setInviteEmail: (value: string) => void;
  inviteStatus: string;
  sendDistributorInvite: () => void;
}) {
  const [copyLabel, setCopyLabel] = useState("Copy Link");
  const savingsVsB = calculateComparisonValue(items, selectedDistributor.level, "B", catalogProducts);
  const savingsVsC = calculateComparisonValue(items, selectedDistributor.level, "C", catalogProducts);
  const pendingCount = orderRecords.filter((order) => order.status === "link_created" || order.status === "approved").length;
  const portalOrders = orderRecords.filter(
    (order) => order.sourceChannel === "Distributor Portal" || order.status === "po_requested"
  );
  const latestPortalOrder = portalOrders[0] || null;
  const portalOrderValue = portalOrders.reduce((sum, order) => sum + order.totalValue, 0);
  const portalOutstandingValue = portalOrders.reduce((sum, order) => sum + order.outstandingAmount, 0);
  const portalPaidCount = portalOrders.filter((order) => order.paymentStatus === "paid").length;
  const portalPaymentDueCount = portalOrders.filter((order) => order.paymentStatus === "requested").length;
  const analytics = useMemo(
    () => calculateChannelAnalytics({
      orders: buildAnalyticsOrders(orderRecords),
      products: catalogProducts,
    }),
    [catalogProducts, orderRecords]
  );
  const finance = useMemo(
    () => buildFinanceControl({ orders: orderRecords, distributors }),
    [orderRecords, distributors]
  );
  const deliveryEstimate = detectDelivery(sourceRecord?.originalMessage || message);
  const shareOrderNumber = savedOrder?.orderNumber || (sharedOrderToken ? `DO-${sharedOrderToken.slice(-4)}` : "Draft order");
  const shareOrderValue = savedOrder?.totalValue ?? orderValue;
  const shareMessage = buildOrderShareMessage({
    distributorName: selectedDistributor.name,
    brandName: workspace.name,
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
        <FinancePulseBanner finance={finance} />

        <div className="grid gap-4 md:grid-cols-4">
          <Stat label="Open AR" value={formatMoneyShort(finance.ar.totalOutstanding)} helper={`${finance.collectionQueue.length} finance actions`} />
          <Stat label="7-day cash forecast" value={formatMoneyShort(finance.ar.expectedSevenDayCash)} helper="AI-weighted collectible cash" />
          <Stat
            label="Payments due"
            value={formatMoneyShort(finance.ar.requestedOutstanding)}
            helper={finance.ar.requestedOutstanding ? `${portalPaymentDueCount || finance.collectionQueue.length} payment actions waiting` : "No requested payments"}
          />
          <Stat
            label="Payment rails"
            value="Bank first"
            helper="ACH / wire default; optional international rails"
          />
        </div>

        <WorkflowStrip status={status} hasItems={items.length > 0} hasLink={Boolean(shareLink)} />

        {latestPortalOrder && (
          <PortalOrderWorkflow order={latestPortalOrder} paidCount={portalPaidCount} />
        )}

        <FinanceCommandCenter finance={finance} />

        <Panel>
          <div className="mb-4 space-y-4">
            <div>
              <h2 className="text-xl font-bold">WhatsApp and Telegram intake</h2>
              <p className="text-sm text-slate-500">Paste the original distributor message. It stays attached to the generated order.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <ActionButton className="min-h-[52px]" onClick={runDemoFlow}>Run Demo Flow</ActionButton>
              <ActionButton className="min-h-[52px]" onClick={resetAndSeedDemoData} loading={loadingAction === "demoReset"}>Clean Demo Data</ActionButton>
              <ActionButton className="min-h-[52px]" onClick={parseMessage} tone="dark" loading={loadingAction === "generate"}>
                {loadingAction === "generate" ? "Generating..." : "Generate Draft"}
              </ActionButton>
              <ActionButton className="min-h-[52px]" onClick={confirmOrder} disabled={!items.length} loading={loadingAction === "approve"}>
                {loadingAction === "approve" ? "Approving..." : "Approve"}
              </ActionButton>
              <ActionButton className="min-h-[52px]" onClick={createLink} disabled={!items.length} loading={loadingAction === "createLink"}>
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
        <FinanceCollectionsPanel finance={finance} />

        <InboundPoPanel
          orders={portalOrders}
          approvePortalOrder={approvePortalOrder}
          requestPaymentForPortalOrder={requestPaymentForPortalOrder}
          markPortalOrderPaid={markPortalOrderPaid}
          showPortal={showPortal}
          loadingAction={loadingAction}
        />

        <Panel>
          <h2 className="font-bold">Brand workspace</h2>
          <p className="mt-1 text-sm text-slate-500">
            Pilot data is scoped to this brand workspace so catalog, orders, invites, analytics, and payments stay together.
          </p>
          <div className="mt-4 grid gap-3">
            <ReadField label="Brand" value={workspace.name} />
            <ReadField label="Workspace slug" value={workspace.slug} />
            <ReadField label="Data scope" value="Products, distributors, orders, invites" />
          </div>
        </Panel>

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
                    <p className="text-xs text-slate-500">{distributor.region} / {distributor.terms} / {distributor.portalStatus || "Invited"}</p>
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
          <h2 className="font-bold">Distributor invite flow</h2>
          <p className="mt-1 text-sm text-slate-500">
            Invite the selected distributor into the brand-scoped portal without exposing other brand data.
          </p>
          <div className="mt-4 grid gap-3">
            <ReadField label="Selected distributor" value={selectedDistributor.name} />
            <ReadField label="Portal level" value={levelDetails[selectedDistributor.level].label} />
            <label className="block rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-xs text-slate-500">Distributor email</span>
              <input
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                className="mt-1 w-full bg-transparent text-sm font-semibold outline-none"
                placeholder="buyer@example.com"
              />
            </label>
            <ActionButton onClick={sendDistributorInvite} loading={loadingAction === "invite"}>
              {loadingAction === "invite" ? "Creating invite..." : "Create Portal Invite"}
            </ActionButton>
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-600">{inviteStatus}</p>
          <div className="mt-4 space-y-3">
            {!inviteRecords.length && <EmptyState text="No invite links yet. Create one for the selected distributor." />}
            {inviteRecords.slice(0, 3).map((invite) => (
              <div key={invite.token} className="rounded-[8px] bg-slate-50 p-4 ring-1 ring-slate-200">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">{invite.distributorName}</p>
                  <Badge tone={invite.status === "accepted" ? "emerald" : invite.status === "expired" ? "rose" : "blue"}>{invite.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">{invite.email} / {levelDetails[invite.distributorLevel].label}</p>
                <a href={invite.inviteUrl} target="_blank" className="mt-2 block break-all text-xs font-bold text-blue-700">
                  {invite.inviteUrl}
                </a>
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

function InboundPoPanel({
  orders,
  approvePortalOrder,
  requestPaymentForPortalOrder,
  markPortalOrderPaid,
  showPortal,
  loadingAction,
}: {
  orders: PersistedOrder[];
  approvePortalOrder: (order: PersistedOrder) => void;
  requestPaymentForPortalOrder: (order: PersistedOrder) => void;
  markPortalOrderPaid: (order: PersistedOrder) => void;
  showPortal: () => void;
  loadingAction: ActionLoading;
}) {
  const newCount = orders.filter((order) => order.status === "po_requested").length;
  const paidCount = orders.filter((order) => order.paymentStatus === "paid").length;
  const dueCount = orders.filter((order) => order.paymentStatus === "requested").length;
  const summaryLabel = newCount
    ? `${newCount} new`
    : dueCount
      ? `${dueCount} due`
      : paidCount
        ? `${paidCount} paid`
        : "All clear";
  const summaryTone: BadgeTone = newCount ? "blue" : dueCount ? "amber" : paidCount ? "emerald" : "slate";

  return (
    <Panel>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-bold">Inbound PO requests</h2>
          <p className="mt-1 text-sm text-slate-500">Distributor portal orders land here for brand review and payment.</p>
        </div>
        <Badge tone={summaryTone}>{summaryLabel}</Badge>
      </div>

      {!orders.length && (
        <div className="mt-4">
          <EmptyState text="No distributor PO requests yet. Submit one from the portal to demo the loop." />
        </div>
      )}

      <div className="mt-4 space-y-4">
        {orders.slice(0, 4).map((order) => {
          const canApprove = order.status === "po_requested";
          const canRequestPayment = order.status !== "po_requested" && order.paymentStatus !== "paid";
          const canMarkPaid = order.paymentStatus === "requested" || order.paymentStatus === "partial";
          return (
            <div
              key={order.shareToken || order.id}
              className={order.paymentStatus === "paid" ? "rounded-[8px] border border-emerald-200 bg-emerald-50/40 p-4" : "rounded-[8px] border border-slate-200 bg-slate-50 p-4"}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{order.orderNumber}</p>
                  <p className="text-xs text-slate-500">{order.distributorName} / {levelDetails[order.distributorLevel].label}</p>
                </div>
                <Badge tone={order.status === "po_requested" ? "blue" : order.paymentStatus === "paid" ? "emerald" : "amber"}>
                  {order.status === "po_requested" ? "PO requested" : paymentStatusLabel(order.paymentStatus)}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <ReadField label="Total" value={`$${order.totalValue.toFixed(2)}`} />
                <ReadField label="Outstanding" value={`$${order.outstandingAmount.toFixed(2)}`} />
              </div>
              <div className="mt-3 rounded-[8px] bg-white p-3 text-xs leading-5 text-slate-600 ring-1 ring-slate-200">
                {order.items.slice(0, 2).map((item) => `${item.quantity} x ${item.productName || item.name}`).join(" / ")}
                {order.items.length > 2 ? ` / +${order.items.length - 2} more` : ""}
              </div>
              <div className="mt-3 grid gap-2">
                {canApprove && (
                  <ActionButton onClick={() => approvePortalOrder(order)} loading={loadingAction === "approve"}>
                    Approve PO
                  </ActionButton>
                )}
                {canRequestPayment && (
                  <ActionButton
                    onClick={() => requestPaymentForPortalOrder(order)}
                    disabled={order.paymentStatus === "requested"}
                    loading={loadingAction === "requestPayment"}
                  >
                    {order.paymentStatus === "requested" ? "Payment requested" : "Request Payment"}
                  </ActionButton>
                )}
                {canMarkPaid && (
                  <button
                    onClick={() => markPortalOrderPaid(order)}
                    disabled={loadingAction === "markPaid"}
                    className="rounded-[8px] border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-40"
                  >
                    {loadingAction === "markPaid" ? "Marking..." : "Mark as Paid"}
                  </button>
                )}
                {order.paymentRequestUrl && order.paymentStatus === "requested" && (
                  <a
                    href={order.paymentRequestUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-[8px] border border-blue-200 bg-white px-4 py-3 text-sm font-bold text-blue-700"
                  >
                    Open secure payment link
                  </a>
                )}
                <button onClick={showPortal} className="text-left text-sm font-bold text-blue-700">
                  Preview distributor payment view
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function FinancePulseBanner({ finance }: { finance: FinanceControl }) {
  const nextAction = finance.collectionQueue[0];
  const topProfile = finance.creditProfiles[0];

  return (
    <section className="rounded-[8px] border border-blue-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
        <div>
          <div className="mb-3 flex flex-wrap gap-2">
            <Badge tone="blue">New finance layer</Badge>
            <Badge tone={finance.ar.overdueOutstanding ? "rose" : finance.ar.totalOutstanding ? "amber" : "emerald"}>
              {finance.ar.overdueOutstanding ? "Overdue cash" : finance.ar.totalOutstanding ? "Cash in motion" : "AR clean"}
            </Badge>
          </div>
          <h2 className="text-2xl font-bold">Order-to-cash control: approve, request payment, collect, and reward good distributors.</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            The demo now turns every distributor PO into finance data: AR exposure, cash forecast, credit terms, pricing rewards, and the best payment rail.
          </p>
        </div>
        <div className="grid min-w-[320px] gap-3 sm:grid-cols-2">
          <ReadField label="Next cash action" value={nextAction ? nextAction.recommendedAction : "No action needed"} />
          <ReadField label="Suggested rail" value={nextAction ? paymentRailLabel(nextAction.paymentRail) : "ACH / bank ready"} />
          <ReadField label="Best distributor score" value={topProfile ? `${topProfile.trustScore}/100` : "No activity"} />
          <ReadField label="Terms logic" value={topProfile?.recommendedTerms || "Build payment history"} />
        </div>
      </div>
    </section>
  );
}

function FinanceCommandCenter({ finance }: { finance: FinanceControl }) {
  const topProfile = finance.creditProfiles[0];
  const nextAction = finance.collectionQueue[0];

  return (
    <Panel>
      <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h2 className="text-xl font-bold">Finance command center</h2>
          <p className="text-sm text-slate-500">AR, cash forecast, payment rails, and AI-style finance recommendations.</p>
        </div>
        <Badge tone={finance.ar.overdueOutstanding ? "rose" : finance.ar.totalOutstanding ? "amber" : "emerald"}>
          {finance.ar.overdueOutstanding ? "Collect overdue" : finance.ar.totalOutstanding ? "Cash in motion" : "AR clean"}
        </Badge>
      </div>

      <div className="mb-4 rounded-[8px] border border-blue-200 bg-blue-50 p-4">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Next cash move</p>
            <h3 className="mt-1 text-2xl font-bold text-blue-950">
              {nextAction ? nextAction.recommendedAction : "No collection action needed"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-blue-900">
              {nextAction
                ? nextAction.message
                : "Every open order is paid. Use early-pay rewards to keep future cash cycles tight."}
            </p>
          </div>
          <div className="grid min-w-[280px] gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <ReadField label="Amount" value={nextAction ? formatMoneyShort(nextAction.outstandingAmount) : "$0"} />
            <ReadField label="Due" value={nextAction?.dueLabel || "No open AR"} />
            <ReadField label="Rail" value={nextAction ? paymentRailLabel(nextAction.paymentRail) : "ACH / bank ready"} />
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <ReadField label="Open AR" value={formatMoneyShort(finance.ar.totalOutstanding)} />
        <ReadField label="Overdue" value={formatMoneyShort(finance.ar.overdueOutstanding)} />
        <ReadField label="7-day cash forecast" value={formatMoneyShort(finance.ar.expectedSevenDayCash)} />
        <ReadField label="30-day cash forecast" value={formatMoneyShort(finance.ar.expectedThirtyDayCash)} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_360px]">
        <ArAgingTable finance={finance} />
        <PaymentRailPanel finance={finance} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-[8px] bg-slate-50 p-4 ring-1 ring-slate-200">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Distributor finance score</p>
              <p className="text-xs text-slate-500">{topProfile?.distributorName || "No distributor activity yet"}</p>
            </div>
            {topProfile && <Badge tone={topProfile.trustScore >= 85 ? "emerald" : topProfile.trustScore >= 70 ? "blue" : "amber"}>{topProfile.trustScore}/100</Badge>}
          </div>
          {topProfile ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <ReadField label="Recommended terms" value={topProfile.recommendedTerms} />
              <ReadField label="Credit limit" value={formatMoneyShort(topProfile.recommendedCreditLimit)} />
              <ReadField label="Pricing reward" value={topProfile.pricingReward} />
              <ReadField label="Risk reason" value={topProfile.riskReason} />
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-500">Submit and collect a portal PO to build a finance score.</p>
          )}
          {topProfile && (
            <div className="mt-4 rounded-[8px] bg-white p-3 ring-1 ring-slate-200">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Why the AI chose this</p>
              <div className="mt-2 space-y-2">
                {topProfile.signals.map((signal) => (
                  <div key={signal} className="rounded-[8px] bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                    {signal}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-[8px] bg-blue-50 p-4 ring-1 ring-blue-100">
          <p className="font-semibold text-blue-950">Finance copilot recommendations</p>
          <p className="mt-1 text-xs leading-5 text-blue-900">Recommendations stay advisory: the brand still approves terms, payment requests, and settlement rails.</p>
          <div className="mt-3 space-y-2">
            {finance.recommendations.map((recommendation) => (
              <div key={recommendation} className="rounded-[8px] bg-white px-3 py-2 text-sm font-semibold text-blue-900 ring-1 ring-blue-100">
                {recommendation}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function ArAgingTable({ finance }: { finance: FinanceControl }) {
  return (
    <div className="rounded-[8px] bg-white p-4 ring-1 ring-slate-200">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold">AR aging and cash actions</p>
          <p className="text-xs text-slate-500">The control panel should show exactly what money is waiting and what to do next.</p>
        </div>
        <Badge tone={finance.collectionQueue.length ? "amber" : "emerald"}>{finance.collectionQueue.length} open</Badge>
      </div>
      {!finance.collectionQueue.length && <EmptyState text="No open AR. Submit or request payment on a PO to populate this table." />}
      <div className="space-y-2">
        {finance.collectionQueue.slice(0, 4).map((action) => (
          <div key={`${action.orderNumber}-${action.distributorName}`} className="grid gap-3 rounded-[8px] bg-slate-50 p-3 ring-1 ring-slate-200 md:grid-cols-[1fr_110px_90px_120px] md:items-center">
            <div>
              <p className="font-semibold">{action.orderNumber}</p>
              <p className="text-xs text-slate-500">{action.distributorName} / {paymentStatusLabel(action.paymentStatus)}</p>
            </div>
            <div className="text-sm font-bold">{formatMoneyShort(action.outstandingAmount)}</div>
            <Badge tone={action.urgency === "high" ? "rose" : action.urgency === "medium" ? "amber" : "blue"}>{action.dueLabel}</Badge>
            <div className="text-xs font-bold text-blue-700">{paymentRailLabel(action.paymentRail)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PaymentRailPanel({ finance }: { finance: FinanceControl }) {
  const activeRails = new Set(finance.collectionQueue.map((action) => action.paymentRail));
  const rails: Array<{ rail: CollectionAction["paymentRail"]; label: string; helper: string }> = [
    { rail: "ach", label: "ACH / bank debit", helper: "Low-cost domestic B2B collection" },
    { rail: "bank_transfer", label: "Wire / bank transfer", helper: "Default invoice settlement rail" },
    { rail: "card", label: "Card", helper: "Small or urgent distributor balances" },
    { rail: "stablecoin_usdc", label: "Optional USDC settlement", helper: "Only for approved international distributor preference" },
  ];

  return (
    <div className="rounded-[8px] bg-slate-950 p-4 text-white">
      <p className="font-semibold">Payment rail routing</p>
      <p className="mt-1 text-xs leading-5 text-slate-300">Route each invoice by value, geography, urgency, and distributor preference.</p>
      <div className="mt-4 space-y-2">
        {rails.map((rail) => {
          const active = activeRails.has(rail.rail);
          return (
            <div key={rail.rail} className={`rounded-[8px] p-3 ring-1 ${active ? "bg-white text-slate-950 ring-white" : "bg-slate-900 text-slate-300 ring-slate-700"}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold">{rail.label}</p>
                <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${active ? "bg-emerald-50 text-emerald-700" : "bg-slate-800 text-slate-400"}`}>
                  {active ? "active" : "ready"}
                </span>
              </div>
              <p className="mt-1 text-xs leading-5">{rail.helper}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FinanceCollectionsPanel({ finance }: { finance: FinanceControl }) {
  const nextAction = finance.collectionQueue[0];

  return (
    <Panel>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-bold">Cash collection queue</h2>
          <p className="mt-1 text-sm text-slate-500">Prioritized by due date, risk, amount, and payment rail.</p>
        </div>
        <Badge tone={nextAction?.urgency === "high" ? "rose" : nextAction ? "amber" : "emerald"}>
          {nextAction ? nextAction.urgency : "clear"}
        </Badge>
      </div>

      {!finance.collectionQueue.length && (
        <div className="mt-4">
          <EmptyState text="No open collection actions. Paid portal orders keep AR clean." />
        </div>
      )}

      <div className="mt-4 space-y-3">
        {finance.collectionQueue.slice(0, 3).map((action) => (
          <CollectionActionCard key={`${action.orderNumber}-${action.recommendedAction}`} action={action} />
        ))}
      </div>
    </Panel>
  );
}

function CollectionActionCard({ action }: { action: CollectionAction }) {
  return (
    <div className="rounded-[8px] bg-slate-50 p-4 ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{action.orderNumber}</p>
          <p className="text-xs text-slate-500">{action.distributorName} / {formatMoneyShort(action.outstandingAmount)} open / {action.dueLabel}</p>
        </div>
        <Badge tone={action.urgency === "high" ? "rose" : action.urgency === "medium" ? "amber" : "blue"}>{action.urgency}</Badge>
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-700">{action.recommendedAction}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{action.message}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-[8px] bg-white px-3 py-2 text-xs font-bold text-blue-700 ring-1 ring-slate-200">
          Rail: {paymentRailLabel(action.paymentRail)}
        </div>
        <div className="rounded-[8px] bg-white px-3 py-2 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
          Status: {paymentStatusLabel(action.paymentStatus)}
        </div>
      </div>
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
  brandName,
  confirmSharedOrder,
  confirmLoading,
  orderRecords,
  submitPortalOrder,
  openPortalPayment,
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
  brandName: string;
  confirmSharedOrder: () => void;
  confirmLoading: boolean;
  orderRecords: PersistedOrder[];
  submitPortalOrder: () => Promise<PersistedOrder | null>;
  openPortalPayment: (order: PersistedOrder) => Promise<void>;
}) {
  const [poStatus, setPoStatus] = useState("");
  const cartMoqIssues = cart.filter((item) => item.qty < item.moq).length;
  const distributorOrders = orderRecords.filter(
    (order) => order.distributorId === selectedDistributor.id || order.distributorName === selectedDistributor.name
  );
  const paymentOrder = distributorOrders.find(
    (order) => order.paymentStatus === "requested" && order.outstandingAmount > 0
  );

  return (
    <div className="grid gap-6 px-6 py-6 xl:grid-cols-[1fr_380px]">
      <section className="space-y-6">
        <div className="rounded-[8px] bg-slate-950 p-6 text-white">
          <p className="text-sm text-slate-300">{selectedDistributor.name} / {levelDetails[selectedLevel].label} / {selectedDistributor.terms}</p>
          <h2 className="mt-2 text-2xl font-bold">Approved buying portal for {brandName}</h2>
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
                onClick={async () => {
                  const order = await submitPortalOrder();
                  if (order) setPoStatus(`${order.orderNumber} submitted to brand control center.`);
                }}
              >
                Request Order / Submit PO
              </ActionButton>
            </div>
          )}
        </Panel>

        {paymentOrder && (
          <Panel>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-bold">Payment requested</h2>
              <Badge tone="amber">{paymentStatusLabel(paymentOrder.paymentStatus)}</Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <ReadField label="Order" value={paymentOrder.orderNumber} />
              <ReadField label="Due" value={paymentOrder.paymentDueDate ? new Date(paymentOrder.paymentDueDate).toLocaleDateString() : "Net terms"} />
              <ReadField label="Amount due" value={`$${paymentOrder.outstandingAmount.toFixed(2)}`} />
              <ReadField label="Method" value="Stripe Checkout" />
            </div>
            <ActionButton
              className="mt-4 w-full"
              onClick={async () => {
                await openPortalPayment(paymentOrder);
                setPoStatus(`${paymentOrder.orderNumber} secure checkout opened.`);
              }}
            >
              Pay with secure checkout
            </ActionButton>
          </Panel>
        )}

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
            {!distributorOrders.length && <EmptyState text="No orders yet. Confirmed and shared orders will appear here." />}
            {distributorOrders.map((order) => (
              <div key={order.id || order.shareToken} className="rounded-[8px] bg-slate-50 p-4 ring-1 ring-slate-200">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{order.orderNumber}</p>
                  <Badge tone={order.paymentStatus === "paid" ? "emerald" : order.status === "po_requested" ? "blue" : "amber"}>
                    {order.paymentStatus === "paid" ? "Paid" : orderStatusLabel(order.status)}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500">${order.totalValue.toLocaleString()} / {paymentStatusLabel(order.paymentStatus)} / {levelDetails[order.distributorLevel].label}</p>
                {order.paymentStatus === "requested" && order.outstandingAmount > 0 && (
                  <ActionButton
                    className="mt-3 w-full"
                    onClick={async () => {
                      await openPortalPayment(order);
                      setPoStatus(`${order.orderNumber} secure checkout opened.`);
                    }}
                  >
                    Pay with secure checkout
                  </ActionButton>
                )}
              </div>
            ))}
          </div>
        </Panel>
      </aside>
    </div>
  );
}

function PilotLaunch({
  orderRecords,
  distributors,
  catalogProducts,
}: {
  orderRecords: PersistedOrder[];
  distributors: DemoDistributor[];
  catalogProducts: Product[];
}) {
  const finance = buildFinanceControl({ orders: orderRecords, distributors });
  const paidOrders = orderRecords.filter((order) => order.paymentStatus === "paid").length;
  const requestedPayments = orderRecords.filter((order) => order.paymentStatus === "requested").length;
  const portalOrders = orderRecords.filter((order) => order.sourceChannel === "Distributor Portal" || order.status === "po_requested").length;
  const sourceBackedOrders = orderRecords.filter((order) => order.originalMessage).length;
  const orderValue = orderRecords.reduce((sum, order) => sum + order.totalValue, 0);
  const activeDistributors = distributors.filter((distributor) => distributor.portalStatus === "Active" || distributor.portalStatus === "Accepted").length;
  const launchGates = [
    {
      label: "Catalog and price books",
      detail: `${catalogProducts.length} SKUs with Level A/B/C pricing`,
      owner: "Implementation",
      ready: catalogProducts.length >= 4,
    },
    {
      label: "Distributor cohort",
      detail: `${activeDistributors || distributors.length} distributors ready for invite or portal access`,
      owner: "Sales",
      ready: distributors.length >= 3,
    },
    {
      label: "Order workflow proof",
      detail: `${orderRecords.length} orders across chat, links, and portal POs`,
      owner: "Ops",
      ready: orderRecords.length >= 3,
    },
    {
      label: "Payment and AR loop",
      detail: `${requestedPayments} payment requests, ${paidOrders} paid orders, ${formatMoneyShort(finance.ar.totalOutstanding)} open AR`,
      owner: "Finance",
      ready: requestedPayments > 0 || paidOrders > 0 || finance.ar.totalOutstanding > 0,
    },
    {
      label: "Source transparency",
      detail: `${sourceBackedOrders} source-backed order records`,
      owner: "Account team",
      ready: sourceBackedOrders > 0,
    },
    {
      label: "Distributor buying portal",
      detail: `${portalOrders} portal POs in the operating loop`,
      owner: "Customer success",
      ready: portalOrders > 0,
    },
  ];
  const readyCount = launchGates.filter((gate) => gate.ready).length;
  const readinessScore = Math.round((readyCount / launchGates.length) * 100);
  const modeledMonthlyGmv = Math.max(186000, orderValue);
  const manualHoursSaved = Math.max(28, orderRecords.length * 4);
  const cashPulledForward = Math.max(finance.ar.expectedSevenDayCash, 28500);
  const marginProtected = Math.round(modeledMonthlyGmv * 0.012);

  return (
    <div className="grid gap-6 px-6 py-6 xl:grid-cols-[1fr_390px]">
      <section className="space-y-6">
        <Panel>
          <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
            <div>
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge tone={readinessScore >= 85 ? "emerald" : readinessScore >= 65 ? "blue" : "amber"}>
                  {readinessScore}% launch ready
                </Badge>
                <Badge tone="violet">Official V1 offer</Badge>
              </div>
              <h2 className="text-2xl font-bold">Sell Distributor OS as the order-to-cash operating system for distributor brands.</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                The first official version should promise one thing clearly: brands keep their distributor relationships, while Distributor OS turns chat, portal POs, pricing, approvals, AR, and payment requests into one controlled workflow.
              </p>
            </div>
            <div className="grid min-w-[300px] gap-3 sm:grid-cols-2">
              <ReadField label="Modeled monthly GMV" value={formatMoneyShort(modeledMonthlyGmv)} />
              <ReadField label="Cash pulled forward" value={formatMoneyShort(cashPulledForward)} />
              <ReadField label="Manual hours saved" value={`${manualHoursSaved}/mo`} />
              <ReadField label="Margin protected" value={formatMoneyShort(marginProtected)} />
            </div>
          </div>
        </Panel>

        <Panel>
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
            <div>
              <h2 className="text-xl font-bold">V1 launch readiness gates</h2>
              <p className="text-sm text-slate-500">Use this as the paid implementation checklist for every first brand.</p>
            </div>
            <Badge tone={readinessScore >= 85 ? "emerald" : "blue"}>{readyCount}/{launchGates.length} ready</Badge>
          </div>
          <div className="mt-5 space-y-3">
            {launchGates.map((gate) => (
              <LaunchGate key={gate.label} {...gate} />
            ))}
          </div>
        </Panel>

        <Panel>
          <h2 className="text-xl font-bold">Paid launch packages</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Start with a paid launch partner offer. Keep scope tight enough to deliver, but valuable enough that finance, sales, and operations all care.
          </p>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {launchPackages.map((item) => (
              <LaunchPackageCard key={item.name} {...item} />
            ))}
          </div>
        </Panel>

        <Panel>
          <h2 className="text-xl font-bold">ROI model brands understand</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-4">
            <Stat label="Order value controlled" value={formatMoneyShort(modeledMonthlyGmv)} helper="GMV flowing through distributor ops" />
            <Stat label="Cash forecasted" value={formatMoneyShort(finance.ar.expectedThirtyDayCash || cashPulledForward)} helper="AR visibility for finance" />
            <Stat label="Ops time saved" value={`${manualHoursSaved}h`} helper="Chat, spreadsheet, and follow-up reduction" />
            <Stat label="Payback target" value="30d" helper="First value inside one monthly close" />
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <LaunchProofPoint title="Revenue team" text="Better distributor buying experience without forcing every buyer into a new workflow on day one." />
            <LaunchProofPoint title="Finance team" text="Payment requests, AR aging, credit signals, and optional settlement rails are visible before orders pile up." />
            <LaunchProofPoint title="Operations team" text="SKU matching, MOQ, stock, lead time, and price level checks happen before an order is approved." />
            <LaunchProofPoint title="Founder or GM" text="The product can be sold as a measurable cash-flow and distributor growth layer, not another catalog portal." />
          </div>
        </Panel>

        <Panel>
          <h2 className="text-xl font-bold">First 30 days implementation</h2>
          <div className="mt-5 grid gap-3">
            {launchMilestones.map((milestone) => (
              <div key={milestone.day} className="grid gap-3 rounded-[8px] border border-slate-200 bg-slate-50 p-4 md:grid-cols-[90px_180px_1fr] md:items-center">
                <Badge tone="blue">{milestone.day}</Badge>
                <p className="font-semibold">{milestone.title}</p>
                <p className="text-sm leading-6 text-slate-600">{milestone.detail}</p>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <aside className="space-y-6">
        <Panel>
          <h2 className="font-bold">Best-fit brand profile</h2>
          <div className="mt-4 space-y-3">
            {launchSegments.map((segment) => (
              <div key={segment.label} className="rounded-[8px] bg-slate-50 p-4 ring-1 ring-slate-200">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold leading-5">{segment.label}</p>
                  <Badge tone={segment.score === "Best fit" ? "emerald" : segment.score === "Budget owner" ? "violet" : "blue"}>{segment.score}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <h2 className="font-bold">Sales narrative</h2>
          <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
            <p><strong className="text-slate-950">Hook:</strong> Your distributors already buy through messy channels. We turn those channels into controlled orders and collectible cash.</p>
            <p><strong className="text-slate-950">Proof:</strong> Live catalog, level pricing, portal PO, payment request, AR aging, and finance recommendations in one demo.</p>
            <p><strong className="text-slate-950">Close:</strong> Start with 5 distributors, one product category, and one monthly finance review.</p>
          </div>
        </Panel>

        <Panel>
          <h2 className="font-bold">Qualification checklist</h2>
          <div className="mt-4 space-y-3">
            <Objection title="Economic buyer" text="VP Sales, Head of Wholesale, COO, or finance leader who owns channel cash flow." />
            <Objection title="Trigger event" text="Distributor growth, margin leakage, delayed collections, or messy WhatsApp/email ordering." />
            <Objection title="Fast pilot data" text="Need catalog export, distributor list, price levels, terms, and 10 recent order messages." />
          </div>
        </Panel>

        <Panel>
          <h2 className="font-bold">Objection handling</h2>
          <div className="mt-4 space-y-3">
            <Objection title="We already use Shopify/Faire/ERP" text="Keep them. Distributor OS sits where distributor intent, pricing, approval, and payment follow-up actually happen." />
            <Objection title="Our pricing is too custom" text="Start with A/B/C levels, then add distributor-specific overrides only after the first cohort proves value." />
            <Objection title="Distributors will not log in" text="Begin with approval and payment links. The portal becomes useful after buyers see accurate prices and order history." />
            <Objection title="Finance needs control" text="Payment actions stay brand-approved. AI recommends terms and rails; it does not move money by itself." />
          </div>
        </Panel>
      </aside>
    </div>
  );
}

function LaunchGate({
  label,
  detail,
  owner,
  ready,
}: {
  label: string;
  detail: string;
  owner: string;
  ready: boolean;
}) {
  return (
    <div className="grid gap-3 rounded-[8px] border border-slate-200 bg-slate-50 p-4 md:grid-cols-[1fr_150px_120px] md:items-center">
      <div>
        <p className="font-semibold">{label}</p>
        <p className="mt-1 text-sm text-slate-500">{detail}</p>
      </div>
      <p className="text-sm text-slate-500">{owner}</p>
      <Badge tone={ready ? "emerald" : "amber"}>{ready ? "Ready" : "Needs setup"}</Badge>
    </div>
  );
}

function LaunchPackageCard({
  name,
  price,
  fit,
  promise,
}: {
  name: string;
  price: string;
  fit: string;
  promise: string;
}) {
  return (
    <div className="rounded-[8px] border border-slate-200 bg-slate-50 p-5">
      <p className="text-sm font-bold text-blue-700">{name}</p>
      <p className="mt-2 text-2xl font-bold">{price}</p>
      <p className="mt-2 text-sm font-semibold text-slate-700">{fit}</p>
      <p className="mt-3 text-sm leading-6 text-slate-600">{promise}</p>
    </div>
  );
}

function LaunchProofPoint({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-[8px] bg-slate-50 p-4 ring-1 ring-slate-200">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm leading-6 text-slate-600">{text}</p>
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
    paymentRequestUrl: null,
    createdAt: new Date().toISOString(),
    items: items.map((item) => ({
      id: item.id,
      productId: item.id,
      productName: polishDemoProductName(item.name),
      name: polishDemoProductName(item.name),
      sku: polishDemoSku(item.sku, item.name),
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
    paymentRequestUrl: order.paymentRequestUrl || order.payment_request_url || order.requestUrl || order.request_url || null,
    createdAt: order.createdAt || order.created_at,
    items: (order.items || []).map((item: any) => {
      const rawProductName = item.productName || item.product_name || item.name;
      const productName = polishDemoProductName(rawProductName);
      const quantity = Number(item.quantity ?? item.qty ?? 0);
      const unitPrice = Number(item.unitPrice ?? item.unit_price ?? item.levelPrice ?? 0);
      return {
        id: item.id,
        productId: item.productId || item.product_id,
        productName,
        name: polishDemoProductName(item.name || rawProductName),
        sku: polishDemoSku(item.sku, rawProductName),
        quantity,
        qty: Number(item.qty ?? item.quantity ?? 0),
        unitPrice,
        levelAPrice: Number(item.levelAPrice ?? item.level_a_price ?? item.levelPrices?.A ?? 0),
        levelBPrice: Number(item.levelBPrice ?? item.level_b_price ?? item.levelPrices?.B ?? 0),
        levelCPrice: Number(item.levelCPrice ?? item.level_c_price ?? item.levelPrices?.C ?? 0),
        moq: Number(item.moq ?? 1),
        stockSnapshot: Number(item.stockSnapshot ?? item.stock_snapshot ?? item.stock ?? 0),
        stock: Number(item.stock ?? item.stockSnapshot ?? item.stock_snapshot ?? 0),
        confidence: Number(item.confidence ?? 0),
        lineTotal: Number(item.lineTotal ?? item.line_total ?? quantity * unitPrice),
      };
    }),
    events: (order.events || []).map((event: any) => ({
      id: event.id,
      eventType: event.eventType || event.event_type,
      label: event.label,
      createdAt: event.createdAt || event.created_at,
    })),
  };
}

function normalizeDistributorInvite(raw: any, fallback: DistributorInvite): DistributorInvite {
  return {
    id: raw?.id || fallback.id,
    brandId: raw?.brandId || raw?.brand_id || fallback.brandId,
    brandName: raw?.brandName || raw?.brand_name || fallback.brandName,
    distributorId: raw?.distributorId || raw?.distributor_id || fallback.distributorId,
    distributorName: raw?.distributorName || raw?.distributor_name || fallback.distributorName,
    distributorLevel: (raw?.distributorLevel || raw?.distributor_level || fallback.distributorLevel) as DistributorLevel,
    email: raw?.email || fallback.email,
    token: raw?.token || fallback.token,
    inviteUrl: raw?.inviteUrl || raw?.invite_url || fallback.inviteUrl,
    status: raw?.status || fallback.status,
    expiresAt: raw?.expiresAt || raw?.expires_at || fallback.expiresAt,
    acceptedAt: raw?.acceptedAt || raw?.accepted_at || fallback.acceptedAt,
    createdAt: raw?.createdAt || raw?.created_at || fallback.createdAt,
  };
}

function readLocalSharedOrders(brandId?: string) {
  const orders: PersistedOrder[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    const scopedPrefix = brandId ? brandStorageKey(brandId, "shared-order-") : "";
    const isScoped = Boolean(scopedPrefix && key?.startsWith(scopedPrefix));
    const isLegacy = key?.startsWith("distributor-os-shared-order-");
    if (!isScoped && !isLegacy) continue;
    const token = isScoped
      ? key?.replace(scopedPrefix, "")
      : key?.replace("distributor-os-shared-order-", "");
    if (!token) continue;
    const order = readLocalSharedOrder(token, brandId);
    if (order) orders.push(order);
  }
  return orders;
}

function readLocalSharedOrder(token: string, brandId?: string) {
  const scopedKey = brandId ? brandStorageKey(brandId, `shared-order-${token}`) : "";
  const raw =
    (scopedKey ? window.localStorage.getItem(scopedKey) : null) ||
    window.localStorage.getItem(`distributor-os-shared-order-${token}`);
  if (!raw) return null;
  try {
    return normalizePersistedOrder(JSON.parse(raw));
  } catch {
    if (scopedKey) window.localStorage.removeItem(scopedKey);
    window.localStorage.removeItem(`distributor-os-shared-order-${token}`);
    return null;
  }
}

function mergeLocalOrderSnapshots(orders: PersistedOrder[]) {
  const byOrder = new Map<string, PersistedOrder>();
  for (const order of orders) {
    const key = getOrderSnapshotKey(order);
    const existing = byOrder.get(key);
    if (!existing || getOrderSnapshotTime(order) >= getOrderSnapshotTime(existing)) {
      byOrder.set(key, order);
    }
  }
  return [...byOrder.values()].sort((left, right) => getOrderSnapshotTime(right) - getOrderSnapshotTime(left));
}

function getOrderSnapshotKey(order: PersistedOrder) {
  return order.shareToken || order.token || order.id || order.orderNumber;
}

function getOrderSnapshotTime(order: PersistedOrder) {
  const eventTime = order.events.reduce((latest, event) => {
    const time = Date.parse(event.createdAt || "");
    return Number.isNaN(time) ? latest : Math.max(latest, time);
  }, 0);
  return eventTime || Date.parse(order.createdAt || "") || 0;
}

function clearLocalDemoState(brandId?: string) {
  const keysToRemove: string[] = [
    "distributor-os-product-catalog",
    "distributor-os-order-records",
    "distributor-os-distributor-invites",
    "distributor-os-confirmed-order",
  ];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith("distributor-os-shared-order-")) keysToRemove.push(key);
    if (brandId && key?.startsWith(`distributor-os:${brandId}:`)) keysToRemove.push(key);
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
      paymentRequestUrl: null,
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
    paymentRequestUrl: null,
    createdAt: new Date().toISOString(),
    items: items.map((item) => ({
      id: item.id,
      productId: item.id,
      productName: polishDemoProductName(item.name),
      name: polishDemoProductName(item.name),
      sku: polishDemoSku(item.sku, item.name),
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
  if (view === "launch") return "Official V1 Launch Room";
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
    po_requested: "PO requested",
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

function paymentRailLabel(rail: CollectionAction["paymentRail"]) {
  const labels: Record<CollectionAction["paymentRail"], string> = {
    bank_transfer: "Wire / bank transfer",
    ach: "ACH / bank debit",
    card: "Card",
    stablecoin_usdc: "Optional USDC settlement",
  };
  return labels[rail];
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

function formatMoneyShort(value: number) {
  if (Math.abs(value) >= 1000) {
    const shortValue = value / 1000;
    return `$${shortValue >= 10 ? shortValue.toFixed(1) : shortValue.toFixed(2)}K`;
  }
  return `$${value.toFixed(0)}`;
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

function PortalOrderWorkflow({ order, paidCount }: { order: PersistedOrder; paidCount: number }) {
  const steps = [
    { label: "PO submitted", done: true },
    { label: "Brand approved", done: order.status !== "po_requested" || order.paymentStatus === "paid" },
    { label: "Payment requested", done: ["requested", "partial", "paid"].includes(order.paymentStatus) },
    { label: "Paid", done: order.paymentStatus === "paid" },
  ];
  const activeIndex = Math.max(0, steps.findLastIndex((step) => step.done));

  return (
    <Panel>
      <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h2 className="text-xl font-bold">Distributor portal order loop</h2>
          <p className="text-sm text-slate-500">
            Latest portal PO: {order.orderNumber} / {order.distributorName} / ${order.totalValue.toFixed(2)}
          </p>
        </div>
        <Badge tone={order.paymentStatus === "paid" ? "emerald" : "blue"}>
          {order.paymentStatus === "paid" ? `${paidCount} paid` : steps[activeIndex].label}
        </Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {steps.map((step, index) => (
          <div
            key={step.label}
            className={step.done ? "rounded-[8px] border border-emerald-200 bg-emerald-50 p-4" : "rounded-[8px] border border-slate-200 bg-slate-50 p-4"}
          >
            <div className={step.done ? "text-xs font-bold text-emerald-700" : "text-xs font-bold text-slate-400"}>
              Step {index + 1}
            </div>
            <div className="mt-2 text-sm font-semibold">{step.label}</div>
          </div>
        ))}
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
