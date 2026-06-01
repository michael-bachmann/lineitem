import { getSettings } from "@/lib/settings";
import { getUnapprovedTransactions } from "@/lib/ynab";
import { getAllocatedTransaction, putAllocatedTransactions } from "@/lib/db";
import { getRetailerForPayee } from "@/lib/registry";
import { getAdapter } from "@/retailers/registry";
import { classifyItems } from "@/lib/classifier";
import { distributeOrder } from "@/lib/distribution";
import { verifyScrape } from "@/lib/verify-scrape";
import { millunitsToCents } from "@/lib/money";
import { groupBy, partition } from "remeda";
import type {
  YnabTransaction,
  YnabCharge,
  AllocatedTransaction,
  QueueEntry,
} from "@/lib/types";

/** Deduplicate concurrent sync calls. */
let activeSyncPromise: Promise<{ queue: QueueEntry[] } | { error: string }> | null = null;

export async function performSync(): Promise<{ queue: QueueEntry[] } | { error: string }> {
  if (activeSyncPromise) return activeSyncPromise;
  activeSyncPromise = performSyncInner();
  try {
    return await activeSyncPromise;
  } finally {
    activeSyncPromise = null;
  }
}

async function performSyncInner(): Promise<{ queue: QueueEntry[] } | { error: string }> {
  try {
    const settings = await getSettings();
    if (!settings.ynabToken || !settings.planId) {
      return { error: "Not connected to YNAB" };
    }

    // 1. IDENTIFY: fetch YNAB charges, group by retailer
    const ynabTxs = await getUnapprovedTransactions(settings.ynabToken, settings.planId);

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

    const allAllocated: AllocatedTransaction[] = [];
    const errorEntries: QueueEntry[] = [];

    for (const [retailerId, retailerEntries] of Object.entries(chargesByRetailer)) {
      const adapter = getAdapter(retailerId);
      const retailerCharges = retailerEntries.map((e) => e.charge);

      // 2. SCRAPE + MATCH (adapter owns tab lifecycle and cleanup)
      const { matched, unmatched } = await adapter.scrapeMatchedOrders(retailerCharges);

      // 2.5 GUARD: drop orders whose scraped items don't reconcile to the
      // retailer's displayed Item(s) Subtotal. Surfaces as error queue
      // entries so the user sees the failure rather than a confidently-
      // wrong attribution.
      const verified = matched.map((m) => ({ ...m, verification: verifyScrape(m.order) }));
      const [verifiedOk, verifiedFailed] = partition(verified, (v) => v.verification.ok);
      const validMatched = verifiedOk.map(({ order, charges }) => ({ order, charges }));

      errorEntries.push(
        ...verifiedFailed.flatMap(({ charges, verification }) =>
          charges.map((charge) => ({
            ynabTransaction: entryById.get(charge.ynabTransactionId)!.tx,
            retailer: retailerId,
            matchStatus: {
              status: "error" as const,
              message: verification.ok ? "" : verification.message,
            },
          })),
        ),
      );

      // 3. DISTRIBUTE
      const distributionResults = validMatched.map(({ order, charges }) =>
        distributeOrder(order, charges),
      );

      const allocated = distributionResults.flatMap((r) => r.allocated);

      // Per-charge failures with their specific reason
      errorEntries.push(
        ...distributionResults.flatMap((r) =>
          r.failures.map((f) => ({
            ynabTransaction: entryById.get(f.ynabTransactionId)!.tx,
            retailer: retailerId,
            matchStatus: { status: "error" as const, message: f.reason },
          })),
        ),
      );

      allAllocated.push(...allocated);

      // Map unmatched charges to no_match QueueEntries
      for (const { charge, reason } of unmatched) {
        const tx = entryById.get(charge.ynabTransactionId)?.tx;
        if (!tx) continue;
        errorEntries.push({
          ynabTransaction: tx,
          retailer: retailerId,
          matchStatus: reason === "No matching Amazon order found"
            ? { status: "no_match" }
            : { status: "error", message: reason },
        });
      }
    }

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
    return { queue: [...fastPath, ...matchedEntries, ...errorEntries] };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Sync failed" };
  }
}

/** Convert a YNAB transaction to a normalized YnabCharge. */
function toYnabCharge(tx: YnabTransaction): YnabCharge {
  return {
    ynabTransactionId: tx.id,
    date: tx.date,
    amountCents: millunitsToCents(tx.amount),
    payeeName: tx.payee_name ?? "",
    isRefund: tx.amount > 0, // YNAB outflows negative; positive amount = refund/inflow
  };
}
