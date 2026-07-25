import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { embedMock } = vi.hoisted(() => ({ embedMock: vi.fn() }));
vi.mock("@/background/embedder", () => ({
  embed: embedMock,
  embedBatch: vi.fn(),
  ensureModelLoaded: vi.fn(async () => {}),
}));

const learnedStore = new Map<string, import("./types").LearnedProduct>();
const embeddingStore = new Map<string, import("./types").ProductEmbedding>();
vi.mock("./db", () => ({
  learnedKey: (planId: string, retailer: string, productId: string) =>
    `${planId}:${retailer}:${productId}`,
  getLearnedProduct: vi.fn(async (id: string) => learnedStore.get(id)),
  getAllProductEmbeddings: vi.fn(async (planId: string) =>
    [...embeddingStore.values()].filter((r) => r.planId === planId),
  ),
}));

import { classifyItem } from "./classifier";

const PLAN = "plan-a";

// cos_sim normalizes internally, so test fixtures don't need to be unit-length.
function vec(values: number[]): Float32Array {
  return new Float32Array(values);
}

/** Seed a learned-product cache row under a plan. If `vec` is provided, also
 *  seed an embedding for it. */
function seed(
  rows: Array<{ id: string; categoryId: string; title: string; vec?: Float32Array; planId?: string }>,
) {
  for (const r of rows) {
    const planId = r.planId ?? PLAN;
    const id = `${planId}:${r.id}`;
    learnedStore.set(id, { id, planId, categoryId: r.categoryId });
    if (r.vec) {
      embeddingStore.set(id, {
        id,
        planId,
        categoryId: r.categoryId,
        title: r.title,
        embedding: r.vec,
        lastSeen: "2026-01-01",
      });
    }
  }
}

beforeEach(() => {
  learnedStore.clear();
  embeddingStore.clear();
  embedMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("classifyItem cascade", () => {
  it("returns product_cache hit when productId matches", async () => {
    seed([{ id: "amazon:A", categoryId: "cat1", title: "Paper towels", vec: vec([1, 0, 0]) }]);
    const result = await classifyItem({ productId: "A", title: "Paper towels" }, "amazon", PLAN);
    expect(result.source).toBe("product_cache");
    expect(result.categoryId).toBe("cat1");
    // embed should not have been called — cache hit short-circuits.
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("falls through to embedding tier when cache misses; returns suggestion above threshold", async () => {
    seed([
      { id: "amazon:OLD", categoryId: "household", title: "Old paper towels", vec: vec([1, 0.05, 0]) },
      { id: "amazon:OTHER", categoryId: "groceries", title: "Bread", vec: vec([0, 0, 1]) },
    ]);
    embedMock.mockResolvedValueOnce(vec([1, 0, 0]));

    const result = await classifyItem({ productId: "NEW", title: "New paper towels" }, "amazon", PLAN);
    expect(result.source).toBe("embedding");
    expect(result.categoryId).toBe("household");
    expect(result.matchedSource?.title).toBe("Old paper towels");
  });

  it("returns null when best cosine is below threshold", async () => {
    seed([{ id: "amazon:X", categoryId: "household", title: "X", vec: vec([0, 1, 0]) }]);
    embedMock.mockResolvedValueOnce(vec([1, 0, 0])); // orthogonal → cosine 0

    const result = await classifyItem({ productId: "Q", title: "Q" }, "amazon", PLAN);
    expect(result.source).toBeNull();
    expect(result.categoryId).toBeNull();
  });

  it("returns null without invoking the embedder when the pool is empty", async () => {
    seed([{ id: "amazon:legacy", categoryId: "household", title: "Legacy" }]); // cache row, no vec

    const result = await classifyItem({ productId: "Q", title: "Q" }, "amazon", PLAN);
    expect(result.source).toBeNull();
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("degrades to null on embedder failure (does not throw)", async () => {
    seed([{ id: "amazon:OLD", categoryId: "household", title: "Old", vec: vec([1, 0, 0]) }]);
    embedMock.mockRejectedValueOnce(new Error("embed failed"));

    const result = await classifyItem({ productId: "NEW", title: "New" }, "amazon", PLAN);
    expect(result.source).toBeNull();
    expect(result.categoryId).toBeNull();
  });

  it("never suggests from another plan's learned rows", async () => {
    // Same product and an identical embedding, but learned on plan-b: its
    // category ids don't exist on plan-a, so both tiers must miss.
    seed([
      { id: "amazon:A", categoryId: "cat-b", title: "Paper towels", vec: vec([1, 0, 0]), planId: "plan-b" },
    ]);
    embedMock.mockResolvedValueOnce(vec([1, 0, 0]));

    const result = await classifyItem({ productId: "A", title: "Paper towels" }, "amazon", PLAN);
    expect(result.source).toBeNull();
    expect(result.categoryId).toBeNull();
  });
});
