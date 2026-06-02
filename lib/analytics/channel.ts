import type { DistributorLevel, SourceChannel } from "@/lib/commercial-demo";
import type { PaymentStatus } from "@/lib/payments/status";

export type AnalyticsOrderItem = {
  sku: string;
  quantity: number;
  lineTotal: number;
  stockSnapshot?: number;
  moq?: number;
};

export type AnalyticsOrder = {
  distributorName: string;
  distributorLevel: DistributorLevel;
  sourceChannel: SourceChannel;
  status: string;
  paymentStatus?: PaymentStatus;
  totalValue: number;
  outstandingAmount?: number;
  items: AnalyticsOrderItem[];
};

export type AnalyticsProduct = {
  sku: string;
  name: string;
  stock: number;
  moq: number;
};

export function calculateChannelAnalytics({
  orders,
  products,
}: {
  orders: AnalyticsOrder[];
  products: AnalyticsProduct[];
}) {
  const topRequestedSkus = sortEntries(
    orders.flatMap((order) => order.items).reduce<Record<string, number>>((acc, item) => {
      acc[item.sku] = (acc[item.sku] || 0) + item.quantity;
      return acc;
    }, {})
  );

  const demandByDistributor = sortEntries(
    orders.reduce<Record<string, number>>((acc, order) => {
      acc[order.distributorName] = (acc[order.distributorName] || 0) + order.totalValue;
      return acc;
    }, {})
  );

  const demandBySourceChannel = orders.reduce<Record<SourceChannel, number>>(
    (acc, order) => {
      acc[order.sourceChannel] += order.totalValue;
      return acc;
    },
    {
      WhatsApp: 0,
      Email: 0,
      "Instagram DM": 0,
      Telegram: 0,
      Form: 0,
      "Distributor Portal": 0,
      CSV: 0,
      PDF: 0,
      EDI: 0,
    }
  );

  const orderConversionStatus = orders.reduce<Record<string, number>>((acc, order) => {
    acc[order.status] = (acc[order.status] || 0) + 1;
    return acc;
  }, {});

  const pendingConfirmationValue = orders
    .filter((order) => order.status === "link_created" || order.status === "approved")
    .reduce((sum, order) => sum + order.totalValue, 0);

  const lowStockRisk = products
    .filter((product) => product.stock <= product.moq * 2 || product.stock < 500)
    .map((product) => ({ sku: product.sku, name: product.name, stock: product.stock, moq: product.moq }));

  const distributorLevelPerformance = orders.reduce<Record<DistributorLevel, { orders: number; value: number }>>(
    (acc, order) => {
      acc[order.distributorLevel].orders += 1;
      acc[order.distributorLevel].value += order.totalValue;
      return acc;
    },
    {
      A: { orders: 0, value: 0 },
      B: { orders: 0, value: 0 },
      C: { orders: 0, value: 0 },
    }
  );

  const paymentStatusBreakdown = orders.reduce<Record<PaymentStatus, number>>(
    (acc, order) => {
      const status = order.paymentStatus || "unpaid";
      acc[status] += 1;
      return acc;
    },
    { unpaid: 0, requested: 0, paid: 0, partial: 0, overdue: 0 }
  );
  const paidValue = orders
    .filter((order) => order.paymentStatus === "paid")
    .reduce((sum, order) => sum + order.totalValue, 0);
  const outstandingValue = orders.reduce(
    (sum, order) => sum + Number(order.outstandingAmount ?? (order.paymentStatus === "paid" ? 0 : order.totalValue)),
    0
  );

  return {
    topRequestedSkus,
    demandByDistributor,
    demandBySourceChannel,
    orderConversionStatus,
    pendingConfirmationValue,
    lowStockRisk,
    distributorLevelPerformance,
    paymentStatusBreakdown,
    paidValue,
    outstandingValue,
    suggestedActions: buildSuggestedActions({
      topRequestedSkus,
      pendingConfirmationValue,
      lowStockRiskCount: lowStockRisk.length,
      distributorLevelPerformance,
      paymentStatusBreakdown,
    }),
  };
}

function buildSuggestedActions({
  topRequestedSkus,
  pendingConfirmationValue,
  lowStockRiskCount,
  distributorLevelPerformance,
  paymentStatusBreakdown,
}: {
  topRequestedSkus: Array<{ label: string; value: number }>;
  pendingConfirmationValue: number;
  lowStockRiskCount: number;
  distributorLevelPerformance: Record<DistributorLevel, { orders: number; value: number }>;
  paymentStatusBreakdown: Record<PaymentStatus, number>;
}) {
  const actions = [
    "Increase stock for high-demand SKU",
    "Upgrade distributor to Level A if conversion is high",
    "Follow up on pending confirmation",
    "Review pricing if Level C conversion is low",
  ];

  if (!topRequestedSkus.length || !lowStockRiskCount) actions.push("Import more product and inventory history");
  if (pendingConfirmationValue <= 0) actions.push("Create a confirmation link for the next approved draft");
  if (distributorLevelPerformance.C.orders > distributorLevelPerformance.A.orders) {
    actions.push("Review Level C pricing and onboarding friction");
  }
  if (paymentStatusBreakdown.requested || paymentStatusBreakdown.unpaid) {
    actions.push("Prioritize payment follow-up for confirmed unpaid orders");
  }

  return Array.from(new Set(actions));
}

function sortEntries(record: Record<string, number>) {
  return Object.entries(record)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}
