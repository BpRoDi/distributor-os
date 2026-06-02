import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateCartLine,
  canTransitionOrder,
  getProductStatus,
  isContextualThread,
} from "../lib/domain/orders.ts";
import { calculateChannelAnalytics } from "../lib/analytics/channel.ts";
import { parseCatalogOrder } from "../lib/catalog/parser.ts";
import { parseProductCsv, parseProductRows, validateCatalogProduct, type CatalogProduct } from "../lib/catalog/products.ts";
import { parseProductXlsx } from "../lib/catalog/xlsx.ts";
import { buildFinanceControl } from "../lib/finance/control.ts";
import { appendOrderEventRecord, createOrderEventTimeline, type OrderEventRecord } from "../lib/orders/events.ts";
import { applyOrderPaymentUpdate } from "../lib/orders/payment.ts";
import {
  approvePortalPoRequest,
  createPortalPoRequest,
  payPortalOrder,
  requestPortalOrderPayment,
} from "../lib/orders/portal-demo.ts";
import {
  calculateOutstandingAmount,
  canTransitionPaymentStatus,
  inferPaymentStatus,
} from "../lib/payments/status.ts";
import {
  buildStripeCheckoutReconciliation,
  getStripeCheckoutSessionReference,
} from "../lib/payments/stripe-webhook.ts";
import {
  acceptDistributorInvite,
  brandStorageKey,
  createBrandWorkspace,
  createDistributorInvite,
  filterByBrand,
  getInviteStatus,
} from "../lib/workspace/tenant.ts";

const uploadedProduct: CatalogProduct = {
  id: "prod-test-001",
  sku: "TEST-001",
  name: "Pilot Test Bottle",
  requestedName: "Pilot Test Bottle",
  category: "Drinkware",
  moq: 25,
  stock: 120,
  distributor_price: 9,
  levelPrices: { A: 7, B: 9, C: 11 },
  status: "Available",
  aliases: ["test bottle", "pilot bottle"],
  lead_time: "Next week",
};

const financeDistributors: Parameters<typeof buildFinanceControl>[0]["distributors"] = [
  {
    id: "dist-eurotrade",
    name: "EuroTrade GmbH",
    level: "A",
    contactEmail: "elena@eurotrade.example",
    region: "DACH",
    terms: "Net 30",
    revenue: 186000,
    risk: "Low",
    trustScore: 94,
    portalStatus: "Active",
  },
];

describe("Distributor OS domain rules", () => {
  it("calculates distributor cart lines using price x MOQ x quantity multiplier", () => {
    assert.equal(calculateCartLine(119, 20, 2), 4760);
  });

  it("classifies stock status", () => {
    assert.equal(getProductStatus(0), "Out of Stock");
    assert.equal(getProductStatus(430), "Low Stock");
    assert.equal(getProductStatus(1280), "Available");
  });

  it("prevents moving a delivered order backwards", () => {
    assert.equal(canTransitionOrder("Delivered", "Submitted"), false);
    assert.equal(canTransitionOrder("Submitted", "Confirmed"), true);
    assert.equal(canTransitionOrder("Confirmed", "Cancelled"), true);
  });

  it("requires messages to be attached to an order or SKU", () => {
    assert.equal(isContextualThread({ order_id: "o1" }), true);
    assert.equal(isContextualThread({ sku: "AC-900-PRO" }), true);
    assert.equal(isContextualThread({}), false);
  });

  it("validates product imports and tier price order", () => {
    const errors = validateCatalogProduct({
      sku: "BAD-1",
      name: "Bad Price",
      moq: 10,
      stock: 10,
      level_a_price: 12,
      level_b_price: 10,
      level_c_price: 9,
    });

    assert.ok(errors.some((error) => error.includes("Level A")));
    assert.ok(errors.some((error) => error.includes("Level B")));

    const parsed = parseProductCsv(
      "sku,name,category,moq,stock,level_a_price,level_b_price,level_c_price,aliases,lead_time\nHG-1,HydraGo,Lifestyle,100,500,7,8,9,\"bottle,hydrago\",Next week"
    );

    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.products[0].sku, "HG-1");
    assert.equal(parsed.products[0].aliases.includes("hydrago"), true);
  });

  it("uses uploaded catalog products in the parser and selects tier price by distributor level", () => {
    const parsedLevelA = parseCatalogOrder("Please send 50 test bottle next week.", "A", [uploadedProduct]);
    const parsedLevelC = parseCatalogOrder("Please send 50 test bottle next week.", "C", [uploadedProduct]);

    assert.equal(parsedLevelA.length, 1);
    assert.equal(parsedLevelA[0].sku, "TEST-001");
    assert.equal(parsedLevelA[0].qty, 50);
    assert.equal(parsedLevelA[0].levelPrice, 7);
    assert.equal(parsedLevelC[0].levelPrice, 11);
    assert.equal(parsedLevelA[0].moq, 25);
    assert.equal(parsedLevelA[0].stock, 120);
    assert.equal(parsedLevelA[0].lead_time, "Next week");
  });

  it("matches aliases and does not hallucinate unmatched SKUs", () => {
    const aliasMatch = parseCatalogOrder("Need 30 pilot bottle", "B", [uploadedProduct]);
    const noMatch = parseCatalogOrder("Need 30 imaginary product", "B", [uploadedProduct]);

    assert.equal(aliasMatch[0].sku, "TEST-001");
    assert.equal(aliasMatch[0].levelPrice, 9);
    assert.equal(noMatch.length, 0);
  });

  it("maps real-world spreadsheet headers and parses xlsx catalogs", () => {
    const mapped = parseProductRows([
      ["sku", "\u5546\u54c1\u7f16\u7801", "\u5546\u54c1\u540d\u79f0", "\u5927\u7c7b", "\u5546\u54c1\u7b80\u79f0", "\u989c\u8272", "\u5c3a\u7801"],
      ["6942494729507", "YX-L93-1FIRSTSUBS", "\u51c6\u8005\u7537\u6b3e\u5706\u9886\u77ed\u8896T\u6064-FIRSTSUBS", "\u670d\u88c5", "FIRSTSUBS", "\u7eaf\u767d\u8272", "XS"],
    ]);

    assert.equal(mapped.errors.length, 0);
    assert.equal(mapped.products[0].sku, "6942494729507");
    assert.equal(mapped.products[0].name, "\u51c6\u8005\u7537\u6b3e\u5706\u9886\u77ed\u8896T\u6064-FIRSTSUBS");
    assert.equal(mapped.products[0].category, "\u670d\u88c5");
    assert.equal(mapped.products[0].moq, 1);
    assert.equal(mapped.products[0].aliases.includes("YX-L93-1FIRSTSUBS"), true);

    const parsedXlsx = parseProductXlsx(createTinyXlsx());
    assert.equal(parsedXlsx.errors.length, 0);
    assert.equal(parsedXlsx.products[0].sku, "SKU-1");
    assert.equal(parsedXlsx.products[0].name, "XLSX Product");
  });

  it("updates analytics after order creation and payment changes", () => {
    const analytics = calculateChannelAnalytics({
      orders: [
        {
          distributorName: "EuroTrade GmbH",
          distributorLevel: "A",
          sourceChannel: "WhatsApp",
          status: "link_created",
          paymentStatus: "requested",
          totalValue: 1000,
          outstandingAmount: 1000,
          items: [{ sku: "TEST-001", quantity: 50, lineTotal: 1000 }],
        },
        {
          distributorName: "EuroTrade GmbH",
          distributorLevel: "A",
          sourceChannel: "WhatsApp",
          status: "distributor_confirmed",
          paymentStatus: "paid",
          totalValue: 500,
          outstandingAmount: 0,
          items: [{ sku: "TEST-001", quantity: 25, lineTotal: 500 }],
        },
        {
          distributorName: "Bright Retail Co.",
          distributorLevel: "B",
          sourceChannel: "Email",
          status: "approved",
          paymentStatus: "unpaid",
          totalValue: 250,
          outstandingAmount: 250,
          items: [{ sku: "TEST-001", quantity: 10, lineTotal: 250 }],
        },
      ],
      products: [uploadedProduct],
    });

    assert.equal(analytics.topRequestedSkus[0].label, "TEST-001");
    assert.equal(analytics.topRequestedSkus[0].value, 85);
    assert.equal(analytics.pendingConfirmationValue, 1250);
    assert.equal(analytics.demandBySourceChannel.Email, 250);
    assert.equal(analytics.paymentStatusBreakdown.requested, 1);
    assert.equal(analytics.paymentStatusBreakdown.paid, 1);
    assert.equal(analytics.paidValue, 500);
    assert.equal(analytics.outstandingValue, 1250);
  });

  it("validates payment status transitions and outstanding amount", () => {
    assert.equal(canTransitionPaymentStatus("unpaid", "requested"), true);
    assert.equal(canTransitionPaymentStatus("paid", "overdue"), false);
    assert.equal(calculateOutstandingAmount(1000, 250), 750);
    assert.equal(inferPaymentStatus(1000, 250), "partial");
    assert.equal(inferPaymentStatus(1000, 1000), "paid");
  });

  it("persists mark-as-paid fields and reloads the paid order snapshot", () => {
    const paidOrder = applyOrderPaymentUpdate(
      {
        totalValue: 18240,
        paymentStatus: "requested" as const,
        paymentMethod: "bank_transfer" as const,
        paymentDueDate: "2026-06-05",
        amountPaid: 0,
        outstandingAmount: 18240,
        events: [{ eventType: "payment_requested", label: "Payment requested" }],
      },
      { paymentStatus: "paid" }
    );

    assert.equal(paidOrder.paymentStatus, "paid");
    assert.equal(paidOrder.paymentMethod, "offline");
    assert.equal(paidOrder.amountPaid, 18240);
    assert.equal(paidOrder.outstandingAmount, 0);
    assert.equal(paidOrder.paymentDueDate, null);
    assert.equal(paidOrder.events.some((event) => event.eventType === "payment_paid"), true);

    const reloadedOrder = JSON.parse(JSON.stringify(paidOrder)) as typeof paidOrder;
    assert.equal(reloadedOrder.paymentStatus, "paid");
    assert.equal(reloadedOrder.outstandingAmount, 0);
    assert.equal(reloadedOrder.events.filter((event) => event.eventType === "payment_paid").length, 1);
  });

  it("builds an idempotent Stripe checkout reconciliation update", () => {
    const session = {
      id: "cs_test_123",
      client_reference_id: "11111111-1111-4111-8111-111111111111",
      amount_total: 35000,
      currency: "usd",
      payment_status: "paid",
      payment_intent: "pi_test_123",
      metadata: {
        order_id: "11111111-1111-4111-8111-111111111111",
        order_token: "PO-TEST01",
        order_number: "PO-ST01",
      },
    } as any;

    const reference = getStripeCheckoutSessionReference(session);
    assert.equal(reference.orderToken, "PO-TEST01");
    assert.equal(reference.amountPaid, 350);
    assert.equal(reference.paymentIntentId, "pi_test_123");

    const reconciled = buildStripeCheckoutReconciliation(
      {
        id: "11111111-1111-4111-8111-111111111111",
        order_number: "PO-ST01",
        status: "approved",
        total_value: 350,
        payment_status: "requested",
        payment_due_date: "2026-06-07",
        amount_paid: 0,
      },
      session,
      "2026-06-01T12:00:00.000Z"
    );

    assert.equal(reconciled.orderUpdate.payment_status, "paid");
    assert.equal(reconciled.orderUpdate.status, "distributor_confirmed");
    assert.equal(reconciled.orderUpdate.amount_paid, 350);
    assert.equal(reconciled.orderUpdate.outstanding_amount, 0);
    assert.equal(reconciled.eventType, "payment_paid");

    const duplicate = buildStripeCheckoutReconciliation(
      {
        id: "11111111-1111-4111-8111-111111111111",
        order_number: "PO-ST01",
        status: "distributor_confirmed",
        total_value: 350,
        payment_status: "paid",
        payment_due_date: null,
        amount_paid: 350,
      },
      session,
      "2026-06-01T12:05:00.000Z"
    );

    assert.equal(duplicate.orderUpdate.amount_paid, 350);
    assert.equal(duplicate.orderUpdate.outstanding_amount, 0);
  });

  it("creates a distributor portal PO and moves it through approval and payment", () => {
    const order = createPortalPoRequest({
      brandId: "brand-nimbus",
      brandName: "Nimbus Home Goods",
      distributorId: "dist-eurotrade",
      distributorName: "EuroTrade GmbH",
      distributorLevel: "A",
      tokenFactory: () => "PO-TEST01",
      now: new Date("2026-05-30T12:00:00.000Z"),
      cartItems: [{ ...uploadedProduct, qty: 50 }],
    });

    assert.equal(order.status, "po_requested");
    assert.equal(order.orderNumber, "PO-ST01");
    assert.equal(order.totalValue, 350);
    assert.equal(order.sourceChannel, "Distributor Portal");

    const approved = approvePortalPoRequest(order, "2026-05-30T12:05:00.000Z");
    assert.equal(approved.status, "approved");
    assert.equal(approved.events.some((event) => event.eventType === "brand_approved"), true);

    const requested = requestPortalOrderPayment(approved, "2026-06-06");
    assert.equal(requested.paymentStatus, "requested");
    assert.equal(requested.paymentDueDate, "2026-06-06");
    assert.equal(requested.outstandingAmount, 350);

    const paid = payPortalOrder(requested);
    assert.equal(paid.paymentStatus, "paid");
    assert.equal(paid.amountPaid, 350);
    assert.equal(paid.outstandingAmount, 0);
  });

  it("builds AR, credit, and collection recommendations for finance control", () => {
    const requested = requestPortalOrderPayment(approvePortalPoRequest(createPortalPoRequest({
      brandId: "brand-nimbus",
      brandName: "Nimbus Home Goods",
      distributorId: "dist-eurotrade",
      distributorName: "EuroTrade GmbH",
      distributorLevel: "A",
      tokenFactory: () => "PO-FIN01",
      now: new Date("2026-05-25T12:00:00.000Z"),
      cartItems: [{ ...uploadedProduct, qty: 100 }],
    }), "2026-05-25T12:05:00.000Z"), "2026-06-02");

    const overdue = {
      ...requested,
      orderNumber: "PO-OVER",
      shareToken: "PO-OVER",
      token: "PO-OVER",
      paymentDueDate: "2026-05-29",
      totalValue: 1200,
      outstandingAmount: 1200,
    };

    const finance = buildFinanceControl({
      orders: [requested, overdue],
      distributors: financeDistributors,
      now: new Date("2026-05-30T12:00:00.000Z"),
    });

    assert.equal(finance.ar.totalOutstanding, 1900);
    assert.equal(finance.ar.overdueOutstanding, 1200);
    assert.equal(finance.collectionQueue[0].urgency, "high");
    assert.equal(finance.collectionQueue.some((item) => item.paymentRail === "bank_transfer"), true);
    assert.ok(finance.creditProfiles.find((profile) => profile.distributorName === "EuroTrade GmbH")?.trustScore);
    assert.ok(finance.recommendations.some((item) => item.includes("bank transfer") || item.includes("overdue")));
  });

  it("creates an order event timeline for the full workflow", () => {
    const events = [
      ["product_imported", "Product imported"],
      ["message_pasted", "Message pasted"],
      ["draft_generated", "Draft generated"],
      ["brand_approved", "Brand approved"],
      ["link_created", "Link created"],
      ["distributor_confirmed", "Distributor confirmed"],
      ["payment_requested", "Payment requested"],
      ["payment_paid", "Payment paid"],
    ].reduce<OrderEventRecord[]>((timeline, [eventType, label]) => appendOrderEventRecord(timeline, eventType, label), []);

    const timeline = createOrderEventTimeline(events);
    assert.equal(timeline.length, 8);
    assert.equal(timeline.every((event) => event.done), true);
    assert.equal(timeline.at(-1)?.eventType, "payment_paid");
  });

  it("scopes records by brand workspace", () => {
    const nimbus = createBrandWorkspace({ id: "brand-nimbus", name: "Nimbus Home Goods" });
    const atlas = createBrandWorkspace({ id: "brand-atlas", name: "Atlas Supply" });
    const records = [
      { id: "p1", brandId: nimbus.id, sku: "NIM-1" },
      { id: "p2", brandId: atlas.id, sku: "ATL-1" },
      { id: "p3", brand_id: nimbus.id, sku: "NIM-2" },
    ];

    assert.equal(nimbus.slug, "nimbus-home-goods");
    assert.equal(brandStorageKey(nimbus.id, "orders"), "distributor-os:brand-nimbus:orders");
    assert.deepEqual(filterByBrand(records, nimbus.id).map((record) => record.sku), ["NIM-1", "NIM-2"]);
  });

  it("creates and accepts distributor portal invitations", () => {
    const now = new Date("2026-05-30T12:00:00.000Z");
    const invite = createDistributorInvite({
      brandId: "brand-nimbus",
      brandName: "Nimbus Home Goods",
      distributorId: "dist-eurotrade",
      distributorName: "EuroTrade GmbH",
      distributorLevel: "A",
      email: "buyer@example.com",
      appUrl: "https://pilot.example.com/",
      now,
      tokenFactory: () => "INV-TEST123",
    });

    assert.equal(invite.inviteUrl, "https://pilot.example.com/invite/INV-TEST123");
    assert.equal(invite.status, "pending");
    assert.equal(getInviteStatus(invite, now), "pending");

    const accepted = acceptDistributorInvite(invite, new Date("2026-05-31T12:00:00.000Z"));
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.acceptedAt, "2026-05-31T12:00:00.000Z");
    assert.equal(getInviteStatus(accepted, now), "accepted");
  });
});

function createTinyXlsx() {
  const entries = [
    {
      name: "xl/workbook.xml",
      data: `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Catalog" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: `<worksheet><sheetData>${xlsxRow(1, ["sku", "name", "category", "moq", "stock", "level_a_price", "level_b_price", "level_c_price"])}${xlsxRow(2, ["SKU-1", "XLSX Product", "General", "1", "5", "1", "2", "3"])}</sheetData></worksheet>`,
    },
  ];

  const fileParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    fileParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...fileParts, centralDirectory, eocd]);
}

function xlsxRow(rowIndex: number, values: string[]) {
  return `<row r="${rowIndex}">${values.map((value, colIndex) => {
    const ref = `${String.fromCharCode(65 + colIndex)}${rowIndex}`;
    return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
  }).join("")}</row>`;
}
