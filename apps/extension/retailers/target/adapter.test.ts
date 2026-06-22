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
});
