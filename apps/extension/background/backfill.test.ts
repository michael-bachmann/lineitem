import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSettingsMock,
  getTransactionsSinceMock,
  getAllocatedTransactionMock,
  putAllocatedTransactionsMock,
  getRetailerForPayeeMock,
  scrapeMatchedOrdersMock,
  getAdapterMock,
  learnFromApprovalMock,
  verifyScrapeMock,
  distributeOrderMock,
} = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  getTransactionsSinceMock: vi.fn(),
  getAllocatedTransactionMock: vi.fn(),
  putAllocatedTransactionsMock: vi.fn(async (_rows: readonly { ynabTransactionId: string }[]) => {}),
  getRetailerForPayeeMock: vi.fn(),
  scrapeMatchedOrdersMock: vi.fn(),
  getAdapterMock: vi.fn(),
  learnFromApprovalMock: vi.fn(
    async (
      _retailer: string,
      _entries: readonly { productId: string; title: string; categoryId: string }[],
      _onProgress?: (p: { index: number; total: number }) => void,
    ) => {},
  ),
  verifyScrapeMock: vi.fn(),
  distributeOrderMock: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({ getSettings: getSettingsMock }));
vi.mock("@/lib/ynab", () => ({ getTransactionsSince: getTransactionsSinceMock }));
vi.mock("@/lib/db", () => ({
  getAllocatedTransaction: getAllocatedTransactionMock,
  putAllocatedTransactions: putAllocatedTransactionsMock,
}));
vi.mock("@/lib/registry", () => ({ getRetailerForPayee: getRetailerForPayeeMock }));
vi.mock("@/retailers/registry", () => ({ getAdapter: getAdapterMock }));
vi.mock("./approval", () => ({ learnFromApproval: learnFromApprovalMock }));
vi.mock("@/lib/verify-scrape", () => ({ verifyScrape: verifyScrapeMock }));
vi.mock("@/lib/distribution", () => ({ distributeOrder: distributeOrderMock }));

import { runBackfill } from "./backfill";
import { READ_FAILED_REASON } from "@/lib/matcher";
import type {
  ScrapedOrder,
  YnabCharge,
  YnabTransaction,
} from "@/lib/types";

function tx(overrides: Partial<YnabTransaction> = {}): YnabTransaction {
  return {
    id: "tx-1",
    date: "2026-04-01",
    amount: -10000,
    payee_name: "AMAZON.COM",
    category_id: "cat-groceries",
    category_name: "Groceries",
    approved: true,
    subtransactions: [],
    ...overrides,
  };
}

function order(overrides: Partial<ScrapedOrder> = {}): ScrapedOrder {
  return {
    retailer: "amazon",
    orderId: "111-2222222-3333333",
    items: [
      { productId: "A1", title: "Paper towels", imageUrl: "", unitPriceCents: 500, quantity: 1, refundedAmountCents: 0 },
      { productId: "A2", title: "Trash bags", imageUrl: "", unitPriceCents: 500, quantity: 1, refundedAmountCents: 0 },
    ],
    displayedItemsSubtotalCents: 1000,
    refund: null,
    ...overrides,
  };
}

function allocatedTx(
  overrides: Partial<import("@/lib/types").AllocatedTransaction> = {},
): import("@/lib/types").AllocatedTransaction {
  return {
    ynabTransactionId: "tx-1",
    orderKey: "amazon:111-2222222-3333333",
    retailer: "amazon",
    date: "2026-04-01",
    amountCents: 1000,
    isRefund: false,
    items: [],
    ...overrides,
  };
}

beforeEach(() => {
  getSettingsMock.mockResolvedValue({ accessToken: "tok", planId: "plan" });
  getAllocatedTransactionMock.mockResolvedValue(undefined);
  putAllocatedTransactionsMock.mockClear();
  getTransactionsSinceMock.mockReset();
  getRetailerForPayeeMock.mockReset();
  scrapeMatchedOrdersMock.mockReset();
  learnFromApprovalMock.mockReset();
  verifyScrapeMock.mockReset();
  distributeOrderMock.mockReset();
  // Defaults: verify passes, distribute echoes one allocation per charge.
  verifyScrapeMock.mockReturnValue({ ok: true });
  distributeOrderMock.mockImplementation(
    (order: import("@/lib/types").ScrapedOrder, charges: YnabCharge[]) => ({
      allocated: charges.map((c) =>
        allocatedTx({
          ynabTransactionId: c.ynabTransactionId,
          orderKey: `${order.retailer}:${order.orderId}`,
          amountCents: c.amountCents,
          items: order.items.map((it) => ({ ...it, allocatedCents: 0 })),
        }),
      ),
      failures: [],
    }),
  );
  // Default: every Amazon-looking payee maps to amazon/scrape.
  getRetailerForPayeeMock.mockImplementation((payee: string) =>
    /amazon/i.test(payee) ? { retailer: "amazon", strategy: "scrape" } : null,
  );
  // Default adapter resolves matches 1:1 against the charges it received.
  getAdapterMock.mockReturnValue({
    id: "amazon",
    payees: [],
    scrapeMatchedOrders: scrapeMatchedOrdersMock,
  });
});

describe("runBackfill — filtering", () => {
  it("skips unapproved transactions", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ approved: false })]);
    scrapeMatchedOrdersMock.mockResolvedValue({ matched: [], unmatched: [] });
    const result = await runBackfill({ fromDate: "2025-01-01" });
    expect(result.transactionsBackfilled).toBe(0);
    expect(result.hasUnbackfilled).toBe(false);
    expect(scrapeMatchedOrdersMock).not.toHaveBeenCalled();
  });

  it("skips uncategorized transactions", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ category_id: null })]);
    const result = await runBackfill({ fromDate: "2025-01-01" });
    expect(result.transactionsBackfilled).toBe(0);
  });

  it("skips transactions with subtransactions", async () => {
    getTransactionsSinceMock.mockResolvedValue([
      tx({ subtransactions: [{ amount: -5000, category_id: "c", memo: null }] }),
    ]);
    const result = await runBackfill({ fromDate: "2025-01-01" });
    expect(result.transactionsBackfilled).toBe(0);
  });

  it("skips refund / inflow transactions", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ amount: 5000 })]);
    const result = await runBackfill({ fromDate: "2025-01-01" });
    expect(result.transactionsBackfilled).toBe(0);
  });

  it("skips payees that don't map to a scrape-strategy retailer", async () => {
    getRetailerForPayeeMock.mockReturnValue(null);
    getTransactionsSinceMock.mockResolvedValue([tx({ payee_name: "Mystery Cafe" })]);
    const result = await runBackfill({ fromDate: "2025-01-01" });
    expect(result.transactionsBackfilled).toBe(0);
  });

  it("skips skip-strategy payees (e.g. Amazon Prime)", async () => {
    getRetailerForPayeeMock.mockReturnValue({ retailer: "amazon", strategy: "skip" });
    getTransactionsSinceMock.mockResolvedValue([tx({ payee_name: "Amazon Prime" })]);
    const result = await runBackfill({ fromDate: "2025-01-01" });
    expect(result.transactionsBackfilled).toBe(0);
  });

  it("counts already-allocated eligible tx toward the cumulative total without re-scraping", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx()]);
    getAllocatedTransactionMock.mockResolvedValue({
      ynabTransactionId: "tx-1",
      items: [{ productId: "p1" }, { productId: "p2" }, { productId: "p3" }],
    });
    const result = await runBackfill({ fromDate: "2025-01-01" });
    expect(result.transactionsBackfilled).toBe(1);
    expect(result.itemsLearned).toBe(3);
    expect(result.hasUnbackfilled).toBe(false);
    expect(scrapeMatchedOrdersMock).not.toHaveBeenCalled();
  });

});

describe("runBackfill — idempotency via AllocatedTransaction", () => {
  it("writes an AllocatedTransaction for each successfully-processed order", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ id: "tx-1" }), tx({ id: "tx-2" })]);
    scrapeMatchedOrdersMock.mockImplementation(async (charges: YnabCharge[]) => ({
      matched: charges.map((c) => ({ order: order(), charges: [c] })),
      unmatched: [],
    }));

    await runBackfill({ fromDate: "2025-01-01" });

    expect(putAllocatedTransactionsMock).toHaveBeenCalledTimes(1);
    const [rows] = putAllocatedTransactionsMock.mock.calls[0];
    expect(rows.map((r) => r.ynabTransactionId).sort()).toEqual(["tx-1", "tx-2"]);
    // Learn happens before persist — items committed even if persist fails.
    expect(learnFromApprovalMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT persist for adapter-unmatched charges (so they retry next run)", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ id: "tx-1" }), tx({ id: "tx-2" })]);
    scrapeMatchedOrdersMock.mockImplementation(async (charges: YnabCharge[]) => ({
      matched: [{ order: order(), charges: [charges[0]] }],
      unmatched: [{ charge: charges[1], reason: "no match" }],
    }));

    await runBackfill({ fromDate: "2025-01-01" });

    const [rows] = putAllocatedTransactionsMock.mock.calls[0];
    expect(rows.map((r) => r.ynabTransactionId)).toEqual(["tx-1"]);
  });

  it("does NOT persist ambiguous (multi-charge) orders — accepts the cheap retry", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ id: "tx-1" }), tx({ id: "tx-2" })]);
    scrapeMatchedOrdersMock.mockImplementation(async (charges: YnabCharge[]) => ({
      matched: [{ order: order(), charges }],
      unmatched: [],
    }));

    await runBackfill({ fromDate: "2025-01-01" });

    expect(putAllocatedTransactionsMock).not.toHaveBeenCalled();
    expect(learnFromApprovalMock).not.toHaveBeenCalled();
  });

  it("skips orders whose scrape doesn't verify (and doesn't persist them)", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ id: "tx-1" })]);
    scrapeMatchedOrdersMock.mockImplementation(async (charges: YnabCharge[]) => ({
      matched: [{ order: order(), charges: [charges[0]] }],
      unmatched: [],
    }));
    verifyScrapeMock.mockReturnValue({ ok: false, message: "subtotal mismatch" });

    const result = await runBackfill({ fromDate: "2025-01-01" });

    expect(result.transactionsBackfilled).toBe(0);
    expect(putAllocatedTransactionsMock).not.toHaveBeenCalled();
    expect(learnFromApprovalMock).not.toHaveBeenCalled();
  });

  it("does not persist when the adapter throws", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx()]);
    scrapeMatchedOrdersMock.mockRejectedValue(new Error("boom"));

    await runBackfill({ fromDate: "2025-01-01" });

    expect(putAllocatedTransactionsMock).not.toHaveBeenCalled();
  });
});

describe("runBackfill — happy path", () => {
  it("scrapes per retailer and feeds matched items to learnFromApproval", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ id: "tx-1" }), tx({ id: "tx-2" })]);
    scrapeMatchedOrdersMock.mockImplementation(async (charges: YnabCharge[]) => ({
      matched: charges.map((c) => ({ order: order({ orderId: `o-${c.ynabTransactionId}` }), charges: [c] })),
      unmatched: [],
    }));

    const result = await runBackfill({ fromDate: "2025-01-01" });

    expect(result.transactionsBackfilled).toBe(2);
    expect(result.itemsLearned).toBe(4);
    expect(result.hasUnbackfilled).toBe(false);
    expect(result.failed).toBe(0);
    expect(learnFromApprovalMock).toHaveBeenCalledTimes(1);
    const [retailerArg, entriesArg] = learnFromApprovalMock.mock.calls[0];
    expect(retailerArg).toBe("amazon");
    expect(entriesArg).toHaveLength(4);
    expect(entriesArg.every((e: { categoryId: string }) => e.categoryId === "cat-groceries")).toBe(true);
  });

  it("flags hasUnbackfilled when the adapter couldn't match every charge", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ id: "tx-1" }), tx({ id: "tx-2" })]);
    scrapeMatchedOrdersMock.mockImplementation(async (charges: YnabCharge[]) => ({
      matched: [{ order: order(), charges: [charges[0]] }],
      unmatched: [{ charge: charges[1], reason: "no match" }],
    }));

    const result = await runBackfill({ fromDate: "2025-01-01" });

    expect(result.transactionsBackfilled).toBe(1);
    expect(result.hasUnbackfilled).toBe(true);
    expect(result.itemsLearned).toBe(2);
  });

  it("counts multi-charge orders as unbackfilled (ambiguous category)", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ id: "tx-1" }), tx({ id: "tx-2" })]);
    scrapeMatchedOrdersMock.mockImplementation(async (charges: YnabCharge[]) => ({
      matched: [{ order: order(), charges }],
      unmatched: [],
    }));

    const result = await runBackfill({ fromDate: "2025-01-01" });

    expect(result.transactionsBackfilled).toBe(0);
    expect(result.hasUnbackfilled).toBe(true);
    expect(result.itemsLearned).toBe(0);
    expect(learnFromApprovalMock).not.toHaveBeenCalled();
  });

  it("returns cumulative numbers spanning pre-existing allocations and this run's new matches", async () => {
    // tx-1 already has an allocation from a prior run (3 items).
    // tx-2 is pending and gets matched this run (2 items from the default order()).
    getTransactionsSinceMock.mockResolvedValue([tx({ id: "tx-1" }), tx({ id: "tx-2" })]);
    getAllocatedTransactionMock.mockImplementation(async (id: string) =>
      id === "tx-1"
        ? { ynabTransactionId: "tx-1", items: [{ productId: "p1" }, { productId: "p2" }, { productId: "p3" }] }
        : undefined,
    );
    scrapeMatchedOrdersMock.mockImplementation(async (charges: YnabCharge[]) => ({
      matched: charges.map((c) => ({ order: order(), charges: [c] })),
      unmatched: [],
    }));

    const result = await runBackfill({ fromDate: "2025-01-01" });

    expect(result.transactionsBackfilled).toBe(2); // 1 pre-existing + 1 new
    expect(result.itemsLearned).toBe(5); // 3 pre-existing + 2 new
    expect(result.hasUnbackfilled).toBe(false);
  });

  it("does not call learnFromApproval when no entries were produced", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx()]);
    scrapeMatchedOrdersMock.mockResolvedValue({
      matched: [],
      unmatched: [
        { charge: { ynabTransactionId: "tx-1", date: "2026-04-01", amountCents: 10000, payeeName: "AMAZON.COM", isRefund: false }, reason: "no match" },
      ],
    });

    await runBackfill({ fromDate: "2025-01-01" });
    expect(learnFromApprovalMock).not.toHaveBeenCalled();
  });
});

describe("runBackfill — per-retailer breakdown", () => {
  it("reports matched per retailer", async () => {
    getTransactionsSinceMock.mockResolvedValue([
      tx({ id: "amz-1", payee_name: "AMAZON.COM" }),
      tx({ id: "amz-2", payee_name: "AMAZON.COM" }),
      tx({ id: "tgt-1", payee_name: "TARGET" }),
    ]);
    getRetailerForPayeeMock.mockImplementation((payee: string) => {
      if (/amazon/i.test(payee)) return { retailer: "amazon", strategy: "scrape" };
      if (/target/i.test(payee)) return { retailer: "target", strategy: "scrape" };
      return null;
    });
    // Match only the first charge of each retailer group; the rest stay unmatched.
    scrapeMatchedOrdersMock.mockImplementation(async (charges: YnabCharge[]) => ({
      matched: [{ order: order(), charges: [charges[0]] }],
      unmatched: charges.slice(1).map((c) => ({ charge: c, reason: "no match" })),
    }));

    const result = await runBackfill({ fromDate: "2025-01-01" });

    const byR = Object.fromEntries(result.byRetailer.map((r) => [r.retailer, r]));
    expect(byR.amazon).toMatchObject({ matched: 1 });
    expect(byR.target).toMatchObject({ matched: 1 });
  });

  it("propagates a retailer sign-in wall to byRetailer (so the card prompts to sign in, not 'won't match')", async () => {
    getTransactionsSinceMock.mockResolvedValue([
      tx({ id: "tgt-1", payee_name: "TARGET" }),
      tx({ id: "tgt-2", payee_name: "TARGET" }),
    ]);
    getRetailerForPayeeMock.mockImplementation((payee: string) =>
      /target/i.test(payee) ? { retailer: "target", strategy: "scrape" } : null,
    );
    scrapeMatchedOrdersMock.mockResolvedValue({
      matched: [],
      unmatched: [],
      blocked: { reason: "signed_out", charges: [] },
    });

    const result = await runBackfill({ fromDate: "2025-01-01" });

    const target = result.byRetailer.find((r) => r.retailer === "target");
    expect(target).toMatchObject({ matched: 0, blocked: "signed_out" });
  });

  it("folds pre-existing allocations into a retailer's cumulative matched", async () => {
    getTransactionsSinceMock.mockResolvedValue([
      tx({ id: "amz-1", payee_name: "AMAZON.COM" }),
      tx({ id: "amz-2", payee_name: "AMAZON.COM" }),
    ]);
    getAllocatedTransactionMock.mockImplementation(async (id: string) =>
      id === "amz-1" ? { ynabTransactionId: "amz-1", items: [{ productId: "p1" }] } : undefined,
    );
    scrapeMatchedOrdersMock.mockImplementation(async (charges: YnabCharge[]) => ({
      matched: charges.map((c) => ({ order: order(), charges: [c] })),
      unmatched: [],
    }));

    const result = await runBackfill({ fromDate: "2025-01-01" });

    const amazon = result.byRetailer.find((r) => r.retailer === "amazon");
    expect(amazon).toMatchObject({ matched: 2 }); // 1 pre-existing + 1 new
  });
});

describe("runBackfill — failure handling", () => {
  it("counts the retailer batch as failed when the adapter throws", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ id: "tx-1" }), tx({ id: "tx-2" })]);
    scrapeMatchedOrdersMock.mockRejectedValue(new Error("boom"));

    const result = await runBackfill({ fromDate: "2025-01-01" });

    expect(result.failed).toBe(2);
    expect(result.transactionsBackfilled).toBe(0);
    expect(result.itemsLearned).toBe(0);
  });

  it("counts a charge the adapter couldn't read as failed, not unmatched", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ id: "tx-1" }), tx({ id: "tx-2" })]);
    scrapeMatchedOrdersMock.mockImplementation(async (charges: YnabCharge[]) => ({
      matched: [{ order: order(), charges: [charges[0]] }],
      unmatched: [{ charge: charges[1], reason: READ_FAILED_REASON }],
    }));

    const result = await runBackfill({ fromDate: "2025-01-01" });

    expect(result.failed).toBe(1);
    expect(result.transactionsBackfilled).toBe(1);
    expect(result.hasUnbackfilled).toBe(true);
  });

  it("throws if YNAB credentials are missing", async () => {
    getSettingsMock.mockResolvedValueOnce({ accessToken: null, planId: null });
    await expect(runBackfill({ fromDate: "2025-01-01" })).rejects.toThrow("Not connected to YNAB");
  });
});

describe("runBackfill — abort", () => {
  it("halts before fetching if signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    getTransactionsSinceMock.mockResolvedValue([]);
    await expect(runBackfill({ fromDate: "2025-01-01", signal: ctrl.signal })).rejects.toThrow("aborted");
    expect(scrapeMatchedOrdersMock).not.toHaveBeenCalled();
  });

  it("aborts after the adapter returns if cancel landed during the final scrape", async () => {
    // Adapter doesn't see the abort (cancel came in after its last signal
    // check, mid-final-scrape). It returns normally with matched results.
    // Backfill must catch the late abort before committing.
    getTransactionsSinceMock.mockResolvedValue([tx({ id: "tx-1" })]);
    const ctrl = new AbortController();
    scrapeMatchedOrdersMock.mockImplementation(async (charges: YnabCharge[]) => {
      ctrl.abort();
      return { matched: [{ order: order(), charges: [charges[0]] }], unmatched: [] };
    });

    await expect(runBackfill({ fromDate: "2025-01-01", signal: ctrl.signal })).rejects.toThrow();
    expect(learnFromApprovalMock).not.toHaveBeenCalled();
    expect(putAllocatedTransactionsMock).not.toHaveBeenCalled();
  });

  it("passes signal to the adapter and propagates a mid-scrape abort", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ id: "tx-1" })]);
    const ctrl = new AbortController();
    scrapeMatchedOrdersMock.mockImplementation(
      async (_charges: YnabCharge[], opts?: { signal?: AbortSignal }) => {
        ctrl.abort();
        opts?.signal?.throwIfAborted();
        return { matched: [], unmatched: [] }; // not reached
      },
    );

    await expect(runBackfill({ fromDate: "2025-01-01", signal: ctrl.signal })).rejects.toThrow();
    expect(learnFromApprovalMock).not.toHaveBeenCalled();
  });

  it("halts between retailers when signal aborts mid-run", async () => {
    getTransactionsSinceMock.mockResolvedValue([
      tx({ id: "tx-amz", payee_name: "AMAZON.COM" }),
      tx({ id: "tx-wm", payee_name: "WALMART.COM" }),
    ]);
    getRetailerForPayeeMock.mockImplementation((payee: string) => {
      if (/amazon/i.test(payee)) return { retailer: "amazon", strategy: "scrape" };
      if (/walmart/i.test(payee)) return { retailer: "walmart", strategy: "scrape" };
      return null;
    });
    const ctrl = new AbortController();
    scrapeMatchedOrdersMock.mockImplementationOnce(async (charges: YnabCharge[]) => {
      ctrl.abort();
      return { matched: [{ order: order(), charges: [charges[0]] }], unmatched: [] };
    });

    await expect(runBackfill({ fromDate: "2025-01-01", signal: ctrl.signal })).rejects.toThrow("aborted");
    expect(scrapeMatchedOrdersMock).toHaveBeenCalledTimes(1);
  });
});

describe("runBackfill — progress events", () => {
  it("emits a 'preparing' event before any scraping happens", async () => {
    getTransactionsSinceMock.mockResolvedValue([]);
    const events: import("@/lib/types").BackfillProgress[] = [];
    await runBackfill({
      fromDate: "2025-01-01",
      onProgress: (e) => events.push(e),
    });
    expect(events).toEqual([{ status: "preparing" }]);
  });

  it("forwards the adapter's onScrapeProgress as 'scraping' events", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ id: "tx-1" }), tx({ id: "tx-2" })]);
    scrapeMatchedOrdersMock.mockImplementation(
      async (
        charges: YnabCharge[],
        opts?: { onScrapeProgress?: (e: { index: number; total: number }) => void },
      ) => {
        opts?.onScrapeProgress?.({ index: 1, total: 2 });
        opts?.onScrapeProgress?.({ index: 2, total: 2 });
        return {
          matched: charges.map((c) => ({ order: order(), charges: [c] })),
          unmatched: [],
        };
      },
    );

    const events: import("@/lib/types").BackfillProgress[] = [];
    await runBackfill({
      fromDate: "2025-01-01",
      onProgress: (e) => events.push(e),
    });

    expect(events).toEqual([
      { status: "preparing" },
      { status: "scraping", index: 1, total: 2 },
      { status: "scraping", index: 2, total: 2 },
    ]);
  });

  it("forwards learnFromApproval's progress as 'learning' events", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ id: "tx-1" })]);
    scrapeMatchedOrdersMock.mockImplementation(async (charges: YnabCharge[]) => ({
      matched: charges.map((c) => ({ order: order(), charges: [c] })),
      unmatched: [],
    }));
    // Simulate the chunked progress callback that real learnFromApproval emits.
    learnFromApprovalMock.mockImplementationOnce(
      async (
        _retailer: string,
        entries: readonly { productId: string; title: string; categoryId: string }[],
        onProgress?: (p: { index: number; total: number }) => void,
      ) => {
        onProgress?.({ index: entries.length, total: entries.length });
      },
    );

    const events: import("@/lib/types").BackfillProgress[] = [];
    await runBackfill({
      fromDate: "2025-01-01",
      onProgress: (e) => events.push(e),
    });

    expect(events).toContainEqual({ status: "learning", index: 2, total: 2 });
  });
});
