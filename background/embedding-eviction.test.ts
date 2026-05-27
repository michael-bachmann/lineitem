import { describe, expect, it } from "vitest";
import { planEviction } from "./embedding-eviction";
import type { ProductCategory } from "@/lib/types";

const PER_CATEGORY_CAP = 50;

function row(id: string, categoryId: string, lastSeen: string): ProductCategory {
  return {
    id,
    categoryId,
    confirmedByUser: true,
    timesSeen: 1,
    lastSeen,
    title: id,
  };
}

describe("planEviction", () => {
  it("no eviction needed when category is below cap", () => {
    const existing = [
      row("amazon:A", "cat1", "2026-01-01T00:00:00Z"),
      row("amazon:B", "cat1", "2026-01-02T00:00:00Z"),
    ];
    const result = planEviction(existing, "cat1", "amazon:NEW", PER_CATEGORY_CAP);
    expect(result.toDelete).toEqual([]);
  });

  it("overwriting an existing (retailer, productId) does not evict", () => {
    const existing = Array.from({ length: PER_CATEGORY_CAP }, (_, i) =>
      row(`amazon:item${i}`, "cat1", `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
    );
    const result = planEviction(existing, "cat1", "amazon:item5", PER_CATEGORY_CAP);
    expect(result.toDelete).toEqual([]);
  });

  it("evicts oldest-by-lastSeen when new item would exceed cap", () => {
    const existing = Array.from({ length: PER_CATEGORY_CAP }, (_, i) =>
      row(`amazon:item${i}`, "cat1", `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
    );
    const result = planEviction(existing, "cat1", "amazon:NEW", PER_CATEGORY_CAP);
    expect(result.toDelete).toEqual(["amazon:item0"]);
  });

  it("ignores rows in other categories when computing cap", () => {
    const existing = [
      ...Array.from({ length: PER_CATEGORY_CAP }, (_, i) => row(`amazon:other${i}`, "catOther", "2025-01-01T00:00:00Z")),
      row("amazon:A", "cat1", "2026-01-01T00:00:00Z"),
    ];
    const result = planEviction(existing, "cat1", "amazon:NEW", PER_CATEGORY_CAP);
    expect(result.toDelete).toEqual([]);
  });
});
