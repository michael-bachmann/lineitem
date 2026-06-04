import { describe, expect, it } from "vitest";
import { planEviction } from "./embedding-eviction";
import type { ProductEmbedding } from "@/lib/types";

const PER_CATEGORY_CAP = 50;

function row(id: string, categoryId: string, lastSeen: string): ProductEmbedding {
  return {
    id,
    categoryId,
    title: id,
    embedding: new Float32Array(384),
    lastSeen,
  };
}

const NOW = "2026-05-27T00:00:00Z";

describe("planEviction", () => {
  it("no eviction needed when category stays below cap after writes", () => {
    const existing = [
      row("amazon:A", "cat1", "2026-01-01T00:00:00Z"),
      row("amazon:B", "cat1", "2026-01-02T00:00:00Z"),
    ];
    const incoming = [row("amazon:NEW", "cat1", NOW)];
    expect(planEviction(existing, incoming, PER_CATEGORY_CAP).toDelete).toEqual([]);
  });

  it("overwriting an existing id does not evict (count is unchanged)", () => {
    const existing = Array.from({ length: PER_CATEGORY_CAP }, (_, i) =>
      row(`amazon:item${i}`, "cat1", `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
    );
    const incoming = [row("amazon:item5", "cat1", NOW)];
    expect(planEviction(existing, incoming, PER_CATEGORY_CAP).toDelete).toEqual([]);
  });

  it("evicts oldest-by-lastSeen when one new item exceeds cap", () => {
    const existing = Array.from({ length: PER_CATEGORY_CAP }, (_, i) =>
      row(`amazon:item${i}`, "cat1", `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
    );
    const incoming = [row("amazon:NEW", "cat1", NOW)];
    expect(planEviction(existing, incoming, PER_CATEGORY_CAP).toDelete).toEqual(["amazon:item0"]);
  });

  it("evicts N oldest when N new items would push N over cap", () => {
    const existing = Array.from({ length: PER_CATEGORY_CAP }, (_, i) =>
      row(`amazon:item${i}`, "cat1", `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
    );
    const incoming = [
      row("amazon:NEW1", "cat1", NOW),
      row("amazon:NEW2", "cat1", NOW),
      row("amazon:NEW3", "cat1", NOW),
    ];
    expect(planEviction(existing, incoming, PER_CATEGORY_CAP).toDelete).toEqual([
      "amazon:item0",
      "amazon:item1",
      "amazon:item2",
    ]);
  });

  it("ignores rows in other categories when computing overflow", () => {
    const existing = [
      ...Array.from({ length: PER_CATEGORY_CAP }, (_, i) =>
        row(`amazon:other${i}`, "catOther", "2025-01-01T00:00:00Z"),
      ),
      row("amazon:A", "cat1", "2026-01-01T00:00:00Z"),
    ];
    const incoming = [row("amazon:NEW", "cat1", NOW)];
    expect(planEviction(existing, incoming, PER_CATEGORY_CAP).toDelete).toEqual([]);
  });

  it("evicts independently per category when a batch touches several", () => {
    const existing = [
      ...Array.from({ length: PER_CATEGORY_CAP }, (_, i) =>
        row(`amazon:a${i}`, "catA", `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      ),
      ...Array.from({ length: PER_CATEGORY_CAP }, (_, i) =>
        row(`amazon:b${i}`, "catB", `2026-02-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      ),
    ];
    const incoming = [
      row("amazon:newA", "catA", NOW),
      row("amazon:newB", "catB", NOW),
    ];
    expect(planEviction(existing, incoming, PER_CATEGORY_CAP).toDelete).toEqual([
      "amazon:a0",
      "amazon:b0",
    ]);
  });

  it("an overwrite that changes category frees the old category and pressures the new one", () => {
    // catA has 49 rows; catB has 50 rows (at cap).
    // We're moving one existing item from catA to catB:
    //   catA finalCount = 49 - 1 (moved out) = 48 — no pressure
    //   catB finalCount = 50 + 0 (overwrite, count unchanged in catB since the row wasn't in catB yet)
    //   ... wait, the moved row IS new to catB but not new to "existing".
    // For our planner: writeIds includes the moved id, so existingInCat for catB
    // unchanged (50), incomingInCat for catB = 1, overflow = 1 → evict oldest from catB.
    const existing = [
      ...Array.from({ length: 49 }, (_, i) =>
        row(`amazon:a${i}`, "catA", `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      ),
      ...Array.from({ length: PER_CATEGORY_CAP }, (_, i) =>
        row(`amazon:b${i}`, "catB", `2026-02-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      ),
    ];
    const incoming = [row("amazon:a5", "catB", NOW)]; // a5 moves from catA to catB
    expect(planEviction(existing, incoming, PER_CATEGORY_CAP).toDelete).toEqual(["amazon:b0"]);
  });
});
