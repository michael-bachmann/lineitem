import { NO_MATCH_REASON } from "@/lib/matcher";
import { NOT_CONNECTED } from "@/lib/messages";
import { getSettings } from "@/lib/settings";
import { getUnapprovedTransactions } from "@/lib/ynab";
import { toYnabCharge } from "@/lib/money";
import { getAllocatedTransaction, putAllocatedTransactions } from "@/lib/db";
import { getRetailerForPayee } from "@/lib/registry";
import { getAdapter } from "@/retailers/registry";
import { classifyItems } from "@/lib/classifier";
import { distributeOrder } from "@/lib/distribution";
import { verifyScrape } from "@/lib/verify-scrape";
import { dlog, isDebugEnabled } from "@/lib/debug";
import { groupBy, partition } from "remeda";
import { mapSeries } from "@/lib/async";
import type {
  YnabTransaction,
  YnabCharge,
  AllocatedTransaction,
  QueueEntry,
  BlockedRetailer,
  SyncResult,
} from "@/lib/types";

/** Deduplicate concurrent sync calls. */
let activeSyncPromise: Promise<SyncResult> | null = null;

export async function performSync(): Promise<SyncResult> {
  if (activeSyncPromise) return activeSyncPromise;
  activeSyncPromise = performSyncInner();
  try {
    return await activeSyncPromise;
  } finally {
    activeSyncPromise = null;
  }
}

async function performSyncInner(): Promise<SyncResult> {
  try {
    const settings = await getSettings();
    if (!settings.accessToken || !settings.planId) return { error: NOT_CONNECTED };

    // 1. IDENTIFY scrape-able charges, then split the already-cached ones (ready
    //    immediately as matched entries) from the ones that need a retailer scrape.
    const charges = await identifyScrapeCharges(settings.planId);
    const { fastPath, needsScraping } = await triageCharges(charges);

    // Debug: if `needsScraping` is 0, every matching charge was already cached
    // and NO scrape runs this sync — which is why you'd see no `[lineitem:amazon]`
    // logs. Approve/clear the cached ones, or resync a charge that isn't cached.
    dlog("sync", "triage", {
      matchingCharges: charges.length,
      cachedFastPath: fastPath.length,
      needsScraping: needsScraping.length,
    });

    // 2. SCRAPE each retailer into a self-contained outcome (one tab at a time),
    //    keyed back to its originating tx through entryById.
    const entryById = new Map(needsScraping.map((e) => [e.tx.id, e]));
    const outcomes = await mapSeries(
      Object.entries(groupBy(needsScraping, (e) => e.retailer)),
      ([retailer, entries]) => scrapeRetailer(retailer, entries, entryById),
    );

    // 3. PERSIST the allocations (atomic batch), then 4. CLASSIFY them into
    //    matched queue entries.
    const allocated = outcomes.flatMap((o) => o.allocated);
    await putAllocatedTransactions(allocated);
    const matchedEntries = await classifyAllocations(allocated, entryById);

    // 5. QUEUE: cached fast-path + freshly-matched + everything that didn't
    //    allocate (auth walls, verify/distribute failures, no-matches).
    const errorEntries = outcomes.flatMap((o) => o.errorEntries);
    const blocked = outcomes.flatMap((o) => (o.blocked ? [o.blocked] : []));
    return {
      queue: [...fastPath, ...matchedEntries, ...errorEntries],
      ...(blocked.length > 0 ? { blocked } : {}),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Sync failed" };
  }
}

interface TaggedCharge {
  tx: YnabTransaction;
  charge: YnabCharge;
  retailer: string;
}

/** Fetch this plan's unapproved YNAB charges and keep only those whose payee
 *  maps to a scrape-strategy retailer, each tagged with that retailer + charge. */
async function identifyScrapeCharges(planId: string): Promise<TaggedCharge[]> {
  const ynabTxs = await getUnapprovedTransactions(planId);
  return ynabTxs.flatMap((tx) => {
    if (tx.payee_name === null) return [];
    const match = getRetailerForPayee(tx.payee_name);
    return match?.strategy === "scrape"
      ? [{ tx, charge: toYnabCharge(tx), retailer: match.retailer }]
      : [];
  });
}

/** Split tagged charges into the ones already cached — returned as ready
 *  `matched` queue entries — and the ones that still need a scrape. Sequential:
 *  one IDB read (and, for hits, one classification) at a time. */
async function triageCharges(
  charges: TaggedCharge[],
): Promise<{ fastPath: QueueEntry[]; needsScraping: TaggedCharge[] }> {
  const triaged = await mapSeries(charges, async (entry) => {
    const cached = await getAllocatedTransaction(entry.tx.id);
    return cached
      ? { kind: "fast" as const, entry: await toMatchedEntry(cached, entry) }
      : { kind: "scrape" as const, entry };
  });
  return {
    fastPath: triaged.flatMap((t) => (t.kind === "fast" ? [t.entry] : [])),
    needsScraping: triaged.flatMap((t) => (t.kind === "scrape" ? [t.entry] : [])),
  };
}

/** Classify a matched order's items and wrap it as a `matched` queue entry.
 *  Shared by the cached fast path and the post-scrape allocation pass. */
async function toMatchedEntry(order: AllocatedTransaction, entry: TaggedCharge): Promise<QueueEntry> {
  const classifiedItems = await classifyItems(order.items, entry.retailer);
  return {
    ynabTransaction: entry.tx,
    retailer: entry.retailer,
    matchStatus: { status: "matched", order, classifiedItems },
  };
}

/** Turn each freshly-persisted allocation into a `matched` queue entry (an
 *  allocation whose charge isn't in the run is skipped). Sequential — the
 *  classifier shares the single embedder model. */
async function classifyAllocations(
  allocated: AllocatedTransaction[],
  entryById: Map<string, TaggedCharge>,
): Promise<QueueEntry[]> {
  const entries = await mapSeries(allocated, async (at): Promise<QueueEntry[]> => {
    const entry = entryById.get(at.ynabTransactionId);
    return entry ? [await toMatchedEntry(at, entry)] : [];
  });
  return entries.flat();
}

/** Everything one retailer's scrape contributes to the run, as plain data so the
 *  caller can fold several together without any of them touching shared state. */
interface RetailerOutcome {
  /** Orders that verified and distributed — persisted, then classified. */
  allocated: AllocatedTransaction[];
  /** Queue entries for everything that didn't cleanly allocate: a sign-in wall,
   *  a verification failure, a distribution failure, a no-match, or a scrape
   *  throw. */
  errorEntries: QueueEntry[];
  /** Per-retailer sign-in summary for the resolution card, when a wall was hit. */
  blocked?: BlockedRetailer;
}

/**
 * Scrape one retailer and shape the result into a self-contained outcome — it
 * reads nothing from and mutates nothing in the caller, so performSyncInner can
 * fold several outcomes together functionally.
 *
 * The scrape is the only step that does I/O and thus the only throw source (most
 * plausibly openRetailerTab timing out when the tab never finishes loading or
 * its content script never becomes ready). Like runBackfill's per-retailer loop,
 * a throw is isolated here — the retailer's charges become retryable `error`
 * entries — so one hung tab can't discard the other retailers' results or the
 * fast-path cache. The transforms after it act on the returned in-memory data,
 * keyed back through entryById (an absent key is skipped, never thrown on).
 */
async function scrapeRetailer(
  retailerId: string,
  retailerEntries: TaggedCharge[],
  entryById: Map<string, TaggedCharge>,
): Promise<RetailerOutcome> {
  const adapter = getAdapter(retailerId);
  const retailerCharges = retailerEntries.map((e) => e.charge);

  let scraped;
  try {
    scraped = await adapter.scrapeMatchedOrders(retailerCharges);
  } catch (err) {
    console.error(`[sync] ${retailerId} scrape threw:`, err);
    const message = err instanceof Error ? err.message : "Couldn't read this retailer's orders";
    return {
      allocated: [],
      errorEntries: retailerEntries.map((entry) => ({
        ynabTransaction: entry.tx,
        retailer: retailerId,
        matchStatus: { status: "error", message },
      })),
    };
  }
  const { matched, unmatched, blocked } = scraped;

  /** Build a queue entry for a charge, or skip it when its tx isn't in the run
   *  (the charge wasn't one we sent — defensive, mirrors the old `?.tx` guards). */
  const entryFor = (
    ynabTransactionId: string,
    matchStatus: QueueEntry["matchStatus"],
  ): QueueEntry[] => {
    const tx = entryById.get(ynabTransactionId)?.tx;
    return tx ? [{ ynabTransaction: tx, retailer: retailerId, matchStatus }] : [];
  };

  // A sign-in wall (signed out / mid-walk step-up): a per-retailer summary for
  // the resolution card plus an `auth_required` entry per affected charge. These
  // charges are disjoint from `unmatched`, so no double-counting.
  const blockedSummary: BlockedRetailer | undefined = blocked
    ? {
        retailer: retailerId,
        reason: blocked.reason,
        count: blocked.charges.length,
        ...(blocked.url ? { url: blocked.url } : {}),
      }
    : undefined;
  const blockedEntries = blocked
    ? blocked.charges.flatMap((c) => entryFor(c.ynabTransactionId, { status: "auth_required" }))
    : [];

  // GUARD: drop orders whose scraped items don't reconcile to the retailer's
  // displayed Item(s) Subtotal — surfaced as error entries so the user sees the
  // failure rather than a confidently-wrong attribution.
  const verified = matched.map((m) => ({ ...m, verification: verifyScrape(m.order) }));
  const [verifiedOk, verifiedFailed] = partition(verified, (v) => v.verification.ok);
  const verifyFailedEntries = verifiedFailed.flatMap(({ charges, verification }) =>
    charges.flatMap((c) =>
      entryFor(c.ynabTransactionId, {
        status: "error",
        message: verification.ok ? "" : verification.message,
      }),
    ),
  );

  // DISTRIBUTE the verified orders; collect allocations and per-charge failures.
  const distributionResults = verifiedOk.map(({ order, charges }) => distributeOrder(order, charges));
  const allocated = distributionResults.flatMap((r) => r.allocated);
  const distributeFailedEntries = distributionResults.flatMap((r) =>
    r.failures.flatMap((f) => entryFor(f.ynabTransactionId, { status: "error", message: f.reason })),
  );

  // Debug: the post-scrape stage where matched-and-scraped orders can still fail
  // (a verify mismatch, or a refund that couldn't be attributed to items). Dumps
  // every order's refund data next to the raw distribution failure reasons the UI
  // hides behind "Couldn't read order". Guarded so the payload isn't built in
  // shipped builds.
  if (isDebugEnabled()) {
    dlog(retailerId, "post-scrape verify + distribute", {
      orders: verified.map((v) => ({
        orderId: v.order.orderId,
        verifyOk: v.verification.ok,
        refundPopover: v.order.refund,
        itemRefundMarkersCents: v.order.items.map((it) => it.refundedAmountCents),
        charges: v.charges.map((c) => ({
          id: c.ynabTransactionId,
          amountCents: c.amountCents,
          isRefund: c.isRefund,
        })),
      })),
      distributionFailures: distributionResults.flatMap((r) => r.failures),
    });
  }

  // Unmatched charges → no_match (or a specific read-failure reason).
  const unmatchedEntries = unmatched.flatMap(({ charge, reason }) =>
    entryFor(
      charge.ynabTransactionId,
      reason === NO_MATCH_REASON ? { status: "no_match" } : { status: "error", message: reason },
    ),
  );

  return {
    allocated,
    errorEntries: [
      ...blockedEntries,
      ...verifyFailedEntries,
      ...distributeFailedEntries,
      ...unmatchedEntries,
    ],
    blocked: blockedSummary,
  };
}

