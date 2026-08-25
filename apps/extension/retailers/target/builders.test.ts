// apps/extension/retailers/target/builders.test.ts
import { describe, expect, it } from "vitest";
import {
  buildPurchaseOrder, buildRefundOrder, toInvoiceDetail, toMixedPurchaseDetail, toReturnSectionDetail,
  cardPaymentCandidates,
} from "./builders";
import { distributeOrder } from "@/lib/distribution";
import type { RawTargetInvoiceDetail, RawTargetStoreDetail, RawTargetStoreSection } from "./scraper";
import type { YnabCharge } from "@/lib/types";

const charge = (over: Partial<YnabCharge>): YnabCharge => ({
  ynabTransactionId: "tx1", date: "2025-08-23", amountCents: 0,
  payeeName: "TARGET", isRefund: false, ...over,
});

describe("buildPurchaseOrder", () => {
  it("builds a verifiable single-charge purchase order that distributes to items", () => {
    const detail: RawTargetInvoiceDetail = {
      isRefund: false,
      items: [
        { productId: "90571485", title: "Diaper", unitPriceCents: 1859, quantity: 1, amountCents: 1859 },
      ],
      itemSubtotalCents: 1859,
      invoiceTotalCents: 1859,
      paymentLines: [{ cardLabel: "American Express*1014", isGiftCard: false, amountCents: 1859 }],
    };
    const order = buildPurchaseOrder("912003510147483", detail, { "90571485": "img.jpg" });
    expect(order.retailer).toBe("target");
    expect(order.orderId).toBe("912003510147483");
    expect(order.refund).toBeNull();
    expect(order.displayedItemsSubtotalCents).toBe(1859); // = sum(unitPrice*qty)
    expect(order.items[0]).toMatchObject({
      productId: "90571485", imageUrl: "img.jpg", unitPriceCents: 1859,
      quantity: 1, refundedAmountCents: 0,
    });

    const result = distributeOrder(order, [charge({ amountCents: 1859, isRefund: false })]);
    expect(result.failures).toEqual([]);
    expect(result.allocated[0].items[0].allocatedCents).toBe(1859);
  });

  it("falls back to empty imageUrl when productId is absent from imageMap", () => {
    const detail: RawTargetInvoiceDetail = {
      isRefund: false,
      items: [
        { productId: "90571485", title: "Diaper", unitPriceCents: 1859, quantity: 1, amountCents: 1859 },
      ],
      itemSubtotalCents: 1859,
      invoiceTotalCents: 1859,
      paymentLines: [{ cardLabel: "American Express*1014", isGiftCard: false, amountCents: 1859 }],
    };
    const order = buildPurchaseOrder("912003510147483", detail, {});
    expect(order.items[0].imageUrl).toBe("");
  });

  it("maps two items and distributes a single charge across both", () => {
    const detail: RawTargetInvoiceDetail = {
      isRefund: false,
      items: [
        { productId: "aaa", title: "Item A", unitPriceCents: 1000, quantity: 2, amountCents: 2000 },
        { productId: "bbb", title: "Item B", unitPriceCents: 500, quantity: 1, amountCents: 500 },
      ],
      itemSubtotalCents: 2500,
      invoiceTotalCents: 2500,
      paymentLines: [{ cardLabel: "Visa*1234", isGiftCard: false, amountCents: 2500 }],
    };
    const order = buildPurchaseOrder("ord-multi", detail, { aaa: "img-a.jpg", bbb: "img-b.jpg" });

    expect(order.items).toHaveLength(2);
    expect(order.items[0]).toMatchObject({ productId: "aaa", imageUrl: "img-a.jpg" });
    expect(order.items[1]).toMatchObject({ productId: "bbb", imageUrl: "img-b.jpg" });
    expect(order.displayedItemsSubtotalCents).toBe(detail.itemSubtotalCents);

    const result = distributeOrder(order, [charge({ amountCents: 2500, isRefund: false })]);
    expect(result.failures).toEqual([]);
    const allocatedItems = result.allocated[0].items;
    const totalAllocated = allocatedItems.reduce((s, it) => s + it.allocatedCents, 0);
    expect(totalAllocated).toBe(2500);
  });
});

describe("buildRefundOrder", () => {
  it("allocates a gift-card-split refund to the card portion only", () => {
    const detail: RawTargetInvoiceDetail = {
      isRefund: true,
      items: [
        { productId: "93891638", title: "Swimsuit", unitPriceCents: 4000, quantity: 1, amountCents: 4000 },
      ],
      itemSubtotalCents: 4000,
      invoiceTotalCents: 4390,
      paymentLines: [
        { cardLabel: "Visa*6523", isGiftCard: false, amountCents: 2890 },
        { cardLabel: "Target GiftCard", isGiftCard: true, amountCents: 1500 },
      ],
    };
    const refundCharge = charge({ amountCents: 2890, isRefund: true });
    const order = buildRefundOrder("902002727679794", detail, refundCharge, { "93891638": "img.jpg" });

    // displayedItemsSubtotalCents must be the gross item sum, not the refund/card total.
    expect(order.displayedItemsSubtotalCents).toBe(4000);
    expect(order.refund).toEqual({ itemCents: 4000, taxCents: 390, totalCents: 2890 });
    expect(order.items[0].refundedAmountCents).toBe(4000);

    const result = distributeOrder(order, [refundCharge]);
    expect(result.failures).toEqual([]);
    expect(result.allocated[0].items[0].allocatedCents).toBe(2890);
  });
});

describe("toInvoiceDetail", () => {
  it("passes a pure (single-section) receipt through unchanged", () => {
    const detail: RawTargetStoreDetail = {
      sections: [
        {
          isRefund: false,
          date: "2026-08-21",
          items: [{ productId: "aaa", title: "Item A", unitPriceCents: 500, quantity: 2, amountCents: 1000 }],
          itemSubtotalCents: 1000,
        },
      ],
      invoiceTotalCents: 1000,
      paymentLines: [{ cardLabel: "Visa*1234", isGiftCard: false, amountCents: 1000 }],
    };
    expect(toInvoiceDetail(detail)).toEqual({
      isRefund: false,
      items: detail.sections[0].items,
      itemSubtotalCents: 1000,
      invoiceTotalCents: 1000,
      paymentLines: detail.paymentLines,
    });
  });
});

describe("toMixedPurchaseDetail and toReturnSectionDetail", () => {
  // Real numbers from receipt /orders/stores/6097-1430-0171-4403, corrected
  // after live testing: the ORIGINAL card charge was $100.65 (full receipt,
  // both sections combined) — Target does not net out the later return — and
  // a SEPARATE $67.65 refund posted weeks later for just the returned items
  // (their $62.50 list price plus their own $5.15 tax).
  const purchaseSection: RawTargetStoreSection = {
    isRefund: false,
    date: "2026-04-07",
    items: [
      { productId: "p1", title: "Plush", unitPriceCents: 250, quantity: 1, amountCents: 250 },
      { productId: "p2", title: "T-Shirt", unitPriceCents: 1400, quantity: 1, amountCents: 1400 },
    ],
    itemSubtotalCents: 1650,
  };
  const returnSection: RawTargetStoreSection = {
    isRefund: true,
    date: "2026-05-03",
    items: [
      { productId: "r1", title: "Returned Widget", unitPriceCents: 6250, quantity: 1, amountCents: 6250 },
    ],
    itemSubtotalCents: 6250,
  };
  const detail: RawTargetStoreDetail = {
    sections: [purchaseSection, returnSection],
    invoiceTotalCents: 10065,
    paymentLines: [{ cardLabel: "Visa*4434", isGiftCard: false, amountCents: 10065 }],
  };

  it("toMixedPurchaseDetail combines every section's items unmarked, using the receipt's real full total", () => {
    const invoiceDetail = toMixedPurchaseDetail(detail);
    expect(invoiceDetail).toEqual({
      isRefund: false,
      items: [...purchaseSection.items, ...returnSection.items],
      itemSubtotalCents: 1650 + 6250,
      invoiceTotalCents: 10065,
      paymentLines: detail.paymentLines,
    });

    const order = buildPurchaseOrder("instore-r1", invoiceDetail, { p1: "p1.jpg", r1: "r1.jpg" });
    expect(order.items).toHaveLength(3);
    expect(order.items.every((i) => i.refundedAmountCents === 0)).toBe(true);

    const purchaseCharge = charge({ ynabTransactionId: "yt-purchase", amountCents: 10065, isRefund: false });
    const result = distributeOrder(order, [purchaseCharge]);
    expect(result.failures).toEqual([]);
    // The full $100.65 charge reconciles against all 3 items, not just the
    // "Purchased"-section pair.
    expect(result.allocated[0].items.reduce((s, i) => s + i.allocatedCents, 0)).toBe(10065);
  });

  it("toReturnSectionDetail builds a standalone refund order from just the return section", () => {
    const refundCharge = charge({ ynabTransactionId: "yt-refund", amountCents: 6765, isRefund: true });
    const returnDetail = toReturnSectionDetail(returnSection, refundCharge);
    expect(returnDetail).toEqual({
      isRefund: true,
      items: returnSection.items,
      itemSubtotalCents: 6250,
      invoiceTotalCents: 6765,
      paymentLines: [],
    });

    const order = buildRefundOrder("instore-r1", returnDetail, refundCharge, { r1: "r1.jpg" });
    expect(order.items).toEqual([
      expect.objectContaining({ productId: "r1", imageUrl: "r1.jpg", refundedAmountCents: 6250 }),
    ]);
    // taxCents derives from the REAL matched charge, not an estimate.
    expect(order.refund).toEqual({ itemCents: 6250, taxCents: 515, totalCents: 6765 });

    const result = distributeOrder(order, [refundCharge]);
    expect(result.failures).toEqual([]);
    expect(result.allocated[0].items[0].allocatedCents).toBe(6765);
  });
});

describe("cardPaymentCandidates", () => {
  it("excludes gift-card lines and tags refund/date/order/invoice", () => {
    const detail: RawTargetInvoiceDetail = {
      isRefund: true, items: [], /* items are irrelevant to payment-line candidate filtering */ itemSubtotalCents: 0, invoiceTotalCents: 4390,
      paymentLines: [
        { cardLabel: "Visa*6523", isGiftCard: false, amountCents: 2890 },
        { cardLabel: "Target GiftCard", isGiftCard: true, amountCents: 1500 },
      ],
    };
    expect(cardPaymentCandidates("ord", "inv", "2025-08-23", detail)).toEqual([
      { orderId: "ord", invoiceId: "inv", date: "2025-08-23", amountCents: 2890, isRefund: true },
    ]);
  });
});
