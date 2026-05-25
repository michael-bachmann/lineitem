import { describe, expect, it } from "vitest";
import { buildSubtransactions } from "./approval";
import type { AllocatedTransaction, ApprovalItem } from "@/lib/types";

function makeTx(overrides: Partial<AllocatedTransaction> = {}): AllocatedTransaction {
  return {
    ynabTransactionId: "txn-1",
    orderKey: "amazon:111-2222222-3333333",
    retailer: "amazon",
    date: "2026-05-20",
    amountCents: 10000,
    cardLastFour: "1234",
    isRefund: false,
    scrapedAt: "2026-05-20T12:00:00Z",
    items: [],
    ...overrides,
  };
}

describe("buildSubtransactions", () => {
  it("emits one subtransaction per category, summing amounts within a group", () => {
    const tx = makeTx({
      amountCents: 5000,
      items: [
        { productId: "A", title: "Apple", imageUrl: "", unitPriceCents: 1000, quantity: 1, allocatedCents: 1000 },
        { productId: "B", title: "Bread", imageUrl: "", unitPriceCents: 2000, quantity: 1, allocatedCents: 2000 },
        { productId: "C", title: "Wine",  imageUrl: "", unitPriceCents: 2000, quantity: 1, allocatedCents: 2000 },
      ],
    });
    const choices: ApprovalItem[] = [
      { productId: "A", categoryId: "cat-groceries" },
      { productId: "B", categoryId: "cat-groceries" },
      { productId: "C", categoryId: "cat-alcohol" },
    ];

    const result = buildSubtransactions(tx, choices);

    expect(result).toHaveLength(2);
    const groceries = result.find((r) => r.category_id === "cat-groceries");
    const alcohol = result.find((r) => r.category_id === "cat-alcohol");
    expect(groceries).toEqual({
      amount: -30000,
      category_id: "cat-groceries",
      memo: "Apple, Bread",
    });
    expect(alcohol).toEqual({
      amount: -20000,
      category_id: "cat-alcohol",
      memo: "Wine",
    });
  });

  it("uses positive amounts for refunds", () => {
    const tx = makeTx({
      isRefund: true,
      items: [
        { productId: "A", title: "Apple", imageUrl: "", unitPriceCents: 500, quantity: 1, allocatedCents: 500 },
      ],
    });
    const result = buildSubtransactions(tx, [
      { productId: "A", categoryId: "cat-groceries" },
    ]);
    expect(result).toEqual([
      { amount: 5000, category_id: "cat-groceries", memo: "Apple" },
    ]);
  });

  it("emits '+N more' suffix when a group has more than 3 items", () => {
    const items = ["Apple", "Bread", "Carrots", "Donut", "Egg"].map((title, i) => ({
      productId: `P${i}`,
      title,
      imageUrl: "",
      unitPriceCents: 100,
      quantity: 1,
      allocatedCents: 100,
    }));
    const tx = makeTx({ items });
    const choices: ApprovalItem[] = items.map((it) => ({
      productId: it.productId,
      categoryId: "cat-groceries",
    }));

    const [sub] = buildSubtransactions(tx, choices);
    expect(sub.memo).toBe("Apple, Bread, Carrots +2 more");
  });

  it("represents uncategorized items as a single group with null category_id", () => {
    const tx = makeTx({
      items: [
        { productId: "A", title: "Mystery", imageUrl: "", unitPriceCents: 500, quantity: 1, allocatedCents: 500 },
      ],
    });
    const result = buildSubtransactions(tx, [
      // No choice for productId "A" — falls through to null
    ]);
    expect(result).toEqual([
      { amount: -5000, category_id: null, memo: "Mystery" },
    ]);
  });

  it("truncates memo to YNAB's 200-character limit", () => {
    const longTitle = "X".repeat(120);
    const items = [longTitle, longTitle, longTitle, "extra1", "extra2"].map((title, i) => ({
      productId: `P${i}`,
      title,
      imageUrl: "",
      unitPriceCents: 100,
      quantity: 1,
      allocatedCents: 100,
    }));
    const tx = makeTx({ items });
    const choices: ApprovalItem[] = items.map((it) => ({
      productId: it.productId,
      categoryId: "cat-groceries",
    }));

    const [sub] = buildSubtransactions(tx, choices);
    expect(sub.memo!.length).toBeLessThanOrEqual(200);
    expect(sub.memo!.endsWith("+2 more")).toBe(true);
  });
});
