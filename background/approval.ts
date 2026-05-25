import { getSettings } from "@/lib/settings";
import { updateTransaction } from "@/lib/ynab";
import { getAllocatedTransaction, getProductCategory, putProductCategory } from "@/lib/db";
import { classifyItems } from "@/lib/classifier";
import type { AllocatedTransaction, ApprovalItem, LineItem } from "@/lib/types";

/** Check whether all items share the same category. */
function isSingleCategory(items: ApprovalItem[]): boolean {
  return items.length > 0 && items.every((item) => item.categoryId === items[0].categoryId);
}

/**
 * Build YNAB subtransactions by joining the user's category choices to the
 * persisted AllocatedTransaction. Per-item amounts come from item.allocatedCents
 * — no recomputation here.
 */
function buildSubtransactions(
  tx: AllocatedTransaction,
  choices: ApprovalItem[],
): Array<{ amount: number; category_id: string | null; memo: string | null }> {
  const sign = tx.isRefund ? 10 : -10; // YNAB milliunits; outflows negative
  const choiceById = new Map(choices.map((c) => [c.productId, c.categoryId]));

  return tx.items.map((item) => ({
    amount: item.allocatedCents * sign,
    category_id: choiceById.get(item.productId) ?? null,
    memo: item.title,
  }));
}

/** Learn from this approval — save product→category mappings for future classification. */
async function learnFromApproval(retailer: string, choices: ApprovalItem[]): Promise<void> {
  for (const choice of choices) {
    const key = `${retailer}:${choice.productId}`;
    const existing = await getProductCategory(key);
    await putProductCategory({
      id: key,
      categoryId: choice.categoryId,
      confirmedByUser: true,
      timesSeen: (existing?.timesSeen ?? 0) + 1,
      lastSeen: new Date().toISOString(),
    });
  }
}

export async function approveTransaction(
  ynabTransactionId: string,
  items: ApprovalItem[],
): Promise<{ ok: true } | { error: string }> {
  try {
    const settings = await getSettings();
    if (!settings.ynabToken || !settings.planId) {
      return { error: "Not connected to YNAB" };
    }

    const tx = await getAllocatedTransaction(ynabTransactionId);
    if (!tx) {
      return { error: "Transaction not found — try syncing again" };
    }

    const update = isSingleCategory(items)
      ? { category_id: items[0].categoryId, approved: true }
      : { subtransactions: buildSubtransactions(tx, items), approved: true };

    await updateTransaction(settings.ynabToken, settings.planId, ynabTransactionId, update);

    await learnFromApproval(tx.retailer, items);

    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to approve transaction" };
  }
}

export async function approveBatch(
  ynabTransactionIds: string[],
): Promise<{ ok: true; errors: string[] } | { error: string }> {
  const errors: string[] = [];

  for (const ynabTxId of ynabTransactionIds) {
    const tx = await getAllocatedTransaction(ynabTxId);
    if (!tx) {
      errors.push(`${ynabTxId}: transaction not found`);
      continue;
    }

    // classifyItems only uses productId from each item; cast until Task 12 updates the signature.
    const classifiedItems = await classifyItems(tx.items as unknown as LineItem[], tx.retailer);

    // Skip if any item is uncategorized — partial approval would inflate categorized amounts
    const allCategorized = classifiedItems.every((ci) => ci.suggestedCategoryId !== null);
    if (!allCategorized) {
      errors.push(`${ynabTxId}: not all items have categories assigned`);
      continue;
    }

    const items: ApprovalItem[] = classifiedItems.map((ci) => ({
      productId: ci.productId,
      categoryId: ci.suggestedCategoryId!,
    }));

    const result = await approveTransaction(ynabTxId, items);
    if ("error" in result) {
      errors.push(`${ynabTxId}: ${result.error}`);
    }
  }

  return { ok: true, errors };
}
