import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSettingsMock,
  getTransactionsSinceMock,
  getAllocatedTransactionMock,
  getRetailerForPayeeMock,
  scrapeMatchedOrdersMock,
  getAdapterMock,
  learnFromApprovalMock,
} = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  getTransactionsSinceMock: vi.fn(),
  getAllocatedTransactionMock: vi.fn(),
  getRetailerForPayeeMock: vi.fn(),
  scrapeMatchedOrdersMock: vi.fn(),
  getAdapterMock: vi.fn(),
  learnFromApprovalMock: vi.fn(
    async (_retailer: string, _entries: readonly { productId: string; title: string; categoryId: string }[]) => {},
  ),
}));

vi.mock("@/lib/settings", () => ({ getSettings: getSettingsMock }));
vi.mock("@/lib/ynab", () => ({ getTransactionsSince: getTransactionsSinceMock }));
vi.mock("@/lib/db", () => ({ getAllocatedTransaction: getAllocatedTransactionMock }));
vi.mock("@/lib/registry", () => ({ getRetailerForPayee: getRetailerForPayeeMock }));
vi.mock("@/retailers/registry", () => ({ getAdapter: getAdapterMock }));
vi.mock("./approval", () => ({ learnFromApproval: learnFromApprovalMock }));

import { runBackfill } from "./backfill";
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
      { productId: "A1", title: "Paper towels", imageUrl: "", unitPriceCents: 500, quantity: 1 },
      { productId: "A2", title: "Trash bags", imageUrl: "", unitPriceCents: 500, quantity: 1 },
    ],
    displayedItemsSubtotalCents: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  getSettingsMock.mockResolvedValue({ ynabToken: "tok", planId: "plan" });
  getAllocatedTransactionMock.mockResolvedValue(undefined);
  getTransactionsSinceMock.mockReset();
  getRetailerForPayeeMock.mockReset();
  scrapeMatchedOrdersMock.mockReset();
  learnFromApprovalMock.mockReset();
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
    expect(result.total).toBe(0);
    expect(scrapeMatchedOrdersMock).not.toHaveBeenCalled();
  });

  it("skips uncategorized transactions", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ category_id: null })]);
    const result = await runBackfill({ fromDate: "2025-01-01" });
    expect(result.total).toBe(0);
  });

  it("skips transactions with subtransactions", async () => {
    getTransactionsSinceMock.mockResolvedValue([
      tx({ subtransactions: [{ amount: -5000, category_id: "c", memo: null }] }),
    ]);
    const result = await runBackfill({ fromDate: "2025-01-01" });
    expect(result.total).toBe(0);
  });

  it("skips refund / inflow transactions", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ amount: 5000 })]);
    const result = await runBackfill({ fromDate: "2025-01-01" });
    expect(result.total).toBe(0);
  });

  it("skips payees that don't map to a scrape-strategy retailer", async () => {
    getRetailerForPayeeMock.mockReturnValue(null);
    getTransactionsSinceMock.mockResolvedValue([tx({ payee_name: "Mystery Cafe" })]);
    const result = await runBackfill({ fromDate: "2025-01-01" });
    expect(result.total).toBe(0);
  });

  it("skips skip-strategy payees (e.g. Amazon Prime)", async () => {
    getRetailerForPayeeMock.mockReturnValue({ retailer: "amazon", strategy: "skip" });
    getTransactionsSinceMock.mockResolvedValue([tx({ payee_name: "Amazon Prime" })]);
    const result = await runBackfill({ fromDate: "2025-01-01" });
    expect(result.total).toBe(0);
  });

  it("skips transactions already in the AllocatedTransaction store", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx()]);
    getAllocatedTransactionMock.mockResolvedValue({ ynabTransactionId: "tx-1" });
    const result = await runBackfill({ fromDate: "2025-01-01" });
    expect(result.total).toBe(0);
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

    expect(result.matched).toBe(2);
    expect(result.itemsWritten).toBe(4);
    expect(result.unmatched).toBe(0);
    expect(result.failed).toBe(0);
    expect(learnFromApprovalMock).toHaveBeenCalledTimes(1);
    const [retailerArg, entriesArg] = learnFromApprovalMock.mock.calls[0];
    expect(retailerArg).toBe("amazon");
    expect(entriesArg).toHaveLength(4);
    expect(entriesArg.every((e: { categoryId: string }) => e.categoryId === "cat-groceries")).toBe(true);
  });

  it("counts adapter-unmatched charges in the unmatched total", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ id: "tx-1" }), tx({ id: "tx-2" })]);
    scrapeMatchedOrdersMock.mockImplementation(async (charges: YnabCharge[]) => ({
      matched: [{ order: order(), charges: [charges[0]] }],
      unmatched: [{ charge: charges[1], reason: "no match" }],
    }));

    const result = await runBackfill({ fromDate: "2025-01-01" });

    expect(result.matched).toBe(1);
    expect(result.unmatched).toBe(1);
    expect(result.itemsWritten).toBe(2);
  });

  it("counts multi-charge orders as unmatched (ambiguous category)", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ id: "tx-1" }), tx({ id: "tx-2" })]);
    scrapeMatchedOrdersMock.mockImplementation(async (charges: YnabCharge[]) => ({
      matched: [{ order: order(), charges }],
      unmatched: [],
    }));

    const result = await runBackfill({ fromDate: "2025-01-01" });

    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(2);
    expect(result.itemsWritten).toBe(0);
    expect(learnFromApprovalMock).not.toHaveBeenCalled();
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

describe("runBackfill — failure handling", () => {
  it("counts the retailer batch as failed when the adapter throws", async () => {
    getTransactionsSinceMock.mockResolvedValue([tx({ id: "tx-1" }), tx({ id: "tx-2" })]);
    scrapeMatchedOrdersMock.mockRejectedValue(new Error("boom"));

    const result = await runBackfill({ fromDate: "2025-01-01" });

    expect(result.failed).toBe(2);
    expect(result.matched).toBe(0);
    expect(result.itemsWritten).toBe(0);
  });

  it("throws if YNAB credentials are missing", async () => {
    getSettingsMock.mockResolvedValueOnce({ ynabToken: null, planId: null });
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
});
