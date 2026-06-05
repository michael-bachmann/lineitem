// apps/extension/retailers/target/builders.test.ts
import { describe, expect, it } from "vitest";
import { buildPurchaseOrder, buildRefundOrder, cardPaymentCandidates } from "./builders";
import { distributeOrder } from "@/lib/distribution";
import type { RawTargetInvoiceDetail } from "./scraper";
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
