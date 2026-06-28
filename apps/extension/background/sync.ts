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
import { groupBy, partition } from "remeda";
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
    if (!settings.accessToken || !settings.planId) {
      return { error: NOT_CONNECTED };
    }

    // 1. IDENTIFY: fetch YNAB charges, group by retailer
    const ynabTxs = await getUnapprovedTransactions(settings.planId);

    const taggedCharges = ynabTxs
      .filter((tx) => tx.payee_name !== null)
      .map((tx) => {
        const match = getRetailerForPayee(tx.payee_name!);
        return match?.strategy === "scrape"
          ? { tx, charge: toYnabCharge(tx), retailer: match.retailer }
          : null;
      })
      .filter((x): x is { tx: YnabTransaction; charge: YnabCharge; retailer: string } => x !== null);

    // Fast path: cached transactions skip scraping
    const fastPath: QueueEntry[] = [];
    const needsScraping: typeof taggedCharges = [];

    for (const entry of taggedCharges) {
      const cached = await getAllocatedTransaction(entry.tx.id);
      if (cached) {
        const classifiedItems = await classifyItems(cached.items, entry.retailer);
        fastPath.push({
          ynabTransaction: entry.tx,
          retailer: entry.retailer,
          matchStatus: { status: "matched", order: cached, classifiedItems },
        });
      } else {
        needsScraping.push(entry);
      }
    }

    // Lookup by ynabTransactionId for back-references later in the pipeline.
    const entryById = new Map(needsScraping.map((e) => [e.tx.id, e]));

    const chargesByRetailer = groupBy(needsScraping, (e) => e.retailer);

    // 2. SCRAPE each retailer. Sequentially — each adapter owns a browser tab, so
    // we don't open several at once — and each returns a self-contained outcome
    // rather than mutating shared state, so we fold them into the run aggregates.
    const outcomes: RetailerOutcome[] = [];
    for (const [retailerId, retailerEntries] of Object.entries(chargesByRetailer)) {
      outcomes.push(await scrapeRetailer(retailerId, retailerEntries, entryById));
    }

    const allAllocated = outcomes.flatMap((o) => o.allocated);
    const errorEntries = outcomes.flatMap((o) => o.errorEntries);
    const blockedRetailers = outcomes.flatMap((o) => (o.blocked ? [o.blocked] : []));

    // 4. PERSIST (atomic batch write)
    await putAllocatedTransactions(allAllocated);

    // 5. CLASSIFY (post-persist; failures degrade to "no suggestion", not data loss)
    const matchedEntries: QueueEntry[] = [];
    for (const at of allAllocated) {
      const entry = entryById.get(at.ynabTransactionId);
      if (!entry) continue;
      const classifiedItems = await classifyItems(at.items, entry.retailer);
      matchedEntries.push({
        ynabTransaction: entry.tx,
        retailer: entry.retailer,
        matchStatus: { status: "matched", order: at, classifiedItems },
      });
    }

    // 6. QUEUE
    return {
      queue: [...fastPath, ...matchedEntries, ...errorEntries],
      ...(blockedRetailers.length > 0 ? { blocked: blockedRetailers } : {}),
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

