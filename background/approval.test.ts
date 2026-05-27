import { beforeEach, describe, expect, it, vi } from "vitest";

const { embedBatchMock } = vi.hoisted(() => ({
  embedBatchMock: vi.fn(async (texts: string[]) => {
    return texts.map((_, i) => {
      const v = new Float32Array(384);
      v[i % 384] = 1;
      return v;
    });
  }),
}));

vi.mock("@/background/embedder", () => ({
  embedBatch: embedBatchMock,
  embed: vi.fn(),
  ensureModelLoaded: vi.fn(async () => {}),
  getCurrentModelVersion: () => "bge-small-en-v1.5-q8",
}));

// Mock the YNAB update so approveTransaction's external call is a no-op:
vi.mock("@/lib/ynab", () => ({
  updateTransaction: vi.fn(async () => ({ ok: true })),
  getPlans: vi.fn(),
  getCategories: vi.fn(),
}));

// Mock settings to bypass the "Not connected" guard:
vi.mock("@/lib/settings", () => ({
  getSettings: vi.fn(async () => ({
    ynabToken: "fake-token",
    planId: "fake-plan",
    planName: null,
    vectorModelVersion: "bge-small-en-v1.5-q8",
  })),
}));

// In-memory mock of the db layer:
const productCategoryStore = new Map<string, import("@/lib/types").ProductCategory>();
const allocatedStore = new Map<string, import("@/lib/types").AllocatedTransaction>();

vi.mock("@/lib/db", () => ({
  getProductCategory: vi.fn(async (id: string) => productCategoryStore.get(id)),
  putProductCategory: vi.fn(async (r: import("@/lib/types").ProductCategory) => {
    productCategoryStore.set(r.id, r);
  }),
  getAllProductCategories: vi.fn(async () => [...productCategoryStore.values()]),
  deleteProductCategory: vi.fn(async (id: string) => {
    productCategoryStore.delete(id);
  }),
  getAllocatedTransaction: vi.fn(async (id: string) => allocatedStore.get(id)),
}));

import { approveTransaction, buildSubtransactions } from "./approval";
import type { AllocatedTransaction, ApprovalItem } from "@/lib/types";

beforeEach(() => {
  productCategoryStore.clear();
  allocatedStore.clear();
  embedBatchMock.mockClear();
});

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

describe("learnFromApproval writes embeddings", () => {
  it("writes title + embedding + embeddedAt on each approved item", async () => {
    const tx: AllocatedTransaction = {
      ynabTransactionId: "txn-1", orderKey: "amazon:O1", retailer: "amazon",
      date: "2026-05-20", amountCents: 5000, cardLastFour: "1234", isRefund: false,
      scrapedAt: "2026-05-20T12:00:00Z",
      items: [
        { productId: "A", title: "Paper towels", imageUrl: "", unitPriceCents: 2500, quantity: 1, allocatedCents: 2500 },
        { productId: "B", title: "Trash bags",  imageUrl: "", unitPriceCents: 2500, quantity: 1, allocatedCents: 2500 },
      ],
    };
    allocatedStore.set("txn-1", tx);

    const choices: ApprovalItem[] = [
      { productId: "A", categoryId: "cat-household" },
      { productId: "B", categoryId: "cat-household" },
    ];
    const result = await approveTransaction("txn-1", choices);
    expect(result).toEqual({ ok: true });

    expect(embedBatchMock).toHaveBeenCalledWith(["Paper towels", "Trash bags"]);

    const rowA = productCategoryStore.get("amazon:A");
    expect(rowA).toMatchObject({
      id: "amazon:A",
      categoryId: "cat-household",
      title: "Paper towels",
      confirmedByUser: true,
      timesSeen: 1,
    });
    expect(rowA?.embedding).toBeInstanceOf(Float32Array);
    expect(rowA?.embedding?.length).toBe(384);
    expect(rowA?.embeddedAt).toEqual(expect.any(String));
  });

  it("falls back to writing the row without embedding fields when embedBatch throws", async () => {
    embedBatchMock.mockRejectedValueOnce(new Error("model not ready"));

    const tx: AllocatedTransaction = {
      ynabTransactionId: "txn-2", orderKey: "amazon:O2", retailer: "amazon",
      date: "2026-05-20", amountCents: 1000, cardLastFour: "1234", isRefund: false,
      scrapedAt: "2026-05-20T12:00:00Z",
      items: [
        { productId: "X", title: "Lightbulb", imageUrl: "", unitPriceCents: 1000, quantity: 1, allocatedCents: 1000 },
      ],
    };
    allocatedStore.set("txn-2", tx);

    const result = await approveTransaction("txn-2", [{ productId: "X", categoryId: "cat-household" }]);
    expect(result).toEqual({ ok: true });

    const row = productCategoryStore.get("amazon:X");
    expect(row).toMatchObject({ id: "amazon:X", title: "Lightbulb", categoryId: "cat-household" });
    expect(row?.embedding).toBeUndefined();
    expect(row?.embeddedAt).toBeUndefined();
  });

  it("increments timesSeen on overwrite", async () => {
    productCategoryStore.set("amazon:Y", {
      id: "amazon:Y", categoryId: "cat-old", confirmedByUser: true,
      timesSeen: 3, lastSeen: "2026-01-01T00:00:00Z",
    });

    const tx: AllocatedTransaction = {
      ynabTransactionId: "txn-3", orderKey: "amazon:O3", retailer: "amazon",
      date: "2026-05-20", amountCents: 100, cardLastFour: "1234", isRefund: false,
      scrapedAt: "2026-05-20T12:00:00Z",
      items: [
        { productId: "Y", title: "Repeat", imageUrl: "", unitPriceCents: 100, quantity: 1, allocatedCents: 100 },
      ],
    };
    allocatedStore.set("txn-3", tx);

    await approveTransaction("txn-3", [{ productId: "Y", categoryId: "cat-new" }]);
    expect(productCategoryStore.get("amazon:Y")?.timesSeen).toBe(4);
    expect(productCategoryStore.get("amazon:Y")?.categoryId).toBe("cat-new");
  });

  it("evicts the oldest row in a category when writing would exceed cap=50", async () => {
    // Seed exactly 50 rows in cat-household with increasing lastSeen.
    for (let i = 0; i < 50; i++) {
      productCategoryStore.set(`amazon:seed${i}`, {
        id: `amazon:seed${i}`,
        categoryId: "cat-household",
        confirmedByUser: true,
        timesSeen: 1,
        lastSeen: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        title: `seed${i}`,
      });
    }
    const tx: AllocatedTransaction = {
      ynabTransactionId: "txn-4", orderKey: "amazon:O4", retailer: "amazon",
      date: "2026-05-20", amountCents: 100, cardLastFour: "1234", isRefund: false,
      scrapedAt: "2026-05-20T12:00:00Z",
      items: [
        { productId: "NEW", title: "New thing", imageUrl: "", unitPriceCents: 100, quantity: 1, allocatedCents: 100 },
      ],
    };
    allocatedStore.set("txn-4", tx);

    await approveTransaction("txn-4", [{ productId: "NEW", categoryId: "cat-household" }]);

    // Oldest seed (seed0, lastSeen 2026-01-01) should be evicted.
    expect(productCategoryStore.get("amazon:seed0")).toBeUndefined();
    expect(productCategoryStore.get("amazon:NEW")).toBeDefined();
    // Count in category should remain at 50.
    const inCat = [...productCategoryStore.values()].filter((r) => r.categoryId === "cat-household");
    expect(inCat).toHaveLength(50);
  });
});
