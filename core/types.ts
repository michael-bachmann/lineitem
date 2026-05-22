// ---------------------------------------------------------------------------
// Data Model — IndexedDB stores
//
// All monetary values are integer cents (positive). Conversion to YNAB
// milliunits (cents × −10 for outflows) happens at the API boundary only.
//
// ID formats use a "{retailer}:{...}" prefix so records from different
// retailers never collide in the same IndexedDB store.
// ---------------------------------------------------------------------------

/**
 * A single product within a Transaction. Nested in Transaction.items —
 * not stored as a separate IndexedDB record.
 */
export interface LineItem {
  /** Retailer's product identifier (e.g. ASIN for Amazon). */
  productId: string;
  /** Product title as displayed on the retailer's site. */
  title: string;
  /** Product thumbnail URL from the retailer. */
  imageUrl: string;
  /** Per-unit price in cents. */
  price: number;
  /** Number of this item purchased. */
  quantity: number;
}

/**
 * A retailer-side transaction matched to a YNAB transaction by exact amount
 * + date proximity (±3 days). Contains the line items for categorization.
 *
 * For Amazon, this is a card-level charge (one per shipment). A single charge
 * may span multiple orders (e.g. Amazon Day deliveries), and one order may be
 * split across multiple charges (split shipments).
 *
 * Other retailers may produce one Transaction per order instead.
 *
 * Stored in the `transactions` IndexedDB store, keyed by id.
 */
export interface Transaction {
  /** Format: "{retailer}:{date}-{amountCents}" e.g. "amazon:2026-05-17-8743" */
  id: string;
  /** Retailer identifier, e.g. "amazon". */
  retailer: string;
  /** ISO date (YYYY-MM-DD) — when the charge posted or order was placed. */
  date: string;
  /** Amount in cents (always positive, even for refunds). */
  amountCents: number;
  /** Retailer order IDs associated with this transaction. */
  orderIds: string[];
  /** Last four digits of the card charged, if available. */
  cardLastFour: string | null;
  /** Whether this is a refund rather than a purchase. */
  isRefund: boolean;
  /** Line items included in this transaction. */
  items: LineItem[];
  /** ISO datetime — when this transaction was scraped from the retailer. */
  scrapedAt: string;
}

/**
 * Maps a product to a YNAB category. Learned from user approvals so that
 * repeat purchases are auto-classified on future syncs.
 *
 * Stored in the `productCache` IndexedDB store, keyed by id.
 */
export interface ProductCacheEntry {
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
  /** Regex to match against YNAB payee_name, e.g. /amazon\.com/i. */
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
  | { type: "APPROVE_TRANSACTION"; transactionId: string; items: ApprovalItem[] }
  | { type: "APPROVE_BATCH"; transactionIds: string[] }
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; token: string; planId: string; planName: string }
  | { type: "GET_PLANS"; token: string }
  | { type: "REFRESH_CATEGORIES" }
  | { type: "CLEAR_SETTINGS" };

export interface ApprovalItem {
  /** Retailer's product identifier (e.g. ASIN). */
  productId: string;
  /** Product title — used as the subtransaction memo. */
  title: string;
  /** Per-unit price in cents. */
  price: number;
  /** Number of this item purchased. */
  quantity: number;
  /** YNAB category UUID chosen by the user. */
  categoryId: string;
}

export type SyncStatus = "idle" | "syncing" | "done" | "error";

// ---------------------------------------------------------------------------
// Queue & classification — used by the side panel to display results.
// ---------------------------------------------------------------------------

export type TransactionMatchStatus =
  | { status: "loading" }
  | { status: "matched"; transaction: Transaction; classifiedItems: ClassifiedItem[] }
  | { status: "no_match" }
  | { status: "auth_required" }
  | { status: "error"; message: string };

/** A LineItem enriched with the classifier's suggestion. */
export interface ClassifiedItem extends LineItem {
  /** YNAB category UUID suggested by the classifier, or null if uncategorized. */
  suggestedCategoryId: string | null;
  /** Which classifier tier produced the suggestion, or null if uncategorized. */
  classificationSource: "product_cache" | "keyword_rule" | null;
}

/** A YNAB transaction paired with its retailer match status for display in the queue. */
export interface QueueTransaction {
  /** The original YNAB transaction. */
  ynabTransaction: YnabTransaction;
  /** Which retailer this transaction was matched to, e.g. "amazon". */
  retailer: string;
  /** Current state of matching this transaction to a retailer order. */
  matchStatus: TransactionMatchStatus;
}
