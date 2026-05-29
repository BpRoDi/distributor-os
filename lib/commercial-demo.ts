import { demoProducts } from "@/lib/mock-data";

export type DistributorLevel = "A" | "B" | "C";
export type SourceChannel = "WhatsApp" | "Telegram";

export type DemoDistributor = {
  id: string;
  name: string;
  level: DistributorLevel;
  region: string;
  terms: string;
  revenue: number;
  risk: "Low" | "Medium" | "Review";
  trustScore: number;
};

export type DemoOrderStatus =
  | "Draft"
  | "Brand Approved"
  | "Link Shared"
  | "Distributor Confirmed";

export type DemoOrderItem = {
  id: string;
  name: string;
  sku: string;
  category: string;
  qty: number;
  moq: number;
  stock: number;
  confidence: number;
  requestedName: string;
  levelPrice: number;
  standardPrice: number;
  priceDelta: number;
};

export type DemoSharedOrder = {
  token: string;
  orderId: string;
  brandName: string;
  distributorName: string;
  distributorLevel: DistributorLevel;
  sourceChannel: SourceChannel;
  originalMessage: string;
  status: DemoOrderStatus;
  items: DemoOrderItem[];
};

export const levelDetails: Record<DistributorLevel, { label: string; description: string }> = {
  A: { label: "Level A", description: "Best price for trusted high-volume partners" },
  B: { label: "Level B", description: "Standard approved distributor price" },
  C: { label: "Level C", description: "Entry price for new or unproven accounts" },
};

export const demoDistributors: DemoDistributor[] = [
  {
    id: "dist-eurotrade",
    name: "EuroTrade GmbH",
    level: "A",
    region: "DACH",
    terms: "Net 30",
    revenue: 186000,
    risk: "Low",
    trustScore: 94,
  },
  {
    id: "dist-bright",
    name: "Bright Retail Co.",
    level: "B",
    region: "UK",
    terms: "Net 45",
    revenue: 86400,
    risk: "Medium",
    trustScore: 81,
  },
  {
    id: "dist-asean",
    name: "ASEAN Home Supply",
    level: "C",
    region: "SEA",
    terms: "Deposit",
    revenue: 31900,
    risk: "Review",
    trustScore: 67,
  },
];

export function getLevelPrice(product: { levelPrices: Record<DistributorLevel, number> }, level: DistributorLevel) {
  return product.levelPrices[level];
}

export function getPriceDelta(product: { levelPrices: Record<DistributorLevel, number> }, level: DistributorLevel) {
  return getLevelPrice(product, level) - product.levelPrices.B;
}

export function getDemoSharedOrder(token = "ORD-NIMBUS-7F3K"): DemoSharedOrder {
  const message =
    "WhatsApp from Elena at EuroTrade: please confirm 120 pcs HydraGo Stainless Bottle and 30 pcs AeroClean Smart Air Purifier for next week at our approved Level A price.";

  return {
    token,
    orderId: `DO-${token.slice(-4).toUpperCase()}`,
    brandName: "Nimbus Home Goods",
    distributorName: "EuroTrade GmbH",
    distributorLevel: "A",
    sourceChannel: "WhatsApp",
    originalMessage: message,
    status: "Link Shared",
    items: [
      buildOrderItem("p2", 120, "HydraGo Stainless Bottle", "A", 96),
      buildOrderItem("p1", 30, "AeroClean Smart Air Purifier", "A", 94),
    ],
  };
}

function buildOrderItem(
  productId: string,
  qty: number,
  requestedName: string,
  level: DistributorLevel,
  confidence: number
): DemoOrderItem {
  const product = demoProducts.find((item) => item.id === productId);
  if (!product) throw new Error(`Missing demo product ${productId}`);

  const levelPrice = getLevelPrice(product, level);
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    category: product.category,
    qty,
    moq: product.moq,
    stock: product.stock,
    confidence,
    requestedName,
    levelPrice,
    standardPrice: product.levelPrices.B,
    priceDelta: levelPrice - product.levelPrices.B,
  };
}
