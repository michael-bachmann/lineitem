import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/background/embedder", () => ({
  embedBatch: vi.fn(async (texts: string[]) => {
    return texts.map(() => {
      const v = new Float32Array(384);
      v[0] = 1;
      return v;
    });
  }),
  getCurrentModelVersion: () => "bge-small-en-v1.5-q8",
}));

const settingsStore = new Map<string, string>();
vi.mock("@/lib/settings", () => ({
  getSettings: vi.fn(async () => ({
    ynabToken: null,
    planId: null,
    planName: null,
    vectorModelVersion: settingsStore.get("vectorModelVersion") ?? null,
  })),
  saveSettings: vi.fn(async (patch: Record<string, string>) => {
    for (const [k, v] of Object.entries(patch)) settingsStore.set(k, v);
  }),
}));

const productCategoryStore = new Map<string, import("@/lib/types").ProductCategory>();
vi.mock("@/lib/db", () => ({
  getAllProductCategories: vi.fn(async () => [...productCategoryStore.values()]),
  putProductCategory: vi.fn(async (r: import("@/lib/types").ProductCategory) => {
    productCategoryStore.set(r.id, r);
  }),
}));

import { migrateEmbeddingsIfNeeded } from "./embedding-migration";

beforeEach(() => {
  productCategoryStore.clear();
  settingsStore.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("migrateEmbeddingsIfNeeded", () => {
  it("no-op when stored version matches current", async () => {
    settingsStore.set("vectorModelVersion", "bge-small-en-v1.5-q8");
    const original = new Float32Array(384);
    productCategoryStore.set("amazon:A", {
      id: "amazon:A",
      categoryId: "cat1",
      confirmedByUser: true,
      timesSeen: 1,
      lastSeen: "2026-01-01",
      title: "Paper towels",
      embedding: original,
      embeddedAt: "2026-01-01",
    });
    await migrateEmbeddingsIfNeeded();
    expect(productCategoryStore.get("amazon:A")?.embedding).toBe(original); // not rewritten
  });

  it("re-embeds all rows when version mismatches", async () => {
    settingsStore.set("vectorModelVersion", "old-version");
    productCategoryStore.set("amazon:A", {
      id: "amazon:A",
      categoryId: "cat1",
      confirmedByUser: true,
      timesSeen: 1,
      lastSeen: "2026-01-01",
      title: "Paper towels",
      embedding: new Float32Array(384), // zeros — stand-in for "stale"
      embeddedAt: "2026-01-01",
    });
    await migrateEmbeddingsIfNeeded();
    expect(productCategoryStore.get("amazon:A")?.embedding?.[0]).toBe(1);
    expect(settingsStore.get("vectorModelVersion")).toBe("bge-small-en-v1.5-q8");
  });

  it("first-run (no stored version) re-embeds and sets the stamp", async () => {
    productCategoryStore.set("amazon:A", {
      id: "amazon:A",
      categoryId: "cat1",
      confirmedByUser: true,
      timesSeen: 1,
      lastSeen: "2026-01-01",
      title: "Paper towels",
    });
    await migrateEmbeddingsIfNeeded();
    expect(productCategoryStore.get("amazon:A")?.embedding).toBeDefined();
    expect(settingsStore.get("vectorModelVersion")).toBe("bge-small-en-v1.5-q8");
  });

  it("skips rows without a title (defensive against legacy rows)", async () => {
    settingsStore.set("vectorModelVersion", "old");
    productCategoryStore.set("amazon:legacy", {
      id: "amazon:legacy",
      categoryId: "cat1",
      confirmedByUser: true,
      timesSeen: 1,
      lastSeen: "2026-01-01",
    });
    await migrateEmbeddingsIfNeeded();
    expect(productCategoryStore.get("amazon:legacy")?.embedding).toBeUndefined();
    // Stamp still updated even though nothing to migrate:
    expect(settingsStore.get("vectorModelVersion")).toBe("bge-small-en-v1.5-q8");
  });

  it("processes rows in batches", async () => {
    settingsStore.set("vectorModelVersion", "old");
    // Seed 20 rows; batch size is 16, so we expect 2 calls.
    for (let i = 0; i < 20; i++) {
      productCategoryStore.set(`amazon:item${i}`, {
        id: `amazon:item${i}`,
        categoryId: "cat1",
        confirmedByUser: true,
        timesSeen: 1,
        lastSeen: "2026-01-01",
        title: `Title ${i}`,
      });
    }
    const { embedBatch } = await import("@/background/embedder");
    await migrateEmbeddingsIfNeeded();
    expect(embedBatch).toHaveBeenCalledTimes(2);
  });
});
