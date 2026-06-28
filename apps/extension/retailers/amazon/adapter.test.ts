import { describe, expect, it, vi, beforeEach } from "vitest";
import type { YnabCharge } from "@/lib/types";
import type { AmazonPageResult } from "./page";

// The walk drives the page through @/background/tabs; mock it so we can script a
// sequence of page results and assert how the adapter coordinates them.
const { openRetailerTab, awaitPageResult } = vi.hoisted(() => ({
  openRetailerTab: vi.fn(),
  awaitPageResult: vi.fn(),
}));
vi.mock("@/background/tabs", () => ({
  openRetailerTab,
  awaitPageResult,
  clearBufferedPageResult: vi.fn(),
}));

import { amazonAdapter } from "./adapter";

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

const charge = (o: Partial<YnabCharge> = {}): YnabCharge => ({
  ynabTransactionId: "tx1",
  date: "2026-06-01",
  amountCents: 1000,
  payeeName: "AMAZON",
  isRefund: false,
  ...o,
});

/** Return the queued page results in order, one per awaitPageResult call. */
function queueResults(...results: AmazonPageResult[]) {
  const q = [...results];
  awaitPageResult.mockImplementation(async () => q.shift());
}

const txRow = (orderId: string, o: Partial<{ date: string; amountCents: number }> = {}) => ({
  date: o.date ?? "2026-06-01",
  amountCents: o.amountCents ?? 1000,
  orderId,
  isRefund: false,
});

const item = () => ({
  productId: "B0X",
  title: "Widget",
  priceCents: 1000,
  quantity: 1,
  imageUrl: "img",
  refundedAmountCents: 0,
});

describe("amazonAdapter.scrapeMatchedOrders", () => {
  it("returns a signed_out block when the transactions list shows login", async () => {
    queueResults({ pageKind: "login" });
    const c = charge();
    const res = await amazonAdapter.scrapeMatchedOrders([c]);
    expect(res.matched).toEqual([]);
    expect(res.blocked).toEqual({ reason: "signed_out", charges: [c] });
  });

  it("matches a charge to its order-linked row and scrapes the order detail", async () => {
    const c = charge({ amountCents: 1000, date: "2026-06-01" });
    queueResults(
      { pageKind: "transactions", fingerprint: "p1", hasNext: false, transactions: [txRow("111-A")] },
      {
        pageKind: "order-summary",
        orderId: "111-A",
        subtotalCents: 1000,
        requiresItemmod: false,
        items: [item()],
        refund: null,
      },
    );
    const res = await amazonAdapter.scrapeMatchedOrders([c]);
    expect(res.matched).toHaveLength(1);
    expect(res.matched[0].order.orderId).toBe("111-A");
    expect(res.matched[0].order.items[0].unitPriceCents).toBe(1000);
    expect(res.matched[0].charges).toEqual([c]);
    expect(res.unmatched).toEqual([]);
  });

  it("navigates to the itemmod page for a grocery order whose summary defers its items", async () => {
    // A grocery order's order-details page carries the subtotal but no inline
    // items (requiresItemmod: true); the items live on the itemmod page. This is
    // a real, current Amazon Fresh layout — the itemmod hop is NOT dead code.
    const c = charge({ amountCents: 549 });
    queueResults(
      { pageKind: "transactions", fingerprint: "p1", hasNext: false, transactions: [txRow("111-G", { amountCents: 549 })] },
      { pageKind: "order-summary", orderId: "111-G", subtotalCents: 549, requiresItemmod: true, items: [], refund: null },
      { pageKind: "itemmod", orderId: "111-G", items: [item()], refund: null },
    );

    const res = await amazonAdapter.scrapeMatchedOrders([c]);

    // Items came from the itemmod page (the summary deferred them), proving the
    // adapter made the second navigation.
    expect(res.matched).toHaveLength(1);
    expect(res.matched[0].order.items).toHaveLength(1);
    expect(awaitPageResult).toHaveBeenCalledTimes(3); // transactions → summary → itemmod
    const navUrls = (browser.tabs.update as ReturnType<typeof vi.fn>).mock.calls.map((a) => a[1]?.url);
    expect(navUrls.some((u: string) => u?.includes("page=itemmod"))).toBe(true);
  });

  it("keeps partial matches and blocks the rest when a detail page hits login mid-walk", async () => {
    const c = charge();
    queueResults(
      { pageKind: "transactions", fingerprint: "p1", hasNext: false, transactions: [txRow("111-A")] },
      { pageKind: "login" }, // the order-detail navigation landed on a sign-in wall
    );
    const res = await amazonAdapter.scrapeMatchedOrders([c]);
    expect(res.matched).toEqual([]);
    expect(res.blocked?.reason).toBe("signed_out");
    expect(res.blocked?.charges).toEqual([c]);
  });

  it("reports a charge with no order-linked row as unmatched (no_match)", async () => {
    const c = charge({ amountCents: 9999 }); // no row matches this amount
    queueResults({
      pageKind: "transactions",
      fingerprint: "p1",
      hasNext: false,
      transactions: [txRow("111-A", { amountCents: 1000 })],
    });
    const res = await amazonAdapter.scrapeMatchedOrders([c]);
    expect(res.matched).toEqual([]);
    expect(res.unmatched).toHaveLength(1);
    expect(res.unmatched[0].charge).toEqual(c);
  });

  it("retries a detail page whose first read is unverifiable (no subtotal), then succeeds", async () => {
    const c = charge();
    const summary = (subtotalCents: number | null): AmazonPageResult => ({
      pageKind: "order-summary",
      orderId: "111-A",
      subtotalCents,
      requiresItemmod: false,
      items: subtotalCents === null ? [] : [item()],
      refund: null,
    });
    queueResults(
      { pageKind: "transactions", fingerprint: "p1", hasNext: false, transactions: [txRow("111-A")] },
      summary(null), // first detail read: subtotal not rendered → unverifiable → retry
      summary(1000), // retry: clean read
    );
    const res = await amazonAdapter.scrapeMatchedOrders([c]);
    expect(res.matched).toHaveLength(1);
    expect(res.matched[0].order.orderId).toBe("111-A");
    expect(res.unmatched).toEqual([]);
  });

  it("keeps partial results (no throw) when a page-result await times out mid-pagination", async () => {
    const c = charge();
    // The very first transactions read never arrives — awaitPageResult rejects.
    awaitPageResult.mockRejectedValue(new Error("Tab 1 produced no matching page result within 30s"));
    const res = await amazonAdapter.scrapeMatchedOrders([c]);
    expect(res.matched).toEqual([]);
    expect(res.unmatched).toHaveLength(1); // surfaced as no_match, not a crash
    expect(res.blocked).toBeUndefined();
  });

  it("aborts mid-walk on an aborted signal and still cleans up the tab", async () => {
    const c = charge();
    const remove = vi.fn(async () => {});
    vi.stubGlobal("browser", {
      tabs: { update: vi.fn(async () => {}), sendMessage: vi.fn(async () => {}), remove },
    });
    queueResults({
      pageKind: "transactions",
      fingerprint: "p1",
      hasNext: false,
      transactions: [txRow("111-A")],
    });
    await expect(
      amazonAdapter.scrapeMatchedOrders([c], { signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(remove).toHaveBeenCalledWith(1); // finally-block cleanup ran
  });
});
