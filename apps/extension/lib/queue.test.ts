import { describe, expect, it } from "vitest";
import { entryStatus, isFullyClassified, nextReviewableEntry } from "./queue";
import type { ClassifiedItem, OrderMatchStatus, QueueEntry } from "./types";

function entry(matchStatus: OrderMatchStatus, id = ""): QueueEntry {
  return {
    ynabTransaction: { id } as QueueEntry["ynabTransaction"],
    retailer: "amazon",
    matchStatus,
  };
}

const item = (id: string | null) => ({ suggestedCategoryId: id }) as ClassifiedItem;

describe("entryStatus", () => {
  it("maps the non-matched statuses", () => {
    expect(entryStatus(entry({ status: "no_match" })).status).toBe("nomatch");
    expect(entryStatus(entry({ status: "auth_required" })).status).toBe("auth");
    expect(entryStatus(entry({ status: "error", message: "x" })).status).toBe("error");
  });

  it("matched with every item categorized → classified", () => {
    const e = entry({
      status: "matched",
      order: {} as Extract<OrderMatchStatus, { status: "matched" }>["order"],
      classifiedItems: [item("a"), item("b")],
    });
    expect(entryStatus(e)).toEqual({ status: "classified", needs: 0 });
    expect(isFullyClassified(e)).toBe(true);
  });

  it("matched with some uncategorized → partial with a needs count", () => {
    const e = entry({
      status: "matched",
      order: {} as Extract<OrderMatchStatus, { status: "matched" }>["order"],
      classifiedItems: [item("a"), item(null), item(null)],
    });
    expect(entryStatus(e)).toEqual({ status: "partial", needs: 2 });
    expect(isFullyClassified(e)).toBe(false);
  });
});

describe("nextReviewableEntry", () => {
  const order = {} as Extract<OrderMatchStatus, { status: "matched" }>["order"];
  const partial = (id: string) =>
    entry({ status: "matched", order, classifiedItems: [item("a"), item(null)] }, id);
  const classified = (id: string) =>
    entry({ status: "matched", order, classifiedItems: [item("a")] }, id);

  const idOf = (e: QueueEntry | null) => e?.ynabTransaction.id ?? null;

  it("advances to the next needs-review entry in queue order", () => {
    const queue = [partial("p1"), partial("p2"), classified("c1")];
    expect(idOf(nextReviewableEntry(queue, "p1"))).toBe("p2");
  });

  it("moves into ready-to-approve once needs-review is exhausted", () => {
    const queue = [partial("p1"), classified("c1")];
    expect(idOf(nextReviewableEntry(queue, "p1"))).toBe("c1");
  });

  it("lists needs-review before ready-to-approve regardless of queue order", () => {
    const queue = [classified("c1"), partial("p1"), partial("p2")];
    expect(idOf(nextReviewableEntry(queue, "p1"))).toBe("p2");
    // Approving the last entry in display order wraps to the top.
    expect(idOf(nextReviewableEntry(queue, "c1"))).toBe("p1");
  });

  it("skips non-matched entries", () => {
    const queue = [partial("p1"), entry({ status: "no_match" }, "x1"), classified("c1")];
    expect(idOf(nextReviewableEntry(queue, "p1"))).toBe("c1");
  });

  it("returns null when nothing reviewable remains", () => {
    expect(nextReviewableEntry([partial("p1")], "p1")).toBeNull();
    expect(nextReviewableEntry([entry({ status: "no_match" }, "x1")], "p1")).toBeNull();
    expect(nextReviewableEntry([], "p1")).toBeNull();
  });

  it("falls back to the first reviewable entry when the approved id is gone", () => {
    const queue = [classified("c1"), partial("p1")];
    expect(idOf(nextReviewableEntry(queue, "removed"))).toBe("p1");
  });
});
