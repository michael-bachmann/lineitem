// ---------------------------------------------------------------------------
// Data Model — IndexedDB stores
//
// All monetary values are integer cents (positive). Conversion to YNAB
// milliunits (cents × −10 for outflows) happens at the API boundary only.
//
// Key formats use a "{retailer}:{...}" prefix so records from different
// retailers never collide in the same IndexedDB store.
// ---------------------------------------------------------------------------

/**
 * Maps a product to a YNAB category. Learned from user approvals so that
 * repeat purchases are auto-classified on future syncs.
 *
 * Stored in the `productCategories` IndexedDB store, keyed by id.
 */
export interface ProductCategory {
  /** Format: "{retailer}:{productId}" e.g. "amazon:B0XXXXXXXX" */
  id: string;
  /** YNAB category UUID. */
  categoryId: string;
  /** True once the user has explicitly approved this mapping. */
  confirmedByUser: boolean;
  /** How many times this product has appeared across syncs. */
  timesSeen: number;
  /** ISO datetime — last time this product was seen in a transaction. */
  lastSeen: string;
  /** Source text the embedding was derived from. Retained so we can re-embed
   *  if the model is upgraded without waiting for re-approval. */
  title?: string;
  /** 384-dim L2-normalized embedding vector. Absent if the embedder wasn't
   *  ready at write time; backfilled on next opportunity. */
  embedding?: Float32Array;
  /** ISO timestamp when this embedding was computed. Absent iff embedding is absent. */
  embeddedAt?: string;
}

/**
 * A YNAB category, synced from the user's plan.
 *
 * Stored in the `categories` IndexedDB store, keyed by id.
 * Refreshed via GET /plans/{id}/categories.
 */
export interface Category {
  /** YNAB category UUID. */
  id: string;
  /** Display name, e.g. "Groceries", "Rent". */
  name: string;
  /** YNAB category group name, e.g. "Frequent", "Non-Monthly". */
  groupName: string;
}

// ---------------------------------------------------------------------------
// YNAB API types — match the YNAB API response shapes we consume.
// Amounts are in milliunits (1 dollar = 1000 milliunits). Outflows are
// negative (e.g. $42.99 outflow = −42990).
// ---------------------------------------------------------------------------

export interface YnabTransaction {
  /** YNAB transaction UUID. */
  id: string;
  /** ISO date (YYYY-MM-DD) — when the transaction posted. */
  date: string;
  /** Milliunits — negative for outflows (e.g. −42990 = $42.99 spent). */
  amount: number;
  /** Payee name as it appears in YNAB, e.g. "AMAZON.COM". */
  payee_name: string | null;
  /** YNAB category UUID, or null if uncategorized. */
  category_id: string | null;
  /** Category display name, or null if uncategorized. */
  category_name: string | null;
  /** Whether the user has approved this transaction in YNAB. */
  approved: boolean;
  /** Existing split subtransactions, if any. */
  subtransactions: YnabSubtransaction[];
}

export interface YnabSubtransaction {
  /** Milliunits — negative for outflows. */
  amount: number;
  /** YNAB category UUID for this split leg. */
  category_id: string | null;
  /** Optional memo, typically the item title. */
  memo: string | null;
}

// ---------------------------------------------------------------------------
// Retailer registry — hardcoded payee-to-retailer mappings in registry.ts.
// These are runtime-only objects (RegExp is not serializable).
// ---------------------------------------------------------------------------

export type PayeeStrategy = "scrape" | "skip";

export interface PayeeMapping {
  /** Regex to match against YNAB payee_name, e.g. /amazon/i. */
  pattern: RegExp;
  /** Retailer identifier, e.g. "amazon". */
  retailer: string;
  /** "scrape" to enter the matching flow, "skip" to ignore (e.g. Amazon Tips). */
  strategy: PayeeStrategy;
}

// ---------------------------------------------------------------------------
// Side panel ↔ service worker message protocol
// ---------------------------------------------------------------------------

export type MessageRequest =
  | { type: "SYNC" }
  | { type: "APPROVE_TRANSACTION"; ynabTransactionId: string; items: ApprovalItem[] }
  | { type: "APPROVE_BATCH"; ynabTransactionIds: string[] }
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; token: string; planId: string; planName: string }
  | { type: "GET_PLANS"; token: string }
  | { type: "REFRESH_CATEGORIES" }
  | { type: "GET_CATEGORIES" }
  | { type: "CLEAR_SETTINGS" };

/**
 * The user's category choice for one item in a transaction. Slimmer than
 * the scraped item: price, quantity, title, and allocatedCents all come
 * from the persisted AllocatedTransaction (joined by productId server-side).
 */
export interface ApprovalItem {
  productId: string;
  categoryId: string;
}

export type SyncStatus = "idle" | "syncing" | "done" | "error";

// ---------------------------------------------------------------------------
// Queue & classification — used by the side panel to display results.
// ---------------------------------------------------------------------------

export type OrderMatchStatus =
  | { status: "loading" }
  | { status: "matched"; order: AllocatedTransaction; classifiedItems: ClassifiedItem[] }
  | { status: "no_match" }
  | { status: "auth_required" }
  | { status: "error"; message: string };

/** An AllocatedItem enriched with the classifier's suggestion. */
export interface ClassifiedItem extends AllocatedItem {
  /** YNAB category UUID suggested by the classifier, or null if uncategorized. */
  suggestedCategoryId: string | null;
  /** Which classifier tier produced the suggestion, or null if uncategorized. */
  classificationSource: "product_cache" | null;
}

/** A YNAB transaction paired with its retailer match status for display in the queue. */
export interface QueueEntry {
  /** The original YNAB transaction. */
  ynabTransaction: YnabTransaction;
  /** Which retailer this transaction was matched to, e.g. "amazon". */
  retailer: string;
  /** Current state of matching this transaction to a retailer order. */
  matchStatus: OrderMatchStatus;
}

// ---------------------------------------------------------------------------
// Distribution pipeline types — added for the new sync flow.
// All monetary values are non-negative integer cents.
// ---------------------------------------------------------------------------

/** A YNAB charge normalized for the pipeline. Always positive cents. */
export interface YnabCharge {
  ynabTransactionId: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Positive cents, regardless of refund vs purchase. */
  amountCents: number;
  payeeName: string;
  isRefund: boolean;
  cardLastFour: string | null;
}

/** An order as returned by a RetailerAdapter. */
export interface ScrapedOrder {
  retailer: string;
  /** Adapter's notion of "same order". */
  orderId: string;
  items: ScrapedItem[];
  /** ISO datetime. */
  scrapedAt: string;
  /**
   * Amazon's displayed "Item(s) Subtotal" for this order, in cents.
   * Used by the scrape-completeness guard to verify that sum(items)
   * matches what the retailer says the items add up to. Required —
   * if an adapter cannot extract this, it must fail the scrape
   * rather than fabricate a value.
   */
  displayedItemsSubtotalCents: number;
}

/** A line item as scraped — raw per-unit price, no allocation yet. */
export interface ScrapedItem {
  productId: string;
  title: string;
  /** Product thumbnail URL from the retailer. */
  imageUrl: string;
  /** Raw per-unit price in cents. */
  unitPriceCents: number;
  quantity: number;
}

/** A persisted transaction with per-item allocated amounts. */
export interface AllocatedTransaction {
  /** Primary key. */
  ynabTransactionId: string;
  /** Format: "{retailer}:{orderId}". */
  orderKey: string;
  retailer: string;
  date: string;
  /** YNAB charge total in cents. */
  amountCents: number;
  cardLastFour: string | null;
  isRefund: boolean;
  /** Sum of item.allocatedCents equals amountCents exactly. */
  items: AllocatedItem[];
  scrapedAt: string;
}

/** A scraped item plus its share of the YNAB charge. */
export interface AllocatedItem extends ScrapedItem {
  /** This item's share of the YNAB charge in cents. */
  allocatedCents: number;
}

/** An adapter for scraping a retailer's order data. */
export interface RetailerAdapter {
  /** Retailer identifier, e.g. "amazon". */
  id: string;
  payees: PayeeMapping[];

  /**
   * Scrape the retailer for orders covering the given YNAB charges, and
   * return the charge → order grouping the adapter discovered.
   *
   * The adapter owns its full lifecycle, including tab opening/closing
   * and cleanup on success and failure paths. The pipeline calls this
   * once per retailer per sync.
   *
   * Returns matched orders with the charges they cover, plus unmatched
   * charges with a reason. No persistence, no classification.
   */
  scrapeMatchedOrders(charges: YnabCharge[]): Promise<{
    matched: { order: ScrapedOrder; charges: YnabCharge[] }[];
    unmatched: { charge: YnabCharge; reason: string }[];
  }>;
}
