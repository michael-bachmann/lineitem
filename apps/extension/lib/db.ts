import type {
  AllocatedTransaction,
  Category,
  LearnedProduct,
  ProductEmbedding,
} from "./types";

const DB_NAME = "lineitem";
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;

      if (event.oldVersion < 1) {
        // allocatedTransactions: primary key = ynabTransactionId, secondary index = orderKey
        const txStore = db.createObjectStore("allocatedTransactions", { keyPath: "ynabTransactionId" });
        txStore.createIndex("orderKey", "orderKey", { unique: false });

        // learnedProducts: forever-row exact-match cache (id → categoryId).
        db.createObjectStore("learnedProducts", { keyPath: "id" });

        // productEmbeddings: bounded embedding pool, evicted oldest-first.
        db.createObjectStore("productEmbeddings", { keyPath: "id" });

        db.createObjectStore("categories", { keyPath: "id" });
      }

      if (event.oldVersion < 2) {
        // v2 — plan-scoped learning: embeddings gain a planId index so
        // classify reads only the connected plan's pool. Rows written before
        // v2 have no planId field, which keeps them out of the index until
        // adoptLegacyLearnedData rewrites them on startup.
        request
          .transaction!.objectStore("productEmbeddings")
          .createIndex("planId", "planId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

async function getStore(
  storeName: string,
  mode: IDBTransactionMode = "readonly",
): Promise<IDBObjectStore> {
  const db = await openDB();
  return db.transaction(storeName, mode).objectStore(storeName);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Allocated Transactions (primary key: ynabTransactionId) ---

export async function getAllocatedTransaction(
  ynabTransactionId: string,
): Promise<AllocatedTransaction | undefined> {
  const store = await getStore("allocatedTransactions");
  return requestToPromise(store.get(ynabTransactionId));
}

/** Atomic batch put — all-or-nothing for an entire sync's allocated transactions. */
export async function putAllocatedTransactions(
  transactions: AllocatedTransaction[],
): Promise<void> {
  if (transactions.length === 0) return;
  const db = await openDB();
  const tx = db.transaction("allocatedTransactions", "readwrite");
  const store = tx.objectStore("allocatedTransactions");
  for (const at of transactions) {
    store.put(at);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Learned Products (forever-row cache) ---

/** Storage key for a learned row. Plan-scoped so the same product learned on
 *  two plans never collides — categoryId only exists in the plan it was
 *  learned on. */
export function learnedKey(planId: string, retailer: string, productId: string): string {
  return `${planId}:${retailer}:${productId}`;
}

export async function getLearnedProduct(id: string): Promise<LearnedProduct | undefined> {
  const store = await getStore("learnedProducts");
  return requestToPromise(store.get(id));
}

export async function putLearnedProduct(entry: LearnedProduct): Promise<void> {
  const store = await getStore("learnedProducts", "readwrite");
  await requestToPromise(store.put(entry));
}

// --- Product Embeddings (capped similarity pool) ---

/** The connected plan's embedding pool only — other plans' rows stay dormant
 *  until the user switches back. */
export async function getAllProductEmbeddings(planId: string): Promise<ProductEmbedding[]> {
  const store = await getStore("productEmbeddings");
  return requestToPromise(store.index("planId").getAll(planId));
}

export async function putProductEmbedding(entry: ProductEmbedding): Promise<void> {
  const store = await getStore("productEmbeddings", "readwrite");
  await requestToPromise(store.put(entry));
}

export async function deleteProductEmbedding(id: string): Promise<void> {
  const store = await getStore("productEmbeddings", "readwrite");
  await requestToPromise(store.delete(id));
}

/** A learning-store row as it may exist on disk: rows written before plan
 *  scoping (DB v1) have no planId and a "{retailer}:{productId}" id. */
type MaybeLegacyRow = { id: string; planId?: string };

/**
 * Adopt pre-plan-scoping learning rows into `planId`. Before v2, switching
 * plans cleared these stores, so every unscoped row was necessarily learned
 * on the plan connected at upgrade time. Idempotent — adopted rows carry a
 * planId and are skipped on later runs. Per-store transactions (not atomic
 * across stores): a partial run heals on the next startup.
 */
export async function adoptLegacyLearnedData(planId: string): Promise<void> {
  await adoptStore("learnedProducts", planId);
  await adoptStore("productEmbeddings", planId);
}

async function adoptStore(
  name: "learnedProducts" | "productEmbeddings",
  planId: string,
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(name, "readwrite");
  const store = tx.objectStore(name);
  const rows = await requestToPromise<MaybeLegacyRow[]>(store.getAll());
  for (const row of rows.filter((r) => r.planId === undefined)) {
    store.delete(row.id);
    store.put({ ...row, planId, id: `${planId}:${row.id}` });
  }
  return transactionDone(tx);
}

// --- Categories ---

export async function getAllCategories(): Promise<Category[]> {
  const store = await getStore("categories");
  return requestToPromise(store.getAll());
}

/** Replace all categories atomically. */
export async function putCategories(categories: Category[]): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("categories", "readwrite");
  const store = tx.objectStore("categories");
  store.clear();
  for (const cat of categories) {
    store.put(cat);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
