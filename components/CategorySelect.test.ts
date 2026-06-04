import { describe, expect, it } from "vitest";
import { groupCategories } from "./CategorySelect";
import type { Category } from "@/lib/types";

const cats: Category[] = [
  { id: "1", name: "Groceries", groupName: "Frequent" },
  { id: "2", name: "Dining Out", groupName: "Frequent" },
  { id: "3", name: "Rent", groupName: "Monthly" },
];

describe("groupCategories", () => {
  it("groups by groupName, preserving first-seen order", () => {
    const g = groupCategories(cats, "");
    expect(g.map((x) => x.group)).toEqual(["Frequent", "Monthly"]);
    expect(g[0].items.map((c) => c.name)).toEqual(["Groceries", "Dining Out"]);
  });

  it("filters by name case-insensitively and drops now-empty groups", () => {
    const g = groupCategories(cats, "REN");
    expect(g).toHaveLength(1);
    expect(g[0].group).toBe("Monthly");
    expect(g[0].items[0].name).toBe("Rent");
  });

  it("matches on substring, not just prefix", () => {
    const g = groupCategories(cats, "out");
    expect(g.flatMap((x) => x.items).map((c) => c.name)).toEqual(["Dining Out"]);
  });

  it("treats a whitespace-only query as empty (returns everything)", () => {
    expect(groupCategories(cats, "   ")).toHaveLength(2);
  });

  it("returns an empty array when nothing matches", () => {
    expect(groupCategories(cats, "zzz")).toEqual([]);
  });
});
