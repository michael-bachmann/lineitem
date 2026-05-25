import { getSettings } from "@/lib/settings";
import { updateTransaction } from "@/lib/ynab";
import { getAllocatedTransaction, getProductCategory, putProductCategory } from "@/lib/db";
import { classifyItems } from "@/lib/classifier";
import type { AllocatedTransaction, ApprovalItem } from "@/lib/types";
import { groupBy } from "remeda";

/** Check whether all items share the same category. */
function isSingleCategory(items: ApprovalItem[]): boolean {
  return items.length > 0 && items.every((item) => item.categoryId === items[0].categoryId);
}

const MEMO_MAX = 200;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function buildMemo(titles: string[]): string {
  if (titles.length === 0) return "";
  if (titles.length <= 3) {
    return truncate(titles.join(", "), MEMO_MAX);
  }
  const remainder = titles.length - 3;
  const suffix = ` +${remainder} more`;
  const head = truncate(titles.slice(0, 3).join(", "), MEMO_MAX - suffix.length);
  return head + suffix;
}

/**
 * Build YNAB subtransactions by joining the user's category choices to the
 * persisted AllocatedTransaction, then grouping items by category so that
 * each YNAB subline corresponds to one category (not one item). Amounts
 * are summed per group; memos list the items in the group.
 *
 * Callers (UI Approve button + approveBatch) gate against incomplete
 * choices, so every item is guaranteed to have a category id here.
 *
 * Per-item amounts come from item.allocatedCents — no recomputation here.
 */
export function buildSubtransactions(
  tx: AllocatedTransaction,
  choices: ApprovalItem[],
): Array<{ amount: number; category_id: string; memo: string | null }> {
  const sign = tx.isRefund ? 10 : -10; // YNAB milliunits; outflows negative
  const choiceById = new Map(choices.map((c) => [c.productId, c.categoryId]));

  const joined = tx.items.map((item) => ({
    item,
    categoryId: choiceById.get(item.productId)!,
  }));

  const byCategory = groupBy(joined, (j) => j.categoryId);

  return Object.entries(byCategory).map(([categoryId, members]) => ({
    amount: members.reduce((acc, { item }) => acc + item.allocatedCents * sign, 0),
    category_id: categoryId,
    memo: buildMemo(members.map(({ item }) => item.title)),
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

    const classifiedItems = await classifyItems(tx.items, tx.retailer);

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
