import { getSettings } from "@/lib/settings";
import { updateTransaction } from "@/lib/ynab";
import { getItemizedTransaction, getProductCategory, putProductCategory } from "@/lib/db";
import { classifyItems } from "@/lib/classifier";
import { distributeRemainder } from "@/lib/money";
import type { ItemizedTransaction, ApprovalItem } from "@/lib/types";

/** Check whether all items share the same category. */
function isSingleCategory(items: ApprovalItem[]): boolean {
  return items.every((item) => item.categoryId === items[0].categoryId);
}

/**
 * Build YNAB subtransactions with taxes/shipping distributed proportionally
 * across items. Uses order.amountCents as the total — this matches the YNAB
 * transaction amount since we matched on exact amount during sync.
 */
function buildSubtransactions(
  tx: ItemizedTransaction,
  items: ApprovalItem[],
): Array<{ amount: number; category_id: string | null; memo: string | null }> {
  // Refunds are positive (inflow), purchases negative (outflow)
  const sign = tx.isRefund ? 10 : -10;
  const toMilliunits = (cents: number) => cents * sign;

  const itemAmounts = items.map((item) => toMilliunits(item.price * item.quantity));
  const ynabAmount = toMilliunits(tx.amountCents);
  const itemsTotal = itemAmounts.reduce((sum, a) => sum + a, 0);
  const remainder = ynabAmount - itemsTotal;

  // Distribute taxes/shipping proportionally across items by their amount
  const adjustments = remainder !== 0
    ? distributeRemainder(itemAmounts, remainder)
    : itemAmounts.map(() => 0);

  return items.map((item, i) => ({
    amount: itemAmounts[i] + adjustments[i],
    category_id: item.categoryId as string | null,
    memo: item.title as string | null,
  }));
}

/** Learn from this approval — save product→category mappings for future classification. */
async function learnFromApproval(retailer: string, items: ApprovalItem[]): Promise<void> {
  for (const item of items) {
    const key = `${retailer}:${item.productId}`;
    const existing = await getProductCategory(key);
    await putProductCategory({
      id: key,
      categoryId: item.categoryId,
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

    const itemizedTx = await getItemizedTransaction(ynabTransactionId);
    if (!itemizedTx) {
      return { error: "Transaction not found — try syncing again" };
    }

    const update = isSingleCategory(items)
      ? { category_id: items[0].categoryId, approved: true }
      : { subtransactions: buildSubtransactions(itemizedTx, items), approved: true };

    await updateTransaction(settings.ynabToken, settings.planId, ynabTransactionId, update);

    await learnFromApproval(itemizedTx.retailer, items);

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
    const itemizedTx = await getItemizedTransaction(ynabTxId);
    if (!itemizedTx) {
      errors.push(`${ynabTxId}: transaction not found`);
      continue;
    }

    const classifiedItems = await classifyItems(itemizedTx.items, itemizedTx.retailer);

    // Skip if any item is uncategorized — partial approval would inflate categorized amounts
    const allCategorized = classifiedItems.every((ci) => ci.suggestedCategoryId !== null);
    if (!allCategorized) {
      errors.push(`${ynabTxId}: not all items have categories assigned`);
      continue;
    }

    const items: ApprovalItem[] = classifiedItems.map((ci) => ({
      productId: ci.productId,
      title: ci.title,
      price: ci.price,
      quantity: ci.quantity,
      categoryId: ci.suggestedCategoryId!,
    }));

    const result = await approveTransaction(ynabTxId, items);
    if ("error" in result) {
      errors.push(`${ynabTxId}: ${result.error}`);
    }
  }

  return { ok: true, errors };
}
