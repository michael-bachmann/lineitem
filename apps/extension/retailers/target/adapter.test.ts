import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the tab driver so the coordinator test can script page results.
const { openRetailerTab, awaitPageResult } = vi.hoisted(() => ({
  openRetailerTab: vi.fn(),
  awaitPageResult: vi.fn(),
}));
vi.mock("@/background/tabs", () => ({
  openRetailerTab,
  awaitPageResult,
  clearBufferedPageResult: vi.fn(),
}));

import {
  orderMightMatch, invoiceMightSplitMatch, readWithRetry, StepUpRequired, targetAdapter,
} from "./adapter";
import type { RawTargetOrder, RawTargetInvoice } from "./scraper";
import type { TargetPageResult } from "./page";
import type { YnabCharge } from "@/lib/types";
import { NO_MATCH_REASON } from "@/lib/matcher";

const charge = (over: Partial<YnabCharge>): YnabCharge => ({
  ynabTransactionId: "tx", date: "2025-07-03", amountCents: 1000,
  payeeName: "TARGET", isRefund: false, ...over,
});

describe("orderMightMatch", () => {
  const order: RawTargetOrder = { orderId: "o1", date: "2025-07-01", orderTotalCents: 5000 };

  it("keeps a purchase charge within the placed-date window and under the total", () => {
    expect(orderMightMatch(order, [charge({ date: "2025-07-03", amountCents: 1000 })])).toBe(true);
  });

  it("skips a purchase charge more than 45 days after the order", () => {
    expect(orderMightMatch(order, [charge({ date: "2025-09-01" })])).toBe(false);
  });

  it("KEEPS a refund posting long after the order (returns process arbitrarily late)", () => {
    // The bug this guards: refunds were upper-bounded like purchases and dropped.
    expect(orderMightMatch(order, [charge({ date: "2025-09-29", isRefund: true })])).toBe(true);
  });

  it("skips a charge larger than the order total", () => {
    expect(orderMightMatch(order, [charge({ amountCents: 6000 })])).toBe(false);
  });

  it("skips a charge more than 7 days before the order was placed", () => {
    expect(orderMightMatch(order, [charge({ date: "2025-06-20" })])).toBe(false);
  });

  it("does not filter on total when the order total is unknown", () => {
    const noTotal: RawTargetOrder = { ...order, orderTotalCents: null };
    expect(orderMightMatch(noTotal, [charge({ amountCents: 999999, date: "2025-07-03" })])).toBe(true);
  });

  it("keeps an order with an unparseable date (can't safely pre-filter)", () => {
    const noDate: RawTargetOrder = { ...order, date: "" };
    expect(orderMightMatch(noDate, [charge({ date: "2025-07-03" })])).toBe(true);
  });
});

describe("invoiceMightSplitMatch", () => {
  const inv: RawTargetInvoice = { invoiceId: "i1", date: "2025-07-28", amountCents: 4390, isRefund: false };

  it("keeps an invoice whose total >= charge, within 3 days, same sign", () => {
    expect(invoiceMightSplitMatch(inv, [charge({ date: "2025-07-27", amountCents: 2890 })])).toBe(true);
  });

  it("skips an invoice whose total is below the charge", () => {
    expect(invoiceMightSplitMatch(inv, [charge({ date: "2025-07-27", amountCents: 5000 })])).toBe(false);
  });

  it("skips an invoice more than 3 days from the charge", () => {
    expect(invoiceMightSplitMatch(inv, [charge({ date: "2025-08-10", amountCents: 2890 })])).toBe(false);
  });

  it("skips on refund-sign mismatch", () => {
    expect(invoiceMightSplitMatch(inv, [charge({ date: "2025-07-27", amountCents: 2890, isRefund: true })])).toBe(false);
  });
});

describe("readWithRetry", () => {
  it("returns the result without retrying when the read succeeds", async () => {
    const read = vi.fn(async () => "ok");
    await expect(readWithRetry("x", read)).resolves.toBe("ok");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("retries once and succeeds when the first read fails (a transient hang)", async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(new Error("hung"))
      .mockResolvedValueOnce("ok");
    await expect(readWithRetry("x", read)).resolves.toBe("ok");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("rethrows after the retry also fails (caller skips this page)", async () => {
    const read = vi.fn(async () => { throw new Error("still hung"); });
    await expect(readWithRetry("x", read)).rejects.toThrow("still hung");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a StepUpRequired (the whole session is gated)", async () => {
    const read = vi.fn(async () => { throw new StepUpRequired(); });
    await expect(readWithRetry("x", read)).rejects.toBeInstanceOf(StepUpRequired);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("targetAdapter.scrapeMatchedOrders (coordinator)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("browser", {
      tabs: {
        update: vi.fn(async () => {}),
        sendMessage: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
    });
    openRetailerTab.mockResolvedValue({ tabId: 1, weOpenedTab: true });
  });

  function queueResults(...results: TargetPageResult[]) {
    const q = [...results];
    awaitPageResult.mockImplementation(async () => q.shift());
  }

  it("returns signed_out when the orders list shows login", async () => {
    queueResults({ pageKind: "login" });
    const c = charge({});
    const res = await targetAdapter.scrapeMatchedOrders([c]);
    expect(res.matched).toEqual([]);
    expect(res.blocked).toEqual({ reason: "signed_out", charges: [c] });
  });

  it("surfaces a step_up block with the gated URL and keeps partial results when a gated page hits login", async () => {
    const c = charge({ amountCents: 1000, date: "2026-06-01" });
    queueResults(
      {
        pageKind: "orders",
        hasMore: false,
        fingerprint: "f1",
        orders: [{ orderId: "O1", date: "2026-06-01", orderTotalCents: 5000 }],
      },
      { pageKind: "login" }, // the invoices navigation landed on Target's step-up
    );
    const res = await targetAdapter.scrapeMatchedOrders([c]);
    expect(res.matched).toEqual([]);
    expect(res.blocked?.reason).toBe("step_up");
    expect(res.blocked?.charges).toEqual([c]);
    expect(res.blocked?.url).toContain("/orders/O1/invoices");
  });

  it("walks orders → invoices → invoice-detail → images and builds the matched order", async () => {
    const c = charge({ amountCents: 1000, date: "2026-06-01" });
    queueResults(
      {
        pageKind: "orders",
        hasMore: false,
        fingerprint: "f1",
        orders: [{ orderId: "O1", date: "2026-06-01", orderTotalCents: 5000 }],
      },
      {
        pageKind: "invoices",
        orderId: "O1",
        invoices: [{ invoiceId: "INV1", date: "2026-06-01", amountCents: 1000, isRefund: false }],
      },
      {
        pageKind: "invoice-detail",
        orderId: "O1",
        invoiceId: "INV1",
        detail: {
          isRefund: false,
          items: [{ productId: "P1", title: "Thing", unitPriceCents: 1000, quantity: 1, amountCents: 1000 }],
          itemSubtotalCents: 1000,
          invoiceTotalCents: 1000,
          paymentLines: [{ cardLabel: "visa", isGiftCard: false, amountCents: 1000 }],
        },
      },
      { pageKind: "order-images", orderId: "O1", imageMap: { P1: "img-url" } },
    );

    const res = await targetAdapter.scrapeMatchedOrders([c]);
    expect(res.blocked).toBeUndefined();
    expect(res.unmatched).toEqual([]);
    expect(res.matched).toHaveLength(1);
    expect(res.matched[0].order.orderId).toBe("O1");
    expect(res.matched[0].order.items[0]).toMatchObject({ productId: "P1", imageUrl: "img-url" });
    expect(res.matched[0].charges).toEqual([c]);
  });

  // Phase 5: in-store purchases. Every scenario below starts with an empty
  // online orders list (phases 1-4 are no-ops), so Phase 5 always runs. Two
  // "orders" results are queued before the in-store ones: the first read and
  // the "get back to /orders" read Phase 5 does before switching tabs.
  const emptyOnlineOrders: TargetPageResult = {
    pageKind: "orders", orders: [], hasMore: false, fingerprint: "empty",
  };

  describe("Phase 5a — pure in-store receipts", () => {
    it("matches a pure in-store purchase by list-card total and builds the order", async () => {
      const c = charge({ amountCents: 400, date: "2026-04-07", isRefund: false });
      queueResults(
        emptyOnlineOrders,
        emptyOnlineOrders,
        {
          pageKind: "store-orders",
          orders: [{ receiptId: "R1", date: "2026-04-07", totalCents: 400, isRefund: false }],
          hasMore: false,
          fingerprint: "s1",
        },
        {
          pageKind: "store-purchase-detail",
          receiptId: "R1",
          detail: {
            sections: [{
              isRefund: false,
              date: "2026-04-07",
              items: [{ productId: "P1", title: "Thing", unitPriceCents: 400, quantity: 1, amountCents: 400 }],
              itemSubtotalCents: 400,
            }],
            invoiceTotalCents: 400,
            paymentLines: [{ cardLabel: "Visa", isGiftCard: false, amountCents: 400 }],
          },
          imageMap: { P1: "img-url" },
        },
      );

      const res = await targetAdapter.scrapeMatchedOrders([c]);
      expect(res.unmatched).toEqual([]);
      expect(res.matched).toHaveLength(1);
      expect(res.matched[0].order.orderId).toBe("instore-R1");
      expect(res.matched[0].order.refund).toBeNull();
      expect(res.matched[0].charges).toEqual([c]);
    });

    it("matches a pure in-store refund by list-card total and builds the refund order", async () => {
      const c = charge({ amountCents: 1200, date: "2026-05-03", isRefund: true });
      queueResults(
        emptyOnlineOrders,
        emptyOnlineOrders,
        {
          pageKind: "store-orders",
          orders: [{ receiptId: "R2", date: "2026-05-03", totalCents: 1200, isRefund: true }],
          hasMore: false,
          fingerprint: "s1",
        },
        {
          pageKind: "store-purchase-detail",
          receiptId: "R2",
          detail: {
            sections: [{
              isRefund: true,
              date: "2026-05-03",
              items: [{ productId: "P2", title: "Returned Item", unitPriceCents: 1200, quantity: 1, amountCents: 1200 }],
              itemSubtotalCents: 1200,
            }],
            invoiceTotalCents: 1200,
            paymentLines: [{ cardLabel: "Visa", isGiftCard: false, amountCents: 1200 }],
          },
          imageMap: {},
        },
      );

      const res = await targetAdapter.scrapeMatchedOrders([c]);
      expect(res.unmatched).toEqual([]);
      expect(res.matched).toHaveLength(1);
      expect(res.matched[0].order.orderId).toBe("instore-R2");
      expect(res.matched[0].order.refund).toEqual({ itemCents: 1200, taxCents: 0, totalCents: 1200 });
      expect(res.matched[0].charges).toEqual([c]);
    });

    it("leaves a charge with no matching in-store receipt unmatched", async () => {
      const c = charge({ amountCents: 999999, date: "2026-04-07", isRefund: false });
      queueResults(
        emptyOnlineOrders,
        emptyOnlineOrders,
        {
          pageKind: "store-orders",
          // totalCents (100) is below the charge amount, so Phase 5b's
          // "could this cover a remaining charge" prefilter also skips it —
          // no detail page read should be attempted.
          orders: [{ receiptId: "R3", date: "2026-04-07", totalCents: 100, isRefund: false }],
          hasMore: false,
          fingerprint: "s1",
        },
      );

      const res = await targetAdapter.scrapeMatchedOrders([c]);
      expect(res.matched).toEqual([]);
      expect(res.unmatched).toEqual([{ charge: c, reason: NO_MATCH_REASON }]);
      expect(awaitPageResult).toHaveBeenCalledTimes(3);
    });
  });

  describe("Phase 5a/5b — mixed (purchase + later return) in-store receipts", () => {
    // Real shape/numbers confirmed live on receipt
    // /orders/stores/6097-1430-0171-4403, corrected after live testing: the
    // list card's total ($100.65) IS the real original purchase charge (not
    // netted against the later return), and list-level isRefund is false
    // (every in-store list card says "Purchased", even a later-returned one).
    // The $67.65 refund is a separate, later charge with no displayed total
    // of its own on the page.
    const mixedStoreOrder: TargetPageResult = {
      pageKind: "store-orders",
      orders: [{ receiptId: "R4", date: "2026-04-07", totalCents: 10065, isRefund: false }],
      hasMore: false,
      fingerprint: "s1",
    };
    const mixedDetail: TargetPageResult = {
      pageKind: "store-purchase-detail",
      receiptId: "R4",
      detail: {
        sections: [
          {
            isRefund: false,
            date: "2026-04-07",
            items: [{ productId: "P1", title: "Plush", unitPriceCents: 3048, quantity: 1, amountCents: 3048 }],
            itemSubtotalCents: 3048,
          },
          {
            isRefund: true,
            date: "2026-05-03",
            items: [{ productId: "P2", title: "Returned Widget", unitPriceCents: 6250, quantity: 1, amountCents: 6250 }],
            itemSubtotalCents: 6250,
          },
        ],
        invoiceTotalCents: 10065,
        paymentLines: [{ cardLabel: "Visa", isGiftCard: false, amountCents: 10065 }],
      },
      imageMap: {},
    };

    it("matches the purchase charge to the FULL receipt (both sections) via Phase 5a, and the later refund via Phase 5b", async () => {
      const purchase = charge({ ynabTransactionId: "yt-p", amountCents: 10065, date: "2026-04-07", isRefund: false });
      const refund = charge({ ynabTransactionId: "yt-r", amountCents: 6765, date: "2026-05-02", isRefund: true });
      // The purchase side opens the receipt once (Phase 5a's list-total match);
      // the refund-discovery pass (Phase 5b) opens it again independently.
      queueResults(emptyOnlineOrders, emptyOnlineOrders, mixedStoreOrder, mixedDetail, mixedDetail);

      const res = await targetAdapter.scrapeMatchedOrders([purchase, refund]);
      expect(res.unmatched).toEqual([]);
      expect(res.matched).toHaveLength(2);

      const byTx = new Map(res.matched.map((m) => [m.charges[0].ynabTransactionId, m]));
      const purchaseMatch = byTx.get("yt-p")!;
      expect(purchaseMatch.order.orderId).toBe("instore-R4");
      expect(purchaseMatch.order.refund).toBeNull();
      // Reconciles against BOTH sections' items (one from each), not just
      // the "Purchased" section's.
      expect(purchaseMatch.order.items).toHaveLength(2);
      expect(purchaseMatch.order.displayedItemsSubtotalCents).toBe(3048 + 6250);

      const refundMatch = byTx.get("yt-r")!;
      expect(refundMatch.order.orderId).toBe("instore-R4");
      expect(refundMatch.order.refund).toEqual({ itemCents: 6250, taxCents: 515, totalCents: 6765 });
      expect(refundMatch.order.items).toHaveLength(1);
    });

    it("matches a refund charge on its own via Phase 5b even when the purchase side isn't in this batch", async () => {
      const refund = charge({ ynabTransactionId: "yt-r", amountCents: 6765, date: "2026-05-02", isRefund: true });
      // Phase 5a never opens the receipt (no purchase-direction charge to
      // match its list total), so only one detail read happens.
      queueResults(emptyOnlineOrders, emptyOnlineOrders, mixedStoreOrder, mixedDetail);

      const res = await targetAdapter.scrapeMatchedOrders([refund]);
      expect(res.unmatched).toEqual([]);
      expect(res.matched).toHaveLength(1);
      expect(res.matched[0].charges).toEqual([refund]);
      expect(res.matched[0].order.refund).toEqual({ itemCents: 6250, taxCents: 515, totalCents: 6765 });
    });

    it("fails safe (no guess) when more than one remaining charge plausibly matches the return section", async () => {
      const refundA = charge({ ynabTransactionId: "yt-ra", amountCents: 6765, date: "2026-05-02", isRefund: true });
      const refundB = charge({ ynabTransactionId: "yt-rb", amountCents: 6800, date: "2026-05-04", isRefund: true });
      queueResults(emptyOnlineOrders, emptyOnlineOrders, mixedStoreOrder, mixedDetail);

      const res = await targetAdapter.scrapeMatchedOrders([refundA, refundB]);
      expect(res.matched).toEqual([]);
      expect(res.unmatched).toHaveLength(2);
      expect(res.unmatched.map((u) => u.charge.ynabTransactionId).sort()).toEqual(["yt-ra", "yt-rb"]);
    });
  });
});
