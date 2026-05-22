import type { Transaction, ProductCacheEntry, Category } from "./types";

const DB_NAME = "itemize";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("transactions")) {
        db.createObjectStore("transactions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("productCache")) {
        db.createObjectStore("productCache", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("categories")) {
        db.createObjectStore("categories", { keyPath: "id" });
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

// --- Transactions ---

export async function getTransaction(
  id: string,
): Promise<Transaction | undefined> {
  const store = await getStore("transactions");
  return requestToPromise(store.get(id));
}

export async function getAllTransactions(): Promise<Transaction[]> {
  const store = await getStore("transactions");
  return requestToPromise(store.getAll());
}

export async function putTransaction(transaction: Transaction): Promise<void> {
  const store = await getStore("transactions", "readwrite");
  await requestToPromise(store.put(transaction));
}

export async function putTransactions(
  transactions: Transaction[],
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("transactions", "readwrite");
  const store = tx.objectStore("transactions");
  for (const transaction of transactions) {
    store.put(transaction);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Product Cache ---

export async function getProductCacheEntry(
  id: string,
): Promise<ProductCacheEntry | undefined> {
  const store = await getStore("productCache");
  return requestToPromise(store.get(id));
}

export async function putProductCacheEntry(
  entry: ProductCacheEntry,
): Promise<void> {
  const store = await getStore("productCache", "readwrite");
  await requestToPromise(store.put(entry));
}

// --- Categories ---

export async function getAllCategories(): Promise<Category[]> {
  const store = await getStore("categories");
  return requestToPromise(store.getAll());
}

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
