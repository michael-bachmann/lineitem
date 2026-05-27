import { chunk } from "remeda";
import { embedBatch, getCurrentModelVersion } from "./embedder";
import { getAllProductCategories, putProductCategory } from "@/lib/db";
import { getSettings, saveSettings } from "@/lib/settings";
import type { ProductCategory } from "@/lib/types";

const BATCH_SIZE = 16;

/** Re-embed a single batch of rows from their stored titles. */
async function reembedBatch(batch: readonly ProductCategory[], now: string): Promise<void> {
  const vecs = await embedBatch(batch.map((r) => r.title!));
  await Promise.all(
    batch.map((row, j) =>
      putProductCategory({ ...row, embedding: vecs[j], embeddedAt: now }),
    ),
  );
}

/**
 * If the stored vector model version differs from the active one, re-embed
 * every ProductCategory row from its stored title. Idempotent across crashes
 * (interruption just re-runs the migration on next startup).
 * Rows without a title are skipped — they're legacy and will get titles +
 * embeddings on their next approval.
 */
export async function migrateEmbeddingsIfNeeded(): Promise<void> {
  const settings = await getSettings();
  const current = getCurrentModelVersion();
  if (settings.vectorModelVersion === current) return;

  const allRows = await getAllProductCategories();
  const rowsWithTitle = allRows.filter(
    (r): r is ProductCategory & { title: string } =>
      typeof r.title === "string" && r.title.length > 0,
  );
  const batches = chunk(rowsWithTitle, BATCH_SIZE);
  const now = new Date().toISOString();

  // Batches run sequentially: each `embedBatch` call queues on the WASM
  // pipeline, and launching them concurrently would just serialize there.
  for (const batch of batches) {
    await reembedBatch(batch, now);
  }

  await saveSettings({ vectorModelVersion: current });
}
