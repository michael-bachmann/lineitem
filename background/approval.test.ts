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
  })),
}));

// In-memory mock of the db layer:
const learnedStore = new Map<string, import("@/lib/types").LearnedProduct>();
const embeddingStore = new Map<string, import("@/lib/types").ProductEmbedding>();
const allocatedStore = new Map<string, import("@/lib/types").AllocatedTransaction>();

vi.mock("@/lib/db", () => ({
  getLearnedProduct: vi.fn(async (id: string) => learnedStore.get(id)),
  putLearnedProduct: vi.fn(async (r: import("@/lib/types").LearnedProduct) => {
    learnedStore.set(r.id, r);
  }),
  getAllProductEmbeddings: vi.fn(async () => [...embeddingStore.values()]),
  putProductEmbedding: vi.fn(async (r: import("@/lib/types").ProductEmbedding) => {
    embeddingStore.set(r.id, r);
  }),
  deleteProductEmbedding: vi.fn(async (id: string) => {
    embeddingStore.delete(id);
  }),
  getAllocatedTransaction: vi.fn(async (id: string) => allocatedStore.get(id)),
}));

import { approveTransaction, buildSubtransactions, learnFromApproval } from "./approval";
import type { AllocatedTransaction, ApprovalItem } from "@/lib/types";

beforeEach(() => {
  learnedStore.clear();
  embeddingStore.clear();
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
    isRefund: false,
    items: [],
    ...overrides,
  };
}

describe("buildSubtransactions", () => {
  it("emits one subtransaction per category, summing amounts within a group", () => {
    const tx = makeTx({
      amountCents: 5000,
      items: [
        { productId: "A", title: "Apple", imageUrl: "", unitPriceCents: 1000, quantity: 1, refundedAmountCents: 0, allocatedCents: 1000 },
        { productId: "B", title: "Bread", imageUrl: "", unitPriceCents: 2000, quantity: 1, refundedAmountCents: 0, allocatedCents: 2000 },
        { productId: "C", title: "Wine",  imageUrl: "", unitPriceCents: 2000, quantity: 1, refundedAmountCents: 0, allocatedCents: 2000 },
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
        { productId: "A", title: "Apple", imageUrl: "", unitPriceCents: 500, quantity: 1, refundedAmountCents: 0, allocatedCents: 500 },
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
      refundedAmountCents: 0,
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
      refundedAmountCents: 0,
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

describe("learnFromApproval writes both stores", () => {
  it("writes a LearnedProduct cache row and a ProductEmbedding pool row per item", async () => {
    const tx: AllocatedTransaction = {
      ynabTransactionId: "txn-1", orderKey: "amazon:O1", retailer: "amazon",
      date: "2026-05-20", amountCents: 5000, isRefund: false,
      items: [
        { productId: "A", title: "Paper towels", imageUrl: "", unitPriceCents: 2500, quantity: 1, refundedAmountCents: 0, allocatedCents: 2500 },
        { productId: "B", title: "Trash bags",  imageUrl: "", unitPriceCents: 2500, quantity: 1, refundedAmountCents: 0, allocatedCents: 2500 },
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

    // Cache rows: just id + categoryId.
    expect(learnedStore.get("amazon:A")).toEqual({ id: "amazon:A", categoryId: "cat-household" });
    expect(learnedStore.get("amazon:B")).toEqual({ id: "amazon:B", categoryId: "cat-household" });

    // Embedding rows: id, categoryId, title, embedding, lastSeen.
    const embA = embeddingStore.get("amazon:A");
    expect(embA).toMatchObject({
      id: "amazon:A",
      categoryId: "cat-household",
      title: "Paper towels",
    });
    expect(embA?.embedding).toBeInstanceOf(Float32Array);
    expect(embA?.embedding.length).toBe(384);
    expect(embA?.lastSeen).toEqual(expect.any(String));
  });

  it("still writes the cache row when embedBatch throws; skips the embedding row", async () => {
    embedBatchMock.mockRejectedValueOnce(new Error("model not ready"));

    const tx: AllocatedTransaction = {
      ynabTransactionId: "txn-2", orderKey: "amazon:O2", retailer: "amazon",
      date: "2026-05-20", amountCents: 1000, isRefund: false,
      items: [
        { productId: "X", title: "Lightbulb", imageUrl: "", unitPriceCents: 1000, quantity: 1, refundedAmountCents: 0, allocatedCents: 1000 },
      ],
    };
    allocatedStore.set("txn-2", tx);

    const result = await approveTransaction("txn-2", [{ productId: "X", categoryId: "cat-household" }]);
    expect(result).toEqual({ ok: true });

    expect(learnedStore.get("amazon:X")).toEqual({ id: "amazon:X", categoryId: "cat-household" });
    expect(embeddingStore.get("amazon:X")).toBeUndefined();
  });

  it("overwrites the cache row when a product is re-approved with a different category", async () => {
    learnedStore.set("amazon:Y", { id: "amazon:Y", categoryId: "cat-old" });

    const tx: AllocatedTransaction = {
      ynabTransactionId: "txn-3", orderKey: "amazon:O3", retailer: "amazon",
      date: "2026-05-20", amountCents: 100, isRefund: false,
      items: [
        { productId: "Y", title: "Repeat", imageUrl: "", unitPriceCents: 100, quantity: 1, refundedAmountCents: 0, allocatedCents: 100 },
      ],
    };
    allocatedStore.set("txn-3", tx);

    await approveTransaction("txn-3", [{ productId: "Y", categoryId: "cat-new" }]);
    expect(learnedStore.get("amazon:Y")?.categoryId).toBe("cat-new");
  });

  it("emits a single progress event when entries fit in one embedding chunk", async () => {
    const entries = [
      { productId: "A", title: "Apple", categoryId: "cat-1" },
      { productId: "B", title: "Bread", categoryId: "cat-1" },
    ];
    const events: { index: number; total: number }[] = [];
    await learnFromApproval("amazon", entries, (e) => events.push(e));
    expect(events).toEqual([{ index: 2, total: 2 }]);
  });

  it("emits progress at chunk boundaries for batches larger than the chunk size", async () => {
    // 60 entries with chunk size 25 → events at 25, 50, 60.
    const entries = Array.from({ length: 60 }, (_, i) => ({
      productId: `P${i}`,
      title: `Item ${i}`,
      categoryId: "cat-1",
    }));
    const events: { index: number; total: number }[] = [];
    await learnFromApproval("amazon", entries, (e) => events.push(e));
    expect(events).toEqual([
      { index: 25, total: 60 },
      { index: 50, total: 60 },
      { index: 60, total: 60 },
    ]);
    // The cumulative final index always equals total — drives 100% in the UI.
    expect(events.at(-1)?.index).toBe(60);
  });

  it("evicts the oldest embedding in a category when writing would exceed cap=50 (cache rows untouched)", async () => {
    // Seed exactly 50 embeddings in cat-household with increasing lastSeen.
    // Also seed their matching cache rows.
    for (let i = 0; i < 50; i++) {
      const id = `amazon:seed${i}`;
      learnedStore.set(id, { id, categoryId: "cat-household" });
      embeddingStore.set(id, {
        id,
        categoryId: "cat-household",
        title: `seed${i}`,
        embedding: new Float32Array(384),
        lastSeen: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      });
    }
    const tx: AllocatedTransaction = {
      ynabTransactionId: "txn-4", orderKey: "amazon:O4", retailer: "amazon",
      date: "2026-05-20", amountCents: 100, isRefund: false,
      items: [
        { productId: "NEW", title: "New thing", imageUrl: "", unitPriceCents: 100, quantity: 1, refundedAmountCents: 0, allocatedCents: 100 },
      ],
    };
    allocatedStore.set("txn-4", tx);

    await approveTransaction("txn-4", [{ productId: "NEW", categoryId: "cat-household" }]);

    // Embedding for seed0 is gone, NEW's embedding is in.
    expect(embeddingStore.get("amazon:seed0")).toBeUndefined();
    expect(embeddingStore.get("amazon:NEW")).toBeDefined();
    const embeddingsInCat = [...embeddingStore.values()].filter((r) => r.categoryId === "cat-household");
    expect(embeddingsInCat).toHaveLength(50);

    // But the cache row for seed0 survives the embedding eviction.
    expect(learnedStore.get("amazon:seed0")).toEqual({ id: "amazon:seed0", categoryId: "cat-household" });
  });
});
