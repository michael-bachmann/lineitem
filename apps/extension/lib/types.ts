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
  | { type: "START_OAUTH" }
  | { type: "GET_PLANS" }
  | { type: "SAVE_PLAN"; planId: string; planName: string }
  | { type: "REFRESH_CATEGORIES" }
  | { type: "GET_CATEGORIES" }
  | { type: "CLEAR_SETTINGS" }
  | { type: "START_BACKFILL"; fromDate: string }
  | { type: "CANCEL_BACKFILL" }
  | { type: "OPEN_RETAILER"; retailer: string };

/** Messages broadcast from the background to interested listeners (e.g. the
 *  side panel). Distinct from MessageRequest because no response is expected. */
export type MessageBroadcast =
  | { type: "BACKFILL_PROGRESS"; event: BackfillProgress };

/** What backfill is doing right now. "preparing" covers fetching YNAB
 *  transactions plus the retailer's transaction-list pagination — phases
 *  where we don't yet know how many orders we'll scrape. Once detail-page
 *  scrapes start, each event reports the order index + total. "learning"
 *  follows the last scrape: embeddings run on CPU and can take minutes for
 *  large batches, so the UI surfaces item-level progress through that phase. */
export type BackfillProgress =
  | { status: "preparing" }
  | { status: "scraping"; index: number; total: number }
  | { status: "learning"; index: number; total: number };

export interface BackfillResult {
  /** Cumulative count of eligible transactions in the window that now have
   *  order data (pre-existing AllocatedTransactions from sync/prior backfill,
   *  plus this run's new matches). Drives the done-state numerator. */
  transactionsBackfilled: number;
  /** Cumulative count of items across all backfilled transactions. */
  itemsLearned: number;
  /** Whether eligible transactions remain without allocations — drives the
   *  "Run again" CTA on the done card. */
  hasUnbackfilled: boolean;
  /** Transactions in a retailer batch that aborted the scrape THIS run. */
  failed: number;
  /** Per-retailer progress, so the done card can show "Target: 15 of 29 ·
   *  Amazon: 4 of 6" instead of one collapsed total. `matched` is cumulative
   *  (pre-existing allocations + this run); `eligible` is the eligible-by-shape
   *  count in the window for that retailer. */
  byRetailer: BackfillRetailerProgress[];
}

export interface BackfillRetailerProgress {
  retailer: string;
  /** Cumulative matched (pre-existing + this run) for this retailer. */
  matched: number;
  /** Transactions whose pages couldn't be read this run (retryable). */
  failed: number;
  /** Set when this retailer's scrape hit a sign-in wall — its orders couldn't
   *  be read at all, so its low match count means "sign in", not "won't match".
   *  Drives a sign-in prompt on the done card instead of the generic copy. */
  blocked?: RetailerBlockReason;
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

/** Result of a sync: the display queue, plus any per-retailer sign-in walls the
 *  scrape hit (surfaced as "needs you" cards above the queue). */
export type SyncResult =
  | { queue: QueueEntry[]; blocked?: BlockedRetailer[] }
  | { error: string };

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
  /**
   * Order-level refund totals from Amazon's "Refund Total" popover.
   * Null when the order has no refunds. `itemCents` is the item-only
   * portion (sum of per-item refund markers); `taxCents` is the tax
   * portion (0 on grocery orders); `totalCents` = itemCents + taxCents
   * and is what posts as YNAB refund transaction(s) for this order.
   *
   * Distribution uses `totalCents / itemCents` as the tax-grossed
   * ratio when matching YNAB refund amounts back to per-item markers.
   */
  refund: { itemCents: number; taxCents: number; totalCents: number } | null;
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
  /** Sum of refund markers in cents for this item across the order; 0 when
   *  not refunded. Same currency as unitPriceCents. For grocery, comes from
   *  the per-item `ufpo-item-status-price` span. For regular Amazon, comes
   *  from a shipment-level "Refunded" status (full line total). */
  refundedAmountCents: number;
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
  /** Landing URL for this retailer — where a scrape starts, and where the
   *  "Open {retailer}" resolution action sends the user to sign in. */
  startUrl: string;

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
    /**
     * Set when the scrape hit a sign-in wall only the user can clear (signed
     * out, or a mid-walk step-up). Carries the charges that couldn't be read
     * because of it. Any `matched`/`unmatched` discovered before the wall are
     * still returned alongside — partial results survive.
     */
    blocked?: RetailerBlock;
  }>;
}

/** Why a scrape is blocked on a user sign-in action. `signed_out`: the session
 *  isn't authenticated at all. `step_up`: authenticated, but the retailer forced
 *  a fresh sign-in to view a gated page mid-walk (Target invoices). */
export type RetailerBlockReason = "signed_out" | "step_up";

/** A sign-in wall a retailer scrape hit, plus the charges it left unreadable. */
export interface RetailerBlock {
  reason: RetailerBlockReason;
  charges: YnabCharge[];
}

/** Per-retailer sign-in prompt the side panel surfaces above the queue. */
export interface BlockedRetailer {
  retailer: string;
  reason: RetailerBlockReason;
  /** How many charges this block left unreadable. */
  count: number;
}

// ---------------------------------------------------------------------------
// OAuth proxy contract — shared between the extension and the Cloudflare
// Worker that holds the client_secret. The extension never knows the secret;
// it asks the Worker to do token exchanges on its behalf.
// ---------------------------------------------------------------------------

/** Body the extension POSTs to the Worker's `/oauth/exchange` endpoint after
 *  the consent leg returns an authorization code. */
export interface OAuthExchangeRequest {
  code: string;
  redirect_uri: string;
}

/** Body the extension POSTs to the Worker's `/oauth/refresh` endpoint when
 *  an access token has expired. */
export interface OAuthRefreshRequest {
  refresh_token: string;
}

/** YNAB's token response shape — passed through by the Worker unchanged.
 *  `expires_in` is seconds-until-access-token-expiry (YNAB documents 7200). */
export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
}
