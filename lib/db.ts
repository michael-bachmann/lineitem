import type {
  AllocatedTransaction,
  Category,
  LearnedProduct,
  ProductEmbedding,
} from "./types";

const DB_NAME = "lineitem";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;

      // allocatedTransactions: primary key = ynabTransactionId, secondary index = orderKey
      const txStore = db.createObjectStore("allocatedTransactions", { keyPath: "ynabTransactionId" });
      txStore.createIndex("orderKey", "orderKey", { unique: false });

      // learnedProducts: forever-row exact-match cache (id → categoryId).
      db.createObjectStore("learnedProducts", { keyPath: "id" });

      // productEmbeddings: bounded embedding pool, evicted oldest-first.
      db.createObjectStore("productEmbeddings", { keyPath: "id" });

      db.createObjectStore("categories", { keyPath: "id" });
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

export async function getLearnedProduct(id: string): Promise<LearnedProduct | undefined> {
  const store = await getStore("learnedProducts");
  return requestToPromise(store.get(id));
}

export async function putLearnedProduct(entry: LearnedProduct): Promise<void> {
  const store = await getStore("learnedProducts", "readwrite");
  await requestToPromise(store.put(entry));
}

// --- Product Embeddings (capped similarity pool) ---

export async function getAllProductEmbeddings(): Promise<ProductEmbedding[]> {
  const store = await getStore("productEmbeddings");
  return requestToPromise(store.getAll());
}

export async function putProductEmbedding(entry: ProductEmbedding): Promise<void> {
  const store = await getStore("productEmbeddings", "readwrite");
  await requestToPromise(store.put(entry));
}

export async function deleteProductEmbedding(id: string): Promise<void> {
  const store = await getStore("productEmbeddings", "readwrite");
  await requestToPromise(store.delete(id));
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
