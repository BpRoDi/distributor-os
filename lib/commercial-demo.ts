import { demoProducts } from "@/lib/mock-data";

export type DistributorLevel = "A" | "B" | "C";
export type SourceChannel =
  | "WhatsApp"
  | "Email"
  | "Instagram DM"
  | "Telegram"
  | "Form"
  | "Distributor Portal"
  | "CSV"
  | "PDF"
  | "EDI";

export type DemoDistributor = {
  id: string;
  name: string;
  level: DistributorLevel;
  contactEmail?: string;
  region: string;
  terms: string;
  revenue: number;
  risk: "Low" | "Medium" | "Review";
  trustScore: number;
  portalStatus?: "Active" | "Invited" | "Accepted";
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
  A: { label: "Level A", description: "Best price for trusted high-volume partners and agents" },
  B: { label: "Level B", description: "Standard approved customer or distributor price" },
  C: { label: "Level C", description: "Entry price for new accounts, samples, or smaller buyers" },
};

export const demoDistributors: DemoDistributor[] = [
  {
    id: "dist-eurotrade",
    name: "West Coast AAU Program",
    level: "A",
    contactEmail: "coach@westcoast-aau.example",
    region: "US West",
    terms: "50% deposit",
    revenue: 142000,
    risk: "Low",
    trustScore: 91,
    portalStatus: "Active",
  },
  {
    id: "dist-bright",
    name: "IronPeak Fitness Club",
    level: "B",
    contactEmail: "ops@ironpeak.example",
    region: "US",
    terms: "Deposit",
    revenue: 68400,
    risk: "Medium",
    trustScore: 81,
    portalStatus: "Invited",
  },
  {
    id: "dist-asean",
    name: "Bright Retail Co.",
    level: "C",
    contactEmail: "buyer@bright-retail.example",
    region: "US East",
    terms: "Net 15",
    revenue: 85500,
    risk: "Review",
    trustScore: 73,
    portalStatus: "Invited",
  },
];

export function getLevelPrice(product: { levelPrices: Record<DistributorLevel, number> }, level: DistributorLevel) {
  return product.levelPrices[level];
}

export function getPriceDelta(product: { levelPrices: Record<DistributorLevel, number> }, level: DistributorLevel) {
  return getLevelPrice(product, level) - product.levelPrices.B;
}

export function getDemoSharedOrder(token = "ORD-RIGORER-7F3K"): DemoSharedOrder {
  const message =
    "WhatsApp from West Coast AAU: we need about 25 team sets, mostly medium and large, plus 12 pairs of shoes. Can you send a mockup and deposit link for Friday?";

  return {
    token,
    orderId: `DO-${token.slice(-4).toUpperCase()}`,
    brandName: "Rigorer",
    distributorName: "West Coast AAU Program",
    distributorLevel: "A",
    sourceChannel: "WhatsApp",
    originalMessage: message,
    status: "Link Shared",
    items: [
      buildOrderItem("p1", 25, "Team uniform set", "A", 96),
      buildOrderItem("p2", 12, "Team shoes", "A", 92),
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
