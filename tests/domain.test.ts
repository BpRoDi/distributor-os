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
import { appendOrderEventRecord, createOrderEventTimeline, type OrderEventRecord } from "../lib/orders/events.ts";
import { applyOrderPaymentUpdate } from "../lib/orders/payment.ts";
import {
  calculateOutstandingAmount,
  canTransitionPaymentStatus,
  inferPaymentStatus,
} from "../lib/payments/status.ts";

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
      ],
      products: [uploadedProduct],
    });

    assert.equal(analytics.topRequestedSkus[0].label, "TEST-001");
    assert.equal(analytics.topRequestedSkus[0].value, 75);
    assert.equal(analytics.pendingConfirmationValue, 1000);
    assert.equal(analytics.paymentStatusBreakdown.requested, 1);
    assert.equal(analytics.paymentStatusBreakdown.paid, 1);
    assert.equal(analytics.paidValue, 500);
    assert.equal(analytics.outstandingValue, 1000);
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
