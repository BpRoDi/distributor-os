import type { DemoDistributor, DistributorLevel, SourceChannel } from "../commercial-demo.ts";
import type { PaymentMethod, PaymentStatus } from "../payments/status.ts";

export type FinanceOrderStatus =
  | "po_requested"
  | "draft"
  | "approved"
  | "link_created"
  | "distributor_confirmed"
  | "cancelled";

export type FinanceOrderEvent = {
  eventType: string;
  label?: string;
  createdAt?: string;
};

export type FinanceOrder = {
  orderNumber: string;
  distributorId: string;
  distributorName: string;
  distributorLevel: DistributorLevel;
  sourceChannel: SourceChannel;
  status: FinanceOrderStatus;
  totalValue: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  paymentDueDate?: string | null;
  amountPaid: number;
  outstandingAmount: number;
  createdAt?: string;
  events: FinanceOrderEvent[];
};

export type FinanceControl = {
  ar: {
    totalOutstanding: number;
    requestedOutstanding: number;
    overdueOutstanding: number;
    dueSoonOutstanding: number;
    paidThisMonth: number;
    expectedSevenDayCash: number;
    expectedThirtyDayCash: number;
  };
  ledger: DistributorLedger[];
  creditProfiles: DistributorCreditProfile[];
  collectionQueue: CollectionAction[];
  recommendations: string[];
};

export type DistributorLedger = {
  distributorId: string;
  distributorName: string;
  totalOrdered: number;
  totalPaid: number;
  outstanding: number;
  requestedOutstanding: number;
  overdue: number;
  averageDaysToPay: number;
  creditLimit: number;
  creditUsedPercent: number;
};

export type DistributorCreditProfile = {
  distributorId: string;
  distributorName: string;
  trustScore: number;
  recommendedTerms: "Prepaid" | "Deposit" | "Net 7" | "Net 15" | "Net 30" | "Net 45";
  recommendedCreditLimit: number;
  pricingReward: string;
  riskReason: string;
  signals: string[];
};

export type CollectionAction = {
  orderNumber: string;
  distributorName: string;
  outstandingAmount: number;
  paymentStatus: PaymentStatus;
  dueDate?: string | null;
  dueLabel: string;
  urgency: "low" | "medium" | "high";
  recommendedAction: string;
  paymentRail: "bank_transfer" | "ach" | "card" | "stablecoin_usdc";
  message: string;
};

export function buildFinanceControl({
  orders,
  distributors,
  now = new Date(),
}: {
  orders: FinanceOrder[];
  distributors: DemoDistributor[];
  now?: Date;
}): FinanceControl {
  const liveOrders = orders.filter((order) => order.status !== "cancelled");
  const ar = {
    totalOutstanding: sum(liveOrders, (order) => order.outstandingAmount),
    requestedOutstanding: sum(
      liveOrders.filter((order) => order.paymentStatus === "requested" || order.paymentStatus === "partial"),
      (order) => order.outstandingAmount
    ),
    overdueOutstanding: sum(liveOrders.filter((order) => isOverdue(order, now)), (order) => order.outstandingAmount),
    dueSoonOutstanding: sum(liveOrders.filter((order) => isDueSoon(order, now)), (order) => order.outstandingAmount),
    paidThisMonth: sum(liveOrders.filter((order) => isPaidInMonth(order, now)), (order) => order.amountPaid),
    expectedSevenDayCash: 0,
    expectedThirtyDayCash: 0,
  };

  ar.expectedSevenDayCash = roundCurrency(ar.dueSoonOutstanding + ar.overdueOutstanding * 0.65);
  ar.expectedThirtyDayCash = roundCurrency(ar.requestedOutstanding + liveOrders
    .filter((order) => order.paymentStatus === "unpaid" && order.status !== "po_requested")
    .reduce((total, order) => total + order.outstandingAmount * 0.35, 0));

  const ledger = distributors.map((distributor) => buildDistributorLedger(distributor, liveOrders, now));
  const creditProfiles = ledger.map((entry) => {
    const distributor = distributors.find((item) => item.id === entry.distributorId);
    return buildCreditProfile(entry, distributor);
  });
  const collectionQueue = liveOrders
    .filter((order) => order.outstandingAmount > 0 && order.paymentStatus !== "paid")
    .map((order) => buildCollectionAction(order, distributors.find((item) => item.id === order.distributorId), now))
    .sort((left, right) => urgencyWeight(right.urgency) - urgencyWeight(left.urgency) || right.outstandingAmount - left.outstandingAmount);

  return {
    ar,
    ledger,
    creditProfiles,
    collectionQueue,
    recommendations: buildRecommendations(ar, creditProfiles, collectionQueue),
  };
}

function buildDistributorLedger(distributor: DemoDistributor, orders: FinanceOrder[], now: Date): DistributorLedger {
  const distributorOrders = orders.filter((order) => order.distributorId === distributor.id || order.distributorName === distributor.name);
  const totalOrdered = sum(distributorOrders, (order) => order.totalValue);
  const totalPaid = sum(distributorOrders, (order) => order.amountPaid);
  const outstanding = sum(distributorOrders, (order) => order.outstandingAmount);
  const requestedOutstanding = sum(
    distributorOrders.filter((order) => order.paymentStatus === "requested" || order.paymentStatus === "partial"),
    (order) => order.outstandingAmount
  );
  const overdue = sum(distributorOrders.filter((order) => isOverdue(order, now)), (order) => order.outstandingAmount);
  const averageDaysToPay = average(
    distributorOrders
      .filter((order) => order.paymentStatus === "paid")
      .map(resolveDaysToPay)
      .filter((days) => days > 0)
  ) || 7;
  const creditLimit = recommendBaseCreditLimit(distributor, totalOrdered);

  return {
    distributorId: distributor.id,
    distributorName: distributor.name,
    totalOrdered: roundCurrency(totalOrdered),
    totalPaid: roundCurrency(totalPaid),
    outstanding: roundCurrency(outstanding),
    requestedOutstanding: roundCurrency(requestedOutstanding),
    overdue: roundCurrency(overdue),
    averageDaysToPay: Math.round(averageDaysToPay),
    creditLimit,
    creditUsedPercent: creditLimit ? Math.min(100, Math.round((outstanding / creditLimit) * 100)) : 0,
  };
}

function buildCreditProfile(entry: DistributorLedger, distributor?: DemoDistributor): DistributorCreditProfile {
  const baseScore = distributor?.trustScore ?? 70;
  const paymentScore = entry.overdue > 0 ? -18 : entry.averageDaysToPay <= 7 ? 8 : entry.averageDaysToPay <= 20 ? 2 : -8;
  const utilizationScore = entry.creditUsedPercent > 80 ? -12 : entry.creditUsedPercent < 35 ? 5 : 0;
  const volumeScore = entry.totalOrdered > 10000 ? 5 : entry.totalOrdered > 2500 ? 2 : 0;
  const trustScore = clamp(baseScore + paymentScore + utilizationScore + volumeScore, 0, 100);
  const recommendedTerms = resolveRecommendedTerms(trustScore, entry);
  const recommendedCreditLimit = resolveRecommendedCreditLimit(entry, trustScore);

  return {
    distributorId: entry.distributorId,
    distributorName: entry.distributorName,
    trustScore,
    recommendedTerms,
    recommendedCreditLimit,
    pricingReward: resolvePricingReward(trustScore, entry),
    riskReason: resolveRiskReason(entry, trustScore),
    signals: buildCreditSignals(entry, trustScore),
  };
}

function buildCollectionAction(order: FinanceOrder, distributor: DemoDistributor | undefined, now: Date): CollectionAction {
  const overdue = isOverdue(order, now);
  const dueSoon = isDueSoon(order, now);
  const dueDays = resolveDueDays(order, now);
  const urgency: CollectionAction["urgency"] = overdue ? "high" : dueSoon || order.outstandingAmount > 5000 ? "medium" : "low";
  const paymentRail = resolvePaymentRail(order, distributor);
  const recommendedAction = overdue
    ? `Collect overdue ${formatCurrency(order.outstandingAmount)}`
    : order.paymentStatus === "requested"
      ? `Remind ${formatCurrency(order.outstandingAmount)} due`
      : `Request ${formatCurrency(order.outstandingAmount)} payment`;

  return {
    orderNumber: order.orderNumber,
    distributorName: order.distributorName,
    outstandingAmount: roundCurrency(order.outstandingAmount),
    paymentStatus: order.paymentStatus,
    dueDate: order.paymentDueDate,
    dueLabel: buildDueLabel(order, dueDays),
    urgency,
    recommendedAction,
    paymentRail,
    message: buildCollectionMessage(order, recommendedAction),
  };
}

function resolvePaymentRail(order: FinanceOrder, distributor?: DemoDistributor): CollectionAction["paymentRail"] {
  const crossBorder = distributor ? !["US", "USA", "North America"].includes(distributor.region) : order.sourceChannel === "Distributor Portal";
  if (order.paymentMethod === "stablecoin_usdc") return "stablecoin_usdc";
  if (crossBorder || order.outstandingAmount >= 10000) return "bank_transfer";
  if (order.outstandingAmount >= 2500) return "ach";
  if (order.outstandingAmount < 500) return "card";
  return "bank_transfer";
}

function buildRecommendations(ar: FinanceControl["ar"], profiles: DistributorCreditProfile[], queue: CollectionAction[]) {
  const recommendations: string[] = [];
  if (ar.overdueOutstanding > 0) recommendations.push(`Collect ${formatCurrency(ar.overdueOutstanding)} overdue before approving new credit.`);
  if (ar.expectedSevenDayCash > 0) recommendations.push(`${formatCurrency(ar.expectedSevenDayCash)} is realistically collectible in the next 7 days.`);
  const bestProfile = [...profiles].sort((left, right) => right.trustScore - left.trustScore)[0];
  if (bestProfile?.trustScore >= 90) recommendations.push(`${bestProfile.distributorName} qualifies for better terms or early-pay pricing rewards.`);
  if (queue.some((item) => item.paymentRail === "stablecoin_usdc")) recommendations.push("Keep optional USDC settlement available only when a distributor explicitly prefers it.");
  if (queue.some((item) => item.paymentRail === "bank_transfer" && item.outstandingAmount >= 10000)) recommendations.push("Use bank transfer for large or cross-border invoices; keep alternate rails secondary.");
  if (!recommendations.length) recommendations.push("AR is clean. Use early-pay discounts to pull cash forward.");
  return recommendations.slice(0, 4);
}

function resolveRecommendedTerms(score: number, entry: DistributorLedger): DistributorCreditProfile["recommendedTerms"] {
  if (entry.overdue > 0 || score < 55) return "Deposit";
  if (score < 70) return "Net 7";
  if (score < 85) return "Net 15";
  if (score >= 95 && entry.averageDaysToPay <= 10) return "Net 45";
  return "Net 30";
}

function resolveRecommendedCreditLimit(entry: DistributorLedger, score: number) {
  if (score < 60) return Math.max(1000, Math.round(entry.totalPaid * 0.25));
  const multiplier = score >= 90 ? 1.5 : score >= 75 ? 1 : 0.6;
  return Math.max(2500, roundToHundreds((entry.totalPaid + entry.totalOrdered * 0.25) * multiplier));
}

function resolvePricingReward(score: number, entry: DistributorLedger) {
  if (entry.overdue > 0) return "Hold rewards until overdue balance clears";
  if (score >= 92) return "Offer 1% early-pay discount or higher credit limit";
  if (score >= 80) return "Keep current tier and reward faster payment";
  return "Require deposit before better pricing";
}

function resolveRiskReason(entry: DistributorLedger, score: number) {
  if (entry.overdue > 0) return `${formatCurrency(entry.overdue)} overdue balance`;
  if (entry.creditUsedPercent > 80) return `${entry.creditUsedPercent}% of recommended credit used`;
  if (score >= 90) return "Fast payer with clean AR";
  return "Limited payment history";
}

function buildCreditSignals(entry: DistributorLedger, score: number) {
  const signals = [
    `${formatCurrency(entry.totalOrdered)} ordered in the workspace`,
    `${formatCurrency(entry.totalPaid)} paid to date`,
    `${entry.creditUsedPercent}% of recommended credit used`,
  ];

  if (entry.overdue > 0) signals.push(`${formatCurrency(entry.overdue)} overdue needs collection before better terms`);
  else signals.push("0 overdue invoices");

  if (entry.averageDaysToPay <= 7) signals.push("typically pays within 7 days");
  else signals.push(`${entry.averageDaysToPay} day average payment cycle`);

  if (score >= 90) signals.push("eligible for early-pay reward or larger credit limit");
  return signals.slice(0, 5);
}

function buildCollectionMessage(order: FinanceOrder, action: string) {
  const due = order.paymentDueDate ? ` Due ${order.paymentDueDate}.` : " Payment due date is not set yet.";
  return `${action}: ${order.distributorName} owes ${formatCurrency(order.outstandingAmount)} on ${order.orderNumber}.${due}`;
}

function recommendBaseCreditLimit(distributor: DemoDistributor, totalOrdered: number) {
  const trustMultiplier = distributor.trustScore >= 90 ? 0.4 : distributor.trustScore >= 75 ? 0.25 : 0.15;
  return Math.max(2500, roundToHundreds(distributor.revenue * trustMultiplier + totalOrdered * 0.2));
}

function isOverdue(order: FinanceOrder, now: Date) {
  if (!order.paymentDueDate || order.paymentStatus === "paid") return false;
  return Date.parse(order.paymentDueDate) < startOfDay(now).getTime();
}

function isDueSoon(order: FinanceOrder, now: Date) {
  if (!order.paymentDueDate || order.paymentStatus === "paid") return false;
  const due = Date.parse(order.paymentDueDate);
  const today = startOfDay(now).getTime();
  const sevenDays = today + 7 * 24 * 60 * 60 * 1000;
  return due >= today && due <= sevenDays;
}

function isPaidInMonth(order: FinanceOrder, now: Date) {
  if (order.paymentStatus !== "paid") return false;
  const paidAt = findEventDate(order, "payment_paid") || order.createdAt;
  if (!paidAt) return true;
  const paidDate = new Date(paidAt);
  return paidDate.getMonth() === now.getMonth() && paidDate.getFullYear() === now.getFullYear();
}

function resolveDaysToPay(order: FinanceOrder) {
  const requested = findEventDate(order, "payment_requested") || order.createdAt;
  const paid = findEventDate(order, "payment_paid") || order.createdAt;
  if (!requested || !paid) return 7;
  return Math.max(1, Math.round((Date.parse(paid) - Date.parse(requested)) / (24 * 60 * 60 * 1000)));
}

function findEventDate(order: FinanceOrder, eventType: string) {
  return order.events.find((event) => event.eventType === eventType)?.createdAt;
}

function resolveDueDays(order: FinanceOrder, now: Date) {
  if (!order.paymentDueDate) return null;
  const due = startOfDay(new Date(order.paymentDueDate)).getTime();
  const today = startOfDay(now).getTime();
  return Math.round((due - today) / (24 * 60 * 60 * 1000));
}

function buildDueLabel(order: FinanceOrder, dueDays: number | null) {
  if (order.paymentStatus === "unpaid") return "Request payment";
  if (dueDays === null) return "No due date";
  if (dueDays < 0) return `${Math.abs(dueDays)}d overdue`;
  if (dueDays === 0) return "Due today";
  return `Due in ${dueDays}d`;
}

function formatCurrency(value: number) {
  return `$${roundCurrency(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function sum<T>(items: T[], fn: (item: T) => number) {
  return roundCurrency(items.reduce((total, item) => total + Number(fn(item) || 0), 0));
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function roundCurrency(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function roundToHundreds(value: number) {
  return Math.round(Number(value || 0) / 100) * 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function urgencyWeight(urgency: CollectionAction["urgency"]) {
  return urgency === "high" ? 3 : urgency === "medium" ? 2 : 1;
}
