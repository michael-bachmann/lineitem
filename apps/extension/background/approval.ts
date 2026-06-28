import { NOT_CONNECTED } from "@/lib/messages";
import { getSettings } from "@/lib/settings";
import { updateTransaction } from "@/lib/ynab";
import {
  getAllocatedTransaction,
  putLearnedProduct,
  getAllProductEmbeddings,
  putProductEmbedding,
  deleteProductEmbedding,
} from "@/lib/db";
import { classifyItems } from "@/lib/classifier";
import { embedBatch } from "./embedder";
import { planEviction, PER_CATEGORY_CAP } from "./embedding-eviction";
import type {
  AllocatedTransaction,
  ApprovalItem,
  LearnedProduct,
  ProductEmbedding,
} from "@/lib/types";
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

/**
 * One item being learned from an approval — its productId (joined with the
 * retailer to form the storage key inside learnFromApproval), the title we
 * store for later re-embedding, and the user's category choice.
 */
export interface LearnEntry {
  productId: string;
  title: string;
  categoryId: string;
}

/** Progress event emitted by learnFromApproval after each embedding chunk
 *  completes. `index` is the cumulative item count processed so far. */
export interface LearnProgress {
  index: number;
  total: number;
}

/** Chunk size for embedding during learn. Sized to give roughly one progress
 *  event every couple seconds on CPU (the model takes ~50-200ms per item),
 *  smooth enough for a progress bar without overwhelming the message channel. */
const LEARN_CHUNK_SIZE = 25;

/** Embed a chunk of titles; on failure, fall back to null per entry so the
 *  LearnedProduct row is still written (just without an embedding). Failures
 *  are per-chunk so one bad batch doesn't poison the others. */
async function safeEmbedBatch(titles: string[]): Promise<(Float32Array | null)[]> {
  try {
    return await embedBatch(titles);
  } catch (err) {
    console.warn("learnFromApproval: embedBatch failed; writing rows without vectors", err);
    return titles.map(() => null);
  }
}

function buildLearnedProduct(id: string, entry: LearnEntry): LearnedProduct {
  return { id, categoryId: entry.categoryId };
}

function buildProductEmbedding(
  id: string,
  entry: LearnEntry,
  embedding: Float32Array,
  now: string,
): ProductEmbedding {
  return {
    id,
    categoryId: entry.categoryId,
    title: entry.title,
    embedding,
    lastSeen: now,
  };
}

/**
 * Learn from this approval — write the cache row (forever) and the embedding
 * row (capped pool, evicted on overflow). When embedBatch fails, the cache
 * row still gets written; the embedding is just skipped for that entry.
 *
 * Embedding is chunked so a long approval (e.g. backfill, hundreds of items)
 * can stream progress to the caller. `onProgress` fires after each chunk
 * completes with the cumulative item count.
 */
export async function learnFromApproval(
  retailer: string,
  entries: readonly LearnEntry[],
  onProgress?: (p: LearnProgress) => void,
): Promise<void> {
  if (entries.length === 0) return;

  const total = entries.length;
  const embeddings: (Float32Array | null)[] = [];
  for (let i = 0; i < total; i += LEARN_CHUNK_SIZE) {
    const chunk = entries.slice(i, i + LEARN_CHUNK_SIZE);
    const chunkVectors = await safeEmbedBatch(chunk.map((e) => e.title));
    for (const v of chunkVectors) embeddings.push(v);
    onProgress?.({ index: Math.min(i + LEARN_CHUNK_SIZE, total), total });
  }
  const now = new Date().toISOString();

  // Cache writes go through unconditionally for every entry.
  const learnedRows = entries.map((entry) =>
    buildLearnedProduct(`${retailer}:${entry.productId}`, entry),
  );

  // Embedding writes are gated on having a vector. Plan eviction against
  // the existing embedding pool only.
  const embeddingRows = entries.flatMap((entry, i): ProductEmbedding[] => {
    const vec = embeddings[i];
    if (!vec) return [];
    return [buildProductEmbedding(`${retailer}:${entry.productId}`, entry, vec, now)];
  });
  const existingEmbeddings = await getAllProductEmbeddings();
  const { toDelete } = planEviction(existingEmbeddings, embeddingRows, PER_CATEGORY_CAP);

  await Promise.all(learnedRows.map(putLearnedProduct));
  await Promise.all(embeddingRows.map(putProductEmbedding));
  await Promise.all(toDelete.map(deleteProductEmbedding));
}

export async function approveTransaction(
  ynabTransactionId: string,
  items: ApprovalItem[],
): Promise<{ ok: true } | { error: string }> {
  try {
    const settings = await getSettings();
    if (!settings.accessToken || !settings.planId) {
      return { error: NOT_CONNECTED };
    }

    const tx = await getAllocatedTransaction(ynabTransactionId);
    if (!tx) {
      return { error: "Transaction not found — try syncing again" };
    }

    const update = isSingleCategory(items)
      ? { category_id: items[0].categoryId, approved: true }
      : { subtransactions: buildSubtransactions(tx, items), approved: true };

    await updateTransaction(settings.planId, ynabTransactionId, update);

    // Join each approved item's category choice with its title from the
    // persisted transaction. ApprovalItem only has (productId, categoryId);
    // titles live on tx.items, which is the authoritative scrape record.
    const categoryById = new Map(items.map((c) => [c.productId, c.categoryId]));
    const learnEntries: LearnEntry[] = tx.items.flatMap((it) => {
      const categoryId = categoryById.get(it.productId);
      return categoryId ? [{ productId: it.productId, title: it.title, categoryId }] : [];
    });
    await learnFromApproval(tx.retailer, learnEntries);

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
    // Isolate per-transaction: an unexpected throw (e.g. an IDB read in
    // getAllocatedTransaction/classifyItems) becomes this tx's error instead of
    // rejecting the whole batch — which, since the message dispatch doesn't
    // catch APPROVE_BATCH, would leave the side panel with no response at all.
    try {
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
    } catch (e) {
      errors.push(`${ynabTxId}: ${e instanceof Error ? e.message : "approval failed"}`);
    }
  }

  return { ok: true, errors };
}
