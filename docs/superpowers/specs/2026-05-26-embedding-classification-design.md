# Embedding-Based Item Classification — Design

Date: 2026-05-26
Linear: BAC-105

## Problem

After the exact-match `product_cache` tier, items with no prior categorization fall through to manual entry. The cache hits the same item twice but is useless on a first encounter — even when the title is obviously a variant of something the user has already categorized ("Charmin Ultra Strong Toilet Paper" arrives novel even if Bounty paper towels were filed under Household last week).

The result is that the worst UX moment — manual categorization of every novel item — also happens to be the case where the user has plenty of latent signal we're not using.

## Goal

Add a second classification tier that suggests categories for novel items based on semantic similarity to the user's previously approved items. Suggestions must:

- Be derived fully on-device. No remote API, no telemetry, no item titles leaving the browser.
- Be gated by a confidence threshold so we don't degrade trust with bad guesses.
- Be transparently labeled in the UI so the user knows which suggestions to scrutinize.
- Survive model upgrades without losing the user's learned data.

## Non-goals

- A keyword/regex rules tier. The motivating cases ("Bounty" vs "Charmin") are exactly where lexical matching fails.
- Cloud embedding APIs. Privacy stance is "nothing leaves the browser."
- A gloss editor / per-category user-authored hints. The backfill path (below) makes glosses unnecessary.
- Cross-user data sharing of any kind, including for model improvement.
- Re-scraping of past orders on every sync. Backfill is opt-in, runs once, deferrable.
- Heavy or premium model options (e.g., EmbeddingGemma). One model, shipped to all users.

## Approach

A cascade: `product_cache → embedding → uncategorized`.

The embedding tier:

1. **Embed once at approval time.** When a user approves an item into a category, compute the title's embedding and store it on the existing `ProductCategory` row alongside the source title. The same flow populates from the opt-in past-order backfill.
2. **Embed at classify time.** When `classifyItem` falls through the product cache, embed the incoming item's title and find the nearest stored vector.
3. **Score by max cosine, per category.** The set of "stored vectors" is every `ProductCategory` row that has an `embedding` field populated — there is no separate vector store. Compute cosine similarity (== dot product, since vectors are L2-normalized) between the incoming embedding and every stored vector. For each category, take its best-matching vector's cosine. The category with the highest score wins, gated by a threshold (~0.65 initial).
4. **Surface source in UI.** Whether a category was assigned via exact cache hit or via embedding similarity is visible at a glance on the item card; the matched past-title is shown in the detail view as a sanity check.

The product_cache tier is unchanged. If it hits, embedding work doesn't run.

## Model

`bge-small-en-v1.5`, quantized ONNX, loaded via `transformers.js`. 384-dim outputs, mean-pooled and L2-normalized so cosine similarity reduces to dot product.

- Trained with contrastive retrieval objective, which matches our query/corpus pattern (query: new item title; corpus: past titles).
- ~30 MB on disk, cached by transformers.js via the standard Cache API after first download.
- Inference cost on WASM: tens of ms per title, batchable.

Model is exposed via a `CURRENT_MODEL_VERSION` constant (`"bge-small-en-v1.5-q8"`). Changing this constant is what triggers a re-embed (see Versioning).

Runtime: WASM in the background service worker. The service worker may be killed between syncs; that's fine — the model file stays cached on disk, and re-init on next sync is on the order of 1–2 seconds, acceptable for the sync cadence. WebGPU is deliberately not pursued in v1; offscreen documents are not used.

## Data model

The existing `ProductCategory` row gains three fields:

```ts
export interface ProductCategory {
  id: string;                   // "{retailer}:{productId}"
  categoryId: string;           // YNAB category UUID
  confirmedByUser: boolean;
  timesSeen: number;
  lastSeen: string;
  // NEW:
  title: string;                // source text, retained for re-embed
  embedding?: Float32Array;     // 384 floats, L2-normalized; absent if embedder wasn't ready at write time
  embeddedAt?: string;          // ISO timestamp; absent iff embedding is absent
}
```

`title` is the source text the embedding was derived from. Retaining it is what makes versioning safe — any model bump can re-derive without needing to wait for the user to re-approve.

The global model version stamp lives in `browser.storage.local`, alongside existing settings (`ynabToken`, `planId`, `planName`):

```ts
// key: "vectorModelVersion"
"bge-small-en-v1.5-q8"
```

Compared to `CURRENT_MODEL_VERSION` on startup; mismatch triggers the migration. A separate IndexedDB object store would be overkill for a single string.

No `DB_VERSION` bump is required. Adding optional fields to `ProductCategory` doesn't need a schema migration — IndexedDB doesn't enforce row shape.

`ClassifiedItem["classificationSource"]` extends to:

```ts
classificationSource: "product_cache" | "embedding" | null;
```

For embedding suggestions, `ClassifiedItem` also carries the matched past title so the detail view can render the explanation:

```ts
matchedSource?: { title: string; cosine: number };  // only when source === "embedding"
```

## Where things run

**`classifyItem(item, retailer)`** (`lib/classifier.ts`):

```
1. product_cache lookup by "{retailer}:{productId}"   — current behavior
   if hit → return { categoryId, source: "product_cache" }
2. embed item.title via the embedder
3. compute cosine against all stored embeddings
4. per category, take max cosine
5. if best max ≥ THRESHOLD → return { categoryId, source: "embedding", matchedSource }
   else → return { categoryId: null, source: null }
```

Signature change: `classifyItem` currently takes `{ productId }`. It needs `title` too. Call site (`background/sync.ts:150-159`) already has the full `AllocatedItem`, so this is a localized change.

Per-sync cost (rough estimate, typical user with ~50 uncategorized items per sync and ~900 stored vectors): ~50 embed calls × ~30ms = ~1.5s, plus ~50 × 900 = ~45k cosine ops (well under 100ms). Negligible next to the existing scrape cost, which dominates sync wall time (each retailer order requires opening a tab, waiting for the page to load, parsing the DOM, and closing — typically 5–12 seconds per order). Embedding adds maybe 2–5% to total sync time. Cache-hit items skip embedding entirely.

**`learnFromApproval`** (`background/approval.ts`):

After writing the product_cache row, embed the title and write the embedding fields onto the same row. One IndexedDB transaction.

**Backfill** (new module, e.g. `background/backfill.ts`):

Triggered by an opt-in user action ("Backfill from past orders"). For each historical YNAB transaction whose payee maps to a supported retailer (Amazon, Whole Foods, Amazon Fresh) and which already has a categoryId, run the existing scrape pipeline, embed each scraped item's title, and write `ProductCategory` rows tagged with the transaction's existing categoryId (with `confirmedByUser = true`, `timesSeen = 1`). Sequential, with a per-order delay to avoid rate-limiting; progress reflected in UI.

Default scope: the last **12 months** of YNAB transactions. The confirmation step exposes the range and lets the user widen it ("all time") or narrow it ("last 6 months"). 12 months is a starting guess — it should cover enough variety to populate most categories without making the run prohibitively long, but we should be willing to revisit if real-world runs are too slow or too sparse.

**Model loader** (new module, e.g. `background/embedder.ts`):

A thin wrapper around the transformers.js package (current Hugging Face distribution). Lazy-initialized on first use within a service-worker lifetime. Exposes `embed(text: string): Promise<Float32Array>` and `embedBatch(texts: string[]): Promise<Float32Array[]>`. Returns mean-pooled, L2-normalized vectors so cosine reduces to dot product.

Approval-time embedding is best-effort: if the embedder isn't ready when `learnFromApproval` is called, the row is written without embedding fields and the approval succeeds. The embedding can be filled in later (next sync, or a small "embed any rows missing vectors" sweep on load).

## Per-category cap and eviction

Each YNAB category's vector pool is capped at **30 most-recent past titles** (by `lastSeen` on the row).

When `learnFromApproval` writes a new row and the destination category is at cap:

- If the (retailer, productId) already exists, overwrite — no eviction needed.
- Otherwise, find the oldest row in that category by `lastSeen` and delete it.

The cap is a ceiling, not a floor. Categories with fewer than 30 past items keep what they have. Categories that never see retailer purchases (rent, salary, etc.) stay empty and are never suggested by the embedding tier — which is correct: they're unreachable from item titles.

Implementation note: finding the oldest row in a category currently requires enumerating `productCategories` and filtering by `categoryId`. For ~1000 rows this is fine (single-digit ms). If the table grows materially beyond that or the eviction starts showing up in profiles, add a secondary index on `categoryId` to the `productCategories` store.

## Threshold

Initial value: **0.65** cosine similarity (where 1.0 = identical direction, 0.0 = orthogonal).

This is below the ticket's 0.85 suggestion. On a properly normalized bge-small model, genuinely-similar product titles cluster in 0.6–0.8 territory; 0.85 is too strict and would suppress most suggestions. The number is a tuning constant in code, not a user setting. Adjustable in a single-line change once we see real-world distributions.

If best max cosine < threshold → `classificationSource = null`, no suggestion shown. The cascade has effectively fallen through.

## Calibrating the threshold

0.65 is a guess. We don't know where bge-small's cosines actually land on this corpus, so the spec includes an empirical calibration path that lets us tune from real data rather than hand-wave a number.

**Always compute, only sometimes surface.** Even when the embedding tier doesn't suggest (best cosine below threshold), we still ran the scoring. The result is a per-classification record:

```ts
interface ClassificationLogEntry {
  title: string;
  topCategoryId: string;
  topCosine: number;
  secondCategoryId: string | null;  // runner-up, for close-call analysis
  secondCosine: number | null;
  threshold: number;
  decision: "suggested" | "below_threshold" | "no_vectors";
  // filled in later by learnFromApproval / approveTransaction:
  userApprovedCategoryId?: string;
  approvedAt?: string;
}
```

These are stored as a rolling log (~last 500 entries) in `browser.storage.local`, keyed by item id. When the user approves a transaction, we patch each item's log entry with the approved categoryId.

**Two diagnostic signals come out of this:**

- **Precision at threshold:** of the `suggested` entries, what fraction had `topCategoryId === userApprovedCategoryId`? Plotted as precision vs threshold — sweep from 0.5 to 0.85 and find the lowest threshold that maintains precision ≥ some bar (~0.85).
- **Missed recall:** of the `below_threshold` entries, how often was `topCategoryId === userApprovedCategoryId` (i.e., we had the right answer but suppressed it)? If this is high in the 0.55–0.65 band, the threshold is too strict.

**Surfacing the calibration tool.** A dev-only view in the side panel reads the log and renders:

- Histogram of `topCosine` for correct vs incorrect suggestions.
- Precision/recall curves over a threshold sweep.
- Recommendation: optimal threshold given current data.

Not production UX. Gated behind a debug toggle or a separate dev-build flag. The user looks at it occasionally; the constant in code gets adjusted in a single-line change.

**Why this design over fixed-from-the-start tuning:** we can't pre-calibrate without the corpus, and the corpus only exists after the embedding tier ships. Logging structures the chicken-and-egg into "ship at 0.65, log everything, recalibrate from live data within a few weeks."

## Versioning

A single key in `browser.storage.local`: `vectorModelVersion`.

On classifier startup (first time a sync triggers it):

```
1. read storage.vectorModelVersion (or null on first run)
2. if it does not equal CURRENT_MODEL_VERSION:
   - read all ProductCategory rows
   - for each, re-compute embedding from row.title via the active model
   - write the new embedding back
   - write storage.vectorModelVersion = CURRENT_MODEL_VERSION
3. proceed
```

For ~900 vectors (heavy user) at batched ~5ms each, migration completes in a few seconds. If interrupted (browser closed mid-migration), the next startup just re-runs from scratch — the read-and-re-write is idempotent.

Why one global stamp, not per-vector: the only realistic invalidation we need is "active model differs from stored vectors." Per-vector versioning would only matter for resume-where-you-left-off mid-migration or for running two models simultaneously. Neither is a thing we need.

Why we need a stamp at all (vs. checking embedding dim): different 384-dim models produce incompatible vector spaces. The dim check alone wouldn't catch a same-dim model swap.

## Backfill UX

Opt-in. Surfaced as a one-time card after install (deferrable) or accessible from settings.

Flow:

1. User clicks "Backfill from past orders for better suggestions."
2. Confirmation: "We'll scrape items from your past YNAB transactions in supported retailers and use them to improve category suggestions. This may take a few minutes and stays on your device."
3. Run: progress indicator ("Scraping order 30 of 200…"). Pauseable / cancellable.
4. Summary: "Backfilled 487 items across 18 categories."

The scrape pipeline is the same one used during normal sync. The only differences:
- Iterates a YNAB transaction set selected by date range and supported payee.
- Skips transactions where the user's category has been deleted from YNAB.
- Skips transactions that already have a corresponding `ProductCategory` row (idempotent across re-runs).
- Sequential with a configurable per-order delay (start at 2s) to avoid retailer rate-limiting.

Partial failures (a single order fails to scrape) are logged and skipped, not fatal.

## UI: classification source indicator

`ItemCard` gains a small leading icon based on `classificationSource`:

- `"product_cache"`: filled checkmark-style icon. Title attribute: "Previously categorized."
- `"embedding"`: outline / sparkle-style icon. Title attribute: "Suggested from similar items."
- `null`: existing uncategorized warning icon.

`DetailView`, when an item's `classificationSource === "embedding"`, renders one explanation line under the suggested category:

> *Suggested: Household — similar to your past "Bounty Quick-Size Paper Towels".*

Exact iconography and styling are implementation detail. The semantic three-state distinction is the design.

## Failure semantics

- **Model fails to download / load.** First-run only. Embedder reports failure; classifier silently falls through to `null` for all items until model is available. No item-level error blocks the sync; the user sees a one-line "Embedding model loading…" status in the side panel that resolves on its own.
- **Embed call throws during classification.** Per-item: log, fall through to `null`. Doesn't fail the whole sync.
- **Embed call throws during approval.** Write the `ProductCategory` row without the embedding fields. The row is still useful (product_cache hit on future syncs); embedding can be backfilled later when the model is available.
- **IndexedDB write fails.** Existing approval flow already handles this. Embedding fields are part of the same write — no new failure paths.

The principle: embedding-tier failures degrade to "no suggestion," never to "wrong suggestion" or "lost approval."

## Storage budget

| Item | Size |
|------|------|
| Model file (bge-small-en-v1.5-q8 ONNX), cached by transformers.js | ~30 MB |
| Per vector (384 floats + metadata + IndexedDB overhead) | ~3 KB |
| Vectors at typical user (30 categories × 20 past titles) | ~1.8 MB |
| Vectors at heavy user (50 categories × 30 past titles) | ~4.5 MB |

All-in: ~32–35 MB. The model file dominates. IndexedDB has no hard per-origin quota; effective limit is browser overall storage (GBs). We're nowhere near.

## Testing

Unit:
- `embed` returns a 384-dim, L2-normalized vector.
- Cosine of identical vectors == 1.0 ± epsilon; orthogonal vectors == 0.0; reversed == -1.0.
- Scoring function: max-per-category over a synthetic vector set returns the expected category.
- Threshold gate: best-cosine just below threshold → `null`; just above → suggestion.
- Eviction: writing past cap evicts oldest-by-lastSeen; overwrite of existing (retailer, productId) does not evict.
- Versioning: `vectorModelVersion` mismatch in `browser.storage.local` triggers re-embed; matching value is a no-op.
- Classification log: every classify call writes a log entry; approval patches the entry with `userApprovedCategoryId`; log is bounded at ~500 entries (oldest evicted).

Integration:
- Full sync flow with a seeded `ProductCategory` set: novel item with a clearly-similar past title gets the expected suggestion.
- Novel item with no similar past title falls through to `null`.
- Backfill happy path: walks N transactions, writes N item embeddings, marks resumable.

Manual:
- Approve an item → verify `ProductCategory` row has embedding fields populated.
- Bump `CURRENT_MODEL_VERSION` locally → relaunch extension → verify all rows re-embedded and `storage.vectorModelVersion` updated.
- Backfill against a real test YNAB account → spot-check suggestions on subsequent syncs.

## Out of scope (future work)

- Settings UI for tuning threshold.
- User-authored category glosses / a gloss editor (and the gloss tier they would feed).
- KNN scoring (currently max). Data path supports it; just a scoring-function swap.
- WebGPU acceleration path.
- Heavier opt-in models (EmbeddingGemma).
- Showing alternate suggestions ("Household 0.71, Groceries 0.68") in the detail view.
- Smart pruning by diversity rather than recency.
- Automatic re-backfill when a YNAB category is created mid-history.

## Risks

- **Model load reliability in MV3 service workers.** transformers.js v3 supports MV3 service workers with WASM, but the load path involves Cache API and dynamic import. If we hit unexpected MV3 restrictions, the documented fallback is an offscreen document. Worth validating with a small spike before deep integration.
- **Threshold calibration.** 0.65 is a guess. The "Calibrating the threshold" section above covers the mitigation: log every classification (including suppressed ones), join with user approvals, sweep the threshold from real data. The risk is that initial precision is bad enough to erode trust before we have data to recalibrate; mitigated somewhat by the explicit UI source indicator letting users see "this is a guess" at a glance.
- **Backfill rate-limiting.** Walking many past orders in a tight loop risks Amazon flagging the session. The 2s per-order delay is conservative; if Amazon's tolerance is unclear, we err slower. The backfill is opt-in so the user is choosing to spend the time.
- **Scoring bias.** Max scoring has no pool-size bias by construction, but it's also more sensitive to a single weird past title than KNN would be. If we see "one bad apple per category" failures, the pivot to KNN is a localized change.
- **Storage growth from non-capped paths.** The 30-per-category cap controls steady-state size, but if a backfill writes ahead of any caching logic, we could briefly overshoot during the run. Backfill writes go through the same eviction path as `learnFromApproval` to keep this in check.
