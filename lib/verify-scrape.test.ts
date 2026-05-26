import { describe, expect, it } from "vitest";
import { verifyScrape } from "./verify-scrape";
import type { ScrapedOrder, ScrapedItem } from "./types";

function makeItem(productId: string, unitPriceCents: number, quantity = 1): ScrapedItem {
  return { productId, title: productId, imageUrl: "", unitPriceCents, quantity };
}

function makeOrder(overrides: Partial<ScrapedOrder> = {}): ScrapedOrder {
  return {
    retailer: "amazon",
    orderId: "111-test",
    items: [],
    displayedItemsSubtotalCents: 0,
    scrapedAt: "2026-05-25T12:00:00Z",
    ...overrides,
  };
}

describe("verifyScrape", () => {
  it("returns ok when sum exactly matches subtotal", () => {
    const order = makeOrder({
      items: [makeItem("A", 1500), makeItem("B", 2500, 2)],
      displayedItemsSubtotalCents: 6500,
    });
    expect(verifyScrape(order)).toEqual({ ok: true });
  });

  it("returns ok when sum is exactly 1 cent off (tolerance boundary)", () => {
    const order = makeOrder({
      items: [makeItem("A", 1000)],
      displayedItemsSubtotalCents: 1001,
    });
    expect(verifyScrape(order)).toEqual({ ok: true });
  });

  it("returns failure when sum is 2 cents off (beyond tolerance)", () => {
    const order = makeOrder({
      items: [makeItem("A", 1000)],
      displayedItemsSubtotalCents: 1002,
    });
    const result = verifyScrape(order);
    expect(result.ok).toBe(false);
  });

  it("returns failure when items array is empty but subtotal is non-zero", () => {
    const order = makeOrder({ items: [], displayedItemsSubtotalCents: 500 });
    const result = verifyScrape(order);
    expect(result.ok).toBe(false);
  });

  it("handles items with quantity > 1", () => {
    const order = makeOrder({
      items: [makeItem("A", 250, 4)],
      displayedItemsSubtotalCents: 1000,
    });
    expect(verifyScrape(order)).toEqual({ ok: true });
  });

  it("failure message includes both dollar amounts so the user can verify against Amazon", () => {
    const order = makeOrder({
      items: [makeItem("A", 9750)],
      displayedItemsSubtotalCents: 10999,
    });
    const result = verifyScrape(order);
    if (result.ok) throw new Error("expected failure result");
    expect(result.message).toContain("$97.50");
    expect(result.message).toContain("$109.99");
  });
});
