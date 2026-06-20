import { describe, expect, it } from "vitest";
import { entryStatus, isFullyClassified } from "./queue";
import type { ClassifiedItem, OrderMatchStatus, QueueEntry } from "./types";

function entry(matchStatus: OrderMatchStatus): QueueEntry {
  return {
    ynabTransaction: {} as QueueEntry["ynabTransaction"],
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
