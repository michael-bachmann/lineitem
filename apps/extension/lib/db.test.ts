import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import "fake-indexeddb/auto";

/**
 * Runs against a real (in-memory) IndexedDB — the point is the v1→v2 schema
 * migration and legacy-row adoption, which mocks can't exercise. beforeEach
 * swaps in a fresh IDBFactory; freshDb only resets the module cache (db.ts
 * caches its open connection at module scope), so anything seeded into the
 * current factory — e.g. a v1 database — is what the fresh module opens.
 */
async function freshDb() {
  vi.resetModules();
  return import("./db");
}

/** Create the database at v1 (pre-plan-scoping schema) and seed unscoped
 *  learning rows, exactly as an existing install would have on disk. */
function seedV1(rows: { id: string; categoryId: string; title?: string }[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("lineitem", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const txStore = db.createObjectStore("allocatedTransactions", { keyPath: "ynabTransactionId" });
      txStore.createIndex("orderKey", "orderKey", { unique: false });
      db.createObjectStore("learnedProducts", { keyPath: "id" });
      db.createObjectStore("productEmbeddings", { keyPath: "id" });
      db.createObjectStore("categories", { keyPath: "id" });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(["learnedProducts", "productEmbeddings"], "readwrite");
      for (const row of rows) {
        tx.objectStore("learnedProducts").put({ id: row.id, categoryId: row.categoryId });
        if (row.title !== undefined) {
          tx.objectStore("productEmbeddings").put({
            id: row.id,
            categoryId: row.categoryId,
            title: row.title,
            embedding: new Float32Array([1, 0, 0]),
            lastSeen: "2026-01-01T00:00:00Z",
          });
        }
      }
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  });
}

beforeEach(() => {
  indexedDB = new IDBFactory();
});

describe("learnedKey", () => {
  it("builds the plan-scoped storage key", async () => {
    const db = await freshDb();
    expect(db.learnedKey("plan-a", "amazon", "B0XXXX")).toBe("plan-a:amazon:B0XXXX");
  });
});

describe("v1 → v2 migration", () => {
  it("opens a v1 database and keeps its rows, invisible to plan-scoped reads until adopted", async () => {
    await seedV1([{ id: "amazon:A", categoryId: "cat-1", title: "Paper towels" }]);
    const db = await freshDb();

    // The legacy row survives the upgrade under its old key…
    expect(await db.getLearnedProduct("amazon:A")).toEqual({
      id: "amazon:A",
      categoryId: "cat-1",
    });
    // …but has no planId, so it's a cache miss for scoped reads and absent
    // from the planId index — a missed suggestion, never a wrong one.
    expect(await db.getLearnedProduct(db.learnedKey("plan-a", "amazon", "A"))).toBeUndefined();
    expect(await db.getAllProductEmbeddings("plan-a")).toEqual([]);
  });
});

describe("adoptLegacyLearnedData", () => {
  it("rewrites unscoped rows into the given plan in both stores", async () => {
    await seedV1([
      { id: "amazon:A", categoryId: "cat-1", title: "Paper towels" },
      { id: "target:B", categoryId: "cat-2" }, // cache row without an embedding
    ]);
    const db = await freshDb();

    await db.adoptLegacyLearnedData("plan-a");

    expect(await db.getLearnedProduct("amazon:A")).toBeUndefined();
    expect(await db.getLearnedProduct("plan-a:amazon:A")).toEqual({
      id: "plan-a:amazon:A",
      planId: "plan-a",
      categoryId: "cat-1",
    });
    expect(await db.getLearnedProduct("plan-a:target:B")).toMatchObject({
      planId: "plan-a",
      categoryId: "cat-2",
    });

    const pool = await db.getAllProductEmbeddings("plan-a");
    expect(pool).toHaveLength(1);
    expect(pool[0]).toMatchObject({
      id: "plan-a:amazon:A",
      planId: "plan-a",
      title: "Paper towels",
    });
  });

  it("is idempotent and leaves already-scoped rows (any plan) untouched", async () => {
    await seedV1([{ id: "amazon:A", categoryId: "cat-1", title: "Paper towels" }]);
    const db = await freshDb();
    await db.putLearnedProduct({ id: "plan-b:amazon:A", planId: "plan-b", categoryId: "cat-b" });

    await db.adoptLegacyLearnedData("plan-a");
    await db.adoptLegacyLearnedData("plan-a");

    expect(await db.getLearnedProduct("plan-a:amazon:A")).toMatchObject({ planId: "plan-a" });
    expect(await db.getLearnedProduct("plan-b:amazon:A")).toEqual({
      id: "plan-b:amazon:A",
      planId: "plan-b",
      categoryId: "cat-b",
    });
    // Double adoption didn't duplicate or re-prefix anything.
    expect(await db.getLearnedProduct("plan-a:plan-a:amazon:A")).toBeUndefined();
  });
});

describe("plan-scoped reads and writes", () => {
  it("getAllProductEmbeddings returns only the requested plan's pool", async () => {
    const db = await freshDb();
    const embedding = new Float32Array([0, 1, 0]);
    await db.putProductEmbedding({
      id: "plan-a:amazon:A",
      planId: "plan-a",
      categoryId: "cat-1",
      title: "A",
      embedding,
      lastSeen: "2026-01-01T00:00:00Z",
    });
    await db.putProductEmbedding({
      id: "plan-b:amazon:A",
      planId: "plan-b",
      categoryId: "cat-9",
      title: "A on the other plan",
      embedding,
      lastSeen: "2026-01-01T00:00:00Z",
    });

    const pool = await db.getAllProductEmbeddings("plan-a");
    expect(pool.map((r) => r.id)).toEqual(["plan-a:amazon:A"]);
  });

  it("round-trips a learned product under its plan-scoped key", async () => {
    const db = await freshDb();
    const id = db.learnedKey("plan-a", "amazon", "B0XXXX");
    await db.putLearnedProduct({ id, planId: "plan-a", categoryId: "cat-1" });
    expect(await db.getLearnedProduct(id)).toEqual({ id, planId: "plan-a", categoryId: "cat-1" });
  });
});
