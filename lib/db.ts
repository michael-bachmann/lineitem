import type { ItemizedTransaction, ProductCategory, Category } from "./types";

const DB_NAME = "itemize";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;

      const txStore = db.createObjectStore("itemizedTransactions", { keyPath: "ynabTransactionId" });
      txStore.createIndex("orderKey", "orderKey", { unique: false });

      db.createObjectStore("productCategories", { keyPath: "id" });
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

// --- Itemized Transactions (primary key: ynabTransactionId, secondary index: orderKey) ---

export async function getItemizedTransaction(
  ynabTransactionId: string,
): Promise<ItemizedTransaction | undefined> {
  const store = await getStore("itemizedTransactions");
  return requestToPromise(store.get(ynabTransactionId));
}

export async function putItemizedTransaction(tx: ItemizedTransaction): Promise<void> {
  const store = await getStore("itemizedTransactions", "readwrite");
  await requestToPromise(store.put(tx));
}

// --- Product Categories (learned from user approvals) ---

export async function getProductCategory(
  id: string,
): Promise<ProductCategory | undefined> {
  const store = await getStore("productCategories");
  return requestToPromise(store.get(id));
}

export async function putProductCategory(
  entry: ProductCategory,
): Promise<void> {
  const store = await getStore("productCategories", "readwrite");
  await requestToPromise(store.put(entry));
}

// --- Categories ---

export async function getAllCategories(): Promise<Category[]> {
  const store = await getStore("categories");
  return requestToPromise(store.getAll());
}

/** Replace all categories atomically — clear + puts are in one IDB transaction. */
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
