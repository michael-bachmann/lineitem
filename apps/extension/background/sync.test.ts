import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSettingsMock,
  getUnapprovedTransactionsMock,
  getAllocatedTransactionMock,
  putAllocatedTransactionsMock,
  getRetailerForPayeeMock,
  getAdapterMock,
  classifyItemsMock,
  distributeOrderMock,
  verifyScrapeMock,
  scrapeMock,
} = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
  getUnapprovedTransactionsMock: vi.fn(),
  getAllocatedTransactionMock: vi.fn(),
  putAllocatedTransactionsMock: vi.fn(async () => {}),
  getRetailerForPayeeMock: vi.fn(),
  getAdapterMock: vi.fn(),
  classifyItemsMock: vi.fn(),
  distributeOrderMock: vi.fn(),
  verifyScrapeMock: vi.fn(),
  scrapeMock: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({ getSettings: getSettingsMock }));
vi.mock("@/lib/ynab", () => ({ getUnapprovedTransactions: getUnapprovedTransactionsMock }));
vi.mock("@/lib/db", () => ({
  getAllocatedTransaction: getAllocatedTransactionMock,
  putAllocatedTransactions: putAllocatedTransactionsMock,
}));
vi.mock("@/lib/registry", () => ({ getRetailerForPayee: getRetailerForPayeeMock }));
vi.mock("@/retailers/registry", () => ({ getAdapter: getAdapterMock }));
vi.mock("@/lib/classifier", () => ({ classifyItems: classifyItemsMock }));
vi.mock("@/lib/distribution", () => ({ distributeOrder: distributeOrderMock }));
vi.mock("@/lib/verify-scrape", () => ({ verifyScrape: verifyScrapeMock }));

import { performSync } from "./sync";
import type { YnabCharge, YnabTransaction } from "@/lib/types";

function tx(over: Partial<YnabTransaction> = {}): YnabTransaction {
  return {
    id: "tx-1",
    date: "2026-04-01",
    amount: -10000,
    payee_name: "AMAZON.COM",
    category_id: null,
    category_name: null,
    approved: false,
    subtransactions: [],
    ...over,
  };
}

function charge(ynabTransactionId: string): YnabCharge {
  return { ynabTransactionId, date: "2026-04-01", amountCents: 10000, payeeName: "AMAZON.COM", isRefund: false };
}

beforeEach(() => {
  getSettingsMock.mockResolvedValue({ accessToken: "tok", planId: "plan" });
  getAllocatedTransactionMock.mockResolvedValue(undefined); // nothing cached → needs scraping
  putAllocatedTransactionsMock.mockClear();
  classifyItemsMock.mockResolvedValue([]);
  verifyScrapeMock.mockReturnValue({ ok: true });
  distributeOrderMock.mockReturnValue({ allocated: [], failures: [] });
  scrapeMock.mockReset();
  getRetailerForPayeeMock.mockImplementation((p: string) =>
    /amazon/i.test(p) ? { retailer: "amazon", strategy: "scrape" } : null,
  );
  getAdapterMock.mockReturnValue({ id: "amazon", payees: [], startUrl: "", scrapeMatchedOrders: scrapeMock });
});

describe("performSync — sign-in walls", () => {
  it("maps a signed_out block to auth_required queue entries plus a blocked summary", async () => {
    getUnapprovedTransactionsMock.mockResolvedValue([tx({ id: "tx-1" }), tx({ id: "tx-2" })]);
    scrapeMock.mockResolvedValue({
      matched: [],
      unmatched: [],
      blocked: { reason: "signed_out", charges: [charge("tx-1"), charge("tx-2")] },
    });

    const result = await performSync();

    if (!("queue" in result)) throw new Error(`expected a queue, got ${JSON.stringify(result)}`);
    expect(result.blocked).toEqual([{ retailer: "amazon", reason: "signed_out", count: 2 }]);
    expect(result.queue).toHaveLength(2);
    expect(result.queue.every((e) => e.matchStatus.status === "auth_required")).toBe(true);
  });

  it("surfaces a mid-walk step_up block (with its gated URL) while keeping matched results out of the block", async () => {
    getUnapprovedTransactionsMock.mockResolvedValue([tx({ id: "tx-1" }), tx({ id: "tx-2" })]);
    const gatedUrl = "https://www.target.com/orders/123/invoices";
    scrapeMock.mockResolvedValue({
      matched: [],
      unmatched: [],
      blocked: { reason: "step_up", charges: [charge("tx-2")], url: gatedUrl },
    });

    const result = await performSync();

    if (!("queue" in result)) throw new Error("expected a queue");
    // The gated URL rides along so the ResolutionCard's "Open" lands on the
    // challenge page, not the soft-tier orders list.
    expect(result.blocked).toEqual([
      { retailer: "amazon", reason: "step_up", count: 1, url: gatedUrl },
    ]);
    const authEntries = result.queue.filter((e) => e.matchStatus.status === "auth_required");
    expect(authEntries.map((e) => e.ynabTransaction.id)).toEqual(["tx-2"]);
  });

  it("omits `blocked` entirely when no retailer hit a wall", async () => {
    getUnapprovedTransactionsMock.mockResolvedValue([tx({ id: "tx-1" })]);
    scrapeMock.mockResolvedValue({
      matched: [],
      unmatched: [{ charge: charge("tx-1"), reason: "No matching order" }],
    });

    const result = await performSync();

    if (!("queue" in result)) throw new Error("expected a queue");
    expect(result.blocked).toBeUndefined();
  });
});

describe("performSync — per-retailer isolation", () => {
  it("a retailer whose adapter throws becomes retryable error entries; other retailers and the fast-path cache survive", async () => {
    getUnapprovedTransactionsMock.mockResolvedValue([
      tx({ id: "tx-1", payee_name: "AMAZON.COM" }), // amazon → adapter throws
      tx({ id: "tx-2", payee_name: "TARGET" }), // target → scrapes fine
      tx({ id: "tx-3", payee_name: "AMAZON.COM" }), // amazon → already cached (fast path)
    ]);
    getRetailerForPayeeMock.mockImplementation((p: string) =>
      /amazon/i.test(p) ? { retailer: "amazon", strategy: "scrape" }
        : /target/i.test(p) ? { retailer: "target", strategy: "scrape" }
        : null,
    );

    // tx-3 is cached, so it takes the fast path and never reaches the scrape loop.
    const cached = {
      ynabTransactionId: "tx-3", orderKey: "amazon:O", retailer: "amazon",
      date: "2026-04-01", amountCents: 10000, isRefund: false, items: [],
    };
    getAllocatedTransactionMock.mockImplementation(async (id: string) =>
      id === "tx-3" ? cached : undefined,
    );

    const amazonThrows = vi.fn(async () => {
      throw new Error("Tab 7 content script not ready within 15s");
    });
    const targetScrape = vi.fn(async () => ({
      matched: [],
      unmatched: [{ charge: charge("tx-2"), reason: "No matching order found" }],
    }));
    getAdapterMock.mockImplementation((id: string) =>
      id === "amazon"
        ? { id: "amazon", payees: [], startUrl: "", scrapeMatchedOrders: amazonThrows }
        : { id: "target", payees: [], startUrl: "", scrapeMatchedOrders: targetScrape },
    );

    const result = await performSync();

    // The whole sync did NOT collapse to a bare { error } — the throw stayed local.
    expect("error" in result).toBe(false);
    if (!("queue" in result)) throw new Error(`expected a queue, got ${JSON.stringify(result)}`);
    // Exactly one entry per transaction — no charge double-counted into both the
    // error entries and elsewhere.
    expect(result.queue).toHaveLength(3);
    const byId = (id: string) => result.queue.find((e) => e.ynabTransaction.id === id);

    // The Amazon throw is isolated to its own charge as a retryable error,
    // carrying the thrown message — it does not fail the whole sync.
    expect(byId("tx-1")?.matchStatus).toEqual({
      status: "error",
      message: "Tab 7 content script not ready within 15s",
    });
    // Target still ran and produced its no_match entry.
    expect(byId("tx-2")?.matchStatus.status).toBe("no_match");
    // The fast-path cached transaction survived the sibling retailer's failure.
    expect(byId("tx-3")?.matchStatus.status).toBe("matched");
  });
});

describe("performSync — scrape → verify → distribute", () => {
  it("persists and classifies an order that verifies and distributes into a matched entry", async () => {
    getUnapprovedTransactionsMock.mockResolvedValue([tx({ id: "tx-1" })]);
    const order = { retailer: "amazon", orderId: "O1", items: [], displayedItemsSubtotalCents: 10000 };
    scrapeMock.mockResolvedValue({
      matched: [{ order, charges: [charge("tx-1")] }],
      unmatched: [],
    });
    const allocation = {
      ynabTransactionId: "tx-1", orderKey: "amazon:O1", retailer: "amazon",
      date: "2026-04-01", amountCents: 10000, isRefund: false, items: [],
    };
    distributeOrderMock.mockReturnValue({ allocated: [allocation], failures: [] });

    const result = await performSync();

    if (!("queue" in result)) throw new Error(`expected a queue, got ${JSON.stringify(result)}`);
    expect(putAllocatedTransactionsMock).toHaveBeenCalledWith([allocation]);
    const entry = result.queue.find((e) => e.ynabTransaction.id === "tx-1");
    expect(entry?.matchStatus).toEqual({ status: "matched", order: allocation, classifiedItems: [] });
  });

  it("surfaces a verification failure as an error entry and persists nothing", async () => {
    getUnapprovedTransactionsMock.mockResolvedValue([tx({ id: "tx-1" })]);
    const order = { retailer: "amazon", orderId: "O1", items: [], displayedItemsSubtotalCents: 10000 };
    scrapeMock.mockResolvedValue({
      matched: [{ order, charges: [charge("tx-1")] }],
      unmatched: [],
    });
    verifyScrapeMock.mockReturnValue({ ok: false, message: "Items don't reconcile to the subtotal" });
    distributeOrderMock.mockClear(); // shared mock — drop call history from prior tests

    const result = await performSync();

    if (!("queue" in result)) throw new Error("expected a queue");
    expect(result.queue.find((e) => e.ynabTransaction.id === "tx-1")?.matchStatus).toEqual({
      status: "error",
      message: "Items don't reconcile to the subtotal",
    });
    // A failed verification never reaches distribution/persistence.
    expect(distributeOrderMock).not.toHaveBeenCalled();
    expect(putAllocatedTransactionsMock).toHaveBeenCalledWith([]);
  });
});
