import { getSettings } from "@/lib/settings";
import { getUnapprovedTransactions } from "@/lib/ynab";
import { getAllocatedTransaction, putAllocatedTransactions } from "@/lib/db";
import { getRetailerForPayee } from "@/lib/registry";
import { getAdapter } from "@/retailers/registry";
import { classifyItems } from "@/lib/classifier";
import { distributeOrder } from "@/lib/distribution";
import { millunitsToCents } from "@/lib/money";
import { groupBy } from "remeda";
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const classifiedItems = await classifyItems(cached.items as any, entry.retailer);
        fastPath.push({
          ynabTransaction: entry.tx,
          retailer: entry.retailer,
          // order type updated in Task 13 when OrderMatchStatus references AllocatedTransaction
          matchStatus: { status: "matched", order: cached as any, classifiedItems },
        });
      } else {
        needsScraping.push(entry);
      }
    }

    const chargesByRetailer = groupBy(needsScraping, (e) => e.retailer);

    const allAllocated: AllocatedTransaction[] = [];
    const errorEntries: QueueEntry[] = [];

    for (const [retailerId, retailerEntries] of Object.entries(chargesByRetailer)) {
      const adapter = getAdapter(retailerId);
      const retailerCharges = retailerEntries.map((e) => e.charge);

      // 2. SCRAPE + MATCH (adapter owns tab lifecycle and cleanup)
      const { matched, unmatched } = await adapter.scrapeMatchedOrders(retailerCharges);

      // 3. DISTRIBUTE
      const allocated = matched.flatMap(({ order, charges }) => distributeOrder(order, charges));

      // Map distribution failures (empty result) to error entries
      for (const { order, charges } of matched) {
        const allocatedIds = new Set(
          allocated.filter((a) => a.orderKey === `${order.retailer}:${order.orderId}`)
            .map((a) => a.ynabTransactionId),
        );
        for (const charge of charges) {
          if (!allocatedIds.has(charge.ynabTransactionId)) {
            const tx = retailerEntries.find((e) => e.charge.ynabTransactionId === charge.ynabTransactionId)!.tx;
            errorEntries.push({
              ynabTransaction: tx,
              retailer: retailerId,
              matchStatus: {
                status: "error",
                message: "Could not partition items across charges (too many items or charges > items)",
              },
            });
          }
        }
      }

      allAllocated.push(...allocated);

      // Map unmatched charges to no_match QueueEntries
      for (const { charge, reason } of unmatched) {
        const tx = retailerEntries.find((e) => e.charge.ynabTransactionId === charge.ynabTransactionId)?.tx;
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
      const entry = needsScraping.find((e) => e.charge.ynabTransactionId === at.ynabTransactionId);
      if (!entry) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const classifiedItems = await classifyItems(at.items as any, entry.retailer);
      matchedEntries.push({
        ynabTransaction: entry.tx,
        retailer: entry.retailer,
        // order type updated in Task 13 when OrderMatchStatus references AllocatedTransaction
        matchStatus: { status: "matched", order: at as any, classifiedItems },
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
    cardLastFour: null, // not in YNAB API; would come from a card field if present
  };
}
