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
 * Forever-row mapping a product to a YNAB category, learned from a user
 * approval. Read by classifyItem's exact-match cache tier; never deleted,
 * only updated when the user re-approves the same product with a different
 * category.
 *
 * Stored in the `learnedProducts` IndexedDB store, keyed by id.
 */
export interface LearnedProduct {
  /** Format: "{retailer}:{productId}" e.g. "amazon:B0XXXXXXXX" */
  id: string;
  /** YNAB category UUID. */
  categoryId: string;
}

/**
 * One vector in the embedding similarity pool. Capped per-category;
 * evicted oldest-first by `lastSeen` when a category fills.
 *
 * Stored in the `productEmbeddings` IndexedDB store, keyed by id. Pairs
 * 1:1 with a LearnedProduct (same id) while the embedding lives; deletion
 * here does not delete the LearnedProduct cache row.
 */
export interface ProductEmbedding {
  /** Format: "{retailer}:{productId}" — same shape as LearnedProduct.id. */
  id: string;
  /** Denormalized from LearnedProduct so scoring can group by category
   *  without a per-row join; kept in sync because approval writes both. */
  categoryId: string;
  /** Source text the embedding was derived from. Used by the UI's
   *  "similar to your past 'X'" line and by any future re-embed. */
  title: string;
  /** 384-dim L2-normalized embedding vector. */
  embedding: Float32Array;
  /** ISO datetime — last time this product was approved. Drives eviction. */
  lastSeen: string;
}

/**
 * Marker that a YNAB transaction was processed by the past-order backfill
 * flow. Its presence — not its contents — is what matters: it lets repeat
 * backfill runs skip transactions we've already scraped, so re-runs only
 * pick up the leftover unmatched ones (typically: orders on a different
 * retailer account).
 *
 * Sync uses AllocatedTransaction as its own "already processed" marker;
 * backfill never writes AllocatedTransaction (no allocation happens), so
 * it tracks its own marker here.
 *
 * Stored in the `backfilledTransactions` IndexedDB store, keyed by id.
 */
export interface BackfilledTransaction {
  /** YNAB transaction UUID. */
  ynabTransactionId: string;
  /** ISO timestamp when backfill last touched this transaction. */
  backfilledAt: string;
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
  | { type: "CLEAR_SETTINGS" }
  | { type: "START_BACKFILL"; fromDate: string }
  | { type: "CANCEL_BACKFILL" };

/** Messages broadcast from the background to interested listeners (e.g. the
 *  side panel). Distinct from MessageRequest because no response is expected. */
export type MessageBroadcast =
  | { type: "BACKFILL_PROGRESS"; event: BackfillProgress };

/** What backfill is doing right now. "preparing" covers fetching YNAB
 *  transactions plus the retailer's transaction-list pagination — phases
 *  where we don't yet know how many orders we'll scrape. Once detail-page
 *  scrapes start, each event reports the order index + total. */
export type BackfillProgress =
  | { status: "preparing" }
  | { status: "scraping"; index: number; total: number };

export interface BackfillResult {
  /** Candidates remaining after the eligibility filter. */
  total: number;
  /** Transactions whose order was scraped successfully and learned. */
  matched: number;
  /** Transactions skipped post-filter — no order found, or multi-charge
   *  order (ambiguous category attribution). */
  unmatched: number;
  /** Transactions in a retailer batch that aborted the scrape. */
  failed: number;
  /** Sum of items written to LearnedProduct / ProductEmbedding stores. */
  itemsWritten: number;
}

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
  classificationSource: "product_cache" | "embedding" | null;
  /** Only set when classificationSource === "embedding". The nearest past
   *  title and its cosine, used for the UI "similar to your past X" hint. */
  matchedSource?: { title: string; cosine: number };
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
}

/** An order as returned by a RetailerAdapter. */
export interface ScrapedOrder {
  retailer: string;
  /** Adapter's notion of "same order". */
  orderId: string;
  items: ScrapedItem[];
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
  isRefund: boolean;
  /** Sum of item.allocatedCents equals amountCents exactly. */
  items: AllocatedItem[];
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
   *
   * `options.maxPages` is the upper bound on transaction-list pagination
   * the adapter is allowed to walk. Sync's natural cutoff (most recent
   * unapproved charges) means a small default is fine; backfill passes a
   * higher value so it can reach old orders.
   *
   * `options.onScrapeProgress` is called once per detail-page scrape just
   * before it runs, with the 1-indexed position and the total number of
   * detail-page scrapes planned for this batch. The transaction-list
   * pagination phase emits no events (we don't know the total yet).
   *
   * `options.signal` lets the caller cancel mid-batch. Adapters must check
   * it at natural pause points (between detail-page scrapes, between list-
   * page paginations) and throw the standard DOMException AbortError when
   * the signal aborts; in-progress detail scrapes are allowed to finish.
   */
  scrapeMatchedOrders(
    charges: YnabCharge[],
    options?: {
      maxPages?: number;
      signal?: AbortSignal;
      onScrapeProgress?: (event: { index: number; total: number }) => void;
    },
  ): Promise<{
    matched: { order: ScrapedOrder; charges: YnabCharge[] }[];
    unmatched: { charge: YnabCharge; reason: string }[];
  }>;
}
