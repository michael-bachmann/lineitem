# Embedding Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-device embedding-based classification tier (after `product_cache`, before uncategorized) so novel item titles get suggested categories based on semantic similarity to previously approved items.

**Architecture:** Cascade — `product_cache` → `embedding` → uncategorized. Embeddings come from `bge-small-en-v1.5` (q8 ONNX, 384-dim) via `transformers.js` running in the MV3 service worker. Stored on existing `ProductCategory` rows alongside the source title. Per-category vector pool capped at 50, max-cosine scoring, threshold-gated (~0.65). One-time opt-in past-order backfill bootstraps the pool. Versioning via a single `vectorModelVersion` key in `browser.storage.local`; mismatch triggers re-embed from stored titles.

**Tech Stack:** TypeScript, WXT (Chrome extension framework), React 19, IndexedDB (via `lib/db.ts`), `browser.storage.local`, `@huggingface/transformers` (transformers.js v3), Vitest, Tailwind v4, remeda.

---

## PR Breakdown

This plan is intentionally split across **five PRs** so each lands as a self-contained, reviewable change. Each PR's section below is self-contained and ships working code.

1. **PR 1 — Embedder foundation.** Adds the transformers.js wrapper, model proactive-download on install, math helpers (cosine, normalize), and the new optional fields on `ProductCategory`. No behavior change in classifier or approval. Mergeable on its own.
2. **PR 2 — Approval writes embeddings.** `learnFromApproval` writes embeddings + titles. Per-category cap-50 eviction. Versioning migration runs on extension startup. Storage starts accumulating data; classifier still ignores it.
3. **PR 3 — Classifier reads embeddings + UI source indicator.** `classifyItem` adds the embedding tier (max-per-category, threshold gate). `ClassifiedItem` type extended. UI: `ItemCard` shows 3-state source icon; `DetailView` renders "similar to your past X" line for embedding suggestions. Classification log writes (lightweight, just structured data) — enables future calibration. **This is the PR where the feature visibly turns on.**
4. **PR 4 — Past-order backfill.** Opt-in flow: walks N months of YNAB transactions, replays them through the existing scrape pipeline, writes embeddings. Settings-card entry point + progress UI.
5. **PR 5 — Calibration analysis (dev-only).** Side-panel view that reads the classification log, joins with approvals, plots precision/recall at threshold sweep. Gated behind a debug flag.

---

## File Structure

**New files:**

- `background/embedder.ts` — transformers.js wrapper. Exposes `embed(text)`, `embedBatch(texts[])`, `getCurrentModelVersion()`, `ensureModelLoaded()`. Lazy-init within service-worker lifetime.
- `lib/embeddings.ts` — pure math: `cosine(a, b)`, `l2Normalize(v)`, helpers for storing/reading `Float32Array` in IndexedDB rows.
- `lib/embeddings.test.ts` — unit tests.
- `background/embedder.test.ts` — unit tests for the wrapper (mock the transformers package).
- `background/embedding-eviction.ts` — pure eviction logic. Given current rows + a candidate, return `{toWrite, toDelete}`.
- `background/embedding-eviction.test.ts` — unit tests.
- `lib/classification-log.ts` — rolling log writer/reader against `browser.storage.local`.
- `lib/classification-log.test.ts` — unit tests.
- `background/backfill.ts` — past-order replay flow (PR 4).
- `background/backfill.test.ts` — unit tests (PR 4).
- `components/ClassificationIndicator.tsx` — small icon component for the 3-state source indicator (PR 3).
- `components/CalibrationView.tsx` — dev-only analysis view (PR 5).

**Modified files:**

- `lib/types.ts` — extend `ProductCategory` (new optional fields), extend `ClassifiedItem["classificationSource"]` union and add `matchedSource`.
- `lib/classifier.ts` — add embedding tier to `classifyItem`.
- `lib/db.ts` — no schema changes for the new optional fields; possibly add an `embedAllMissingProductCategories` helper used by approval-time best-effort fill.
- `background/approval.ts` — `learnFromApproval` writes embedding + title + uses eviction logic.
- `background/sync.ts` — call site for `classifyItem` already has `AllocatedItem` with title; minimal change to pass title through.
- `background/migrations.ts` (new helper file or inlined into a startup module) — model-version migration.
- `entrypoints/background.ts` — wire up: model proactive-download on install, migration on startup.
- `components/ItemCard.tsx` — render `ClassificationIndicator`.
- `components/DetailView.tsx` — render "similar to your past X" line.
- `lib/settings.ts` — add `vectorModelVersion` and (PR 5) `debugCalibration` keys.
- `wxt.config.ts` — add `host_permissions` for the Hugging Face CDN; CSP/manifest adjustments for WASM if needed.
- `package.json` — add `@huggingface/transformers` dependency.

---

# PR 1 — Embedder Foundation

Goal: ship the infrastructure to embed strings, with the model proactively downloaded on install. No classifier or approval behavior changes.

### Task 1.1 — Add the transformers.js dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add dependency**

```bash
pnpm add @huggingface/transformers@^3.0.0
```

- [ ] **Step 2: Verify install**

```bash
pnpm install
pnpm compile
```

Expected: install succeeds; type-check passes.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat(BAC-105): add @huggingface/transformers dependency"
```

---

### Task 1.2 — Pure math helpers

**Files:**
- Create: `lib/embeddings.ts`
- Create: `lib/embeddings.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/embeddings.test.ts
import { describe, expect, it } from "vitest";
import { cosine, l2Normalize, isNormalized } from "./embeddings";

describe("l2Normalize", () => {
  it("returns a unit vector", () => {
    const v = new Float32Array([3, 4]);
    const out = l2Normalize(v);
    expect(out[0]).toBeCloseTo(0.6, 5);
    expect(out[1]).toBeCloseTo(0.8, 5);
    expect(isNormalized(out)).toBe(true);
  });

  it("returns zero vector unchanged on zero input", () => {
    const v = new Float32Array([0, 0, 0]);
    const out = l2Normalize(v);
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });
});

describe("cosine", () => {
  it("identical normalized vectors → 1.0", () => {
    const v = l2Normalize(new Float32Array([1, 2, 3]));
    expect(cosine(v, v)).toBeCloseTo(1, 5);
  });

  it("orthogonal vectors → 0.0", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosine(a, b)).toBeCloseTo(0, 5);
  });

  it("opposite vectors → -1.0", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(cosine(a, b)).toBeCloseTo(-1, 5);
  });

  it("throws if dims mismatch", () => {
    expect(() => cosine(new Float32Array([1]), new Float32Array([1, 2]))).toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm test lib/embeddings.test.ts
```

Expected: imports fail (`embeddings.ts` does not exist yet).

- [ ] **Step 3: Implement**

```ts
// lib/embeddings.ts

/** Cosine similarity. Assumes equal length; throws otherwise. For L2-normalized
 * inputs this reduces to dot product, but we don't assume normalization here. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: dim mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

/** L2-normalize in-place semantics but returns a new Float32Array. */
export function l2Normalize(v: Float32Array): Float32Array {
  let sq = 0;
  for (let i = 0; i < v.length; i++) sq += v[i] * v[i];
  const norm = Math.sqrt(sq);
  if (norm === 0) return new Float32Array(v);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

const NORMALIZATION_EPSILON = 1e-3;

/** Check whether a vector is approximately L2-normalized (length ≈ 1.0). */
export function isNormalized(v: Float32Array): boolean {
  let sq = 0;
  for (let i = 0; i < v.length; i++) sq += v[i] * v[i];
  return Math.abs(Math.sqrt(sq) - 1) < NORMALIZATION_EPSILON;
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
pnpm test lib/embeddings.test.ts
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add lib/embeddings.ts lib/embeddings.test.ts
git commit -m "feat(BAC-105): cosine / l2Normalize math helpers"
```

---

### Task 1.3 — Extend `ProductCategory` type

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Locate the `ProductCategory` interface** (around line 17–28 in `lib/types.ts`).

- [ ] **Step 2: Add three optional fields**

Add these after `lastSeen`:

```ts
  /** Source text the embedding was derived from. Retained so we can re-embed
   *  if the model is upgraded without waiting for re-approval. */
  title?: string;
  /** 384-dim L2-normalized embedding vector. Absent if the embedder wasn't
   *  ready at write time; backfilled on next opportunity. */
  embedding?: Float32Array;
  /** ISO timestamp when this embedding was computed. Absent iff embedding is absent. */
  embeddedAt?: string;
```

The fields are optional so existing rows without them remain valid.

- [ ] **Step 3: Run type-check**

```bash
pnpm compile
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "feat(BAC-105): add title / embedding / embeddedAt to ProductCategory"
```

---

### Task 1.4 — Settings: add `vectorModelVersion`

**Files:**
- Modify: `lib/settings.ts`

- [ ] **Step 1: Update `lib/settings.ts`** — add the field to the interface and to the `SETTINGS_KEYS` constant so `getSettings()` returns it; `saveSettings` already accepts `Partial<Settings>`.

Replace the file with:

```ts
import { browser } from "wxt/browser";

export interface Settings {
  ynabToken: string | null;
  planId: string | null;
  planName: string | null;
  vectorModelVersion: string | null;
}

const SETTINGS_KEYS = ["ynabToken", "planId", "planName", "vectorModelVersion"] as const;

export async function getSettings(): Promise<Settings> {
  const result = await browser.storage.local.get([...SETTINGS_KEYS]);
  return {
    ynabToken: (result.ynabToken ?? null) as string | null,
    planId: (result.planId ?? null) as string | null,
    planName: (result.planName ?? null) as string | null,
    vectorModelVersion: (result.vectorModelVersion ?? null) as string | null,
  };
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  await browser.storage.local.set(settings);
}

export async function clearSettings(): Promise<void> {
  await browser.storage.local.remove([...SETTINGS_KEYS]);
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm compile
```

- [ ] **Step 3: Commit**

```bash
git add lib/settings.ts
git commit -m "feat(BAC-105): add vectorModelVersion to settings"
```

---

### Task 1.5 — Embedder module (unit-testable shape, mocked transformers)

**Files:**
- Create: `background/embedder.ts`
- Create: `background/embedder.test.ts`

- [ ] **Step 1: Write the embedder interface and tests against a mocked transformers package**

```ts
// background/embedder.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the transformers package before importing the module under test.
const pipelineMock = vi.fn();
vi.mock("@huggingface/transformers", () => ({
  pipeline: pipelineMock,
}));

import { embed, embedBatch, getCurrentModelVersion, _resetForTest } from "./embedder";

function makeNormalizedVec(dims = 384): Float32Array {
  const v = new Float32Array(dims);
  v[0] = 1; // unit vector along axis 0; cosine semantics still hold.
  return v;
}

function makePipelineFn() {
  return vi.fn(async (texts: string | string[], _opts: unknown) => {
    const arr = Array.isArray(texts) ? texts : [texts];
    const tensorData = new Float32Array(arr.length * 384);
    for (let i = 0; i < arr.length; i++) tensorData[i * 384] = 1;
    return { data: tensorData, dims: [arr.length, 384] };
  });
}

beforeEach(() => {
  _resetForTest();
  const pipeFn = makePipelineFn();
  pipelineMock.mockResolvedValue(pipeFn);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("embedder", () => {
  it("getCurrentModelVersion returns a stable string", () => {
    expect(getCurrentModelVersion()).toBe("bge-small-en-v1.5-q8");
  });

  it("embed() returns a 384-dim normalized Float32Array", async () => {
    const v = await embed("paper towels");
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(384);
    // First component dominates (set in mock), so v[0] ≈ 1 after normalization.
    expect(v[0]).toBeCloseTo(1, 5);
  });

  it("embedBatch() returns an array of 384-dim vectors", async () => {
    const vs = await embedBatch(["paper towels", "trash bags", "lightbulb"]);
    expect(vs).toHaveLength(3);
    for (const v of vs) {
      expect(v.length).toBe(384);
    }
  });

  it("embed() lazy-loads pipeline once across calls", async () => {
    await embed("a");
    await embed("b");
    await embed("c");
    expect(pipelineMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm test background/embedder.test.ts
```

- [ ] **Step 3: Implement `background/embedder.ts`**

```ts
// background/embedder.ts
import { pipeline } from "@huggingface/transformers";
import { l2Normalize } from "@/lib/embeddings";

const MODEL_ID = "Xenova/bge-small-en-v1.5";
const MODEL_VERSION = "bge-small-en-v1.5-q8";
const EMBEDDING_DIMS = 384;

type FeatureExtractor = (
  texts: string | string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_ID, {
      quantized: true,
    }) as unknown as Promise<FeatureExtractor>;
  }
  return extractorPromise;
}

export function getCurrentModelVersion(): string {
  return MODEL_VERSION;
}

export async function ensureModelLoaded(): Promise<void> {
  await getExtractor();
}

function unpackBatch(data: Float32Array, batchSize: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let i = 0; i < batchSize; i++) {
    const slice = data.slice(i * EMBEDDING_DIMS, (i + 1) * EMBEDDING_DIMS);
    out.push(l2Normalize(slice));
  }
  return out;
}

export async function embed(text: string): Promise<Float32Array> {
  const extractor = await getExtractor();
  const result = await extractor(text, { pooling: "mean", normalize: true });
  return l2Normalize(result.data.slice(0, EMBEDDING_DIMS));
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const result = await extractor(texts, { pooling: "mean", normalize: true });
  return unpackBatch(result.data, texts.length);
}

/** @internal — for tests only. */
export function _resetForTest(): void {
  extractorPromise = null;
}
```

- [ ] **Step 4: Run tests, expect pass**

```bash
pnpm test background/embedder.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add background/embedder.ts background/embedder.test.ts
git commit -m "feat(BAC-105): embedder module wrapping transformers.js"
```

---

### Task 1.6 — Proactive download on install

**Files:**
- Modify: `entrypoints/background.ts`
- Modify: `wxt.config.ts`

- [ ] **Step 1: Check current `entrypoints/background.ts` shape and existing onInstalled handlers**

```bash
cat entrypoints/background.ts
```

- [ ] **Step 2: Add host permissions for Hugging Face CDN** to `wxt.config.ts`:

```ts
  manifest: {
    name: "Itemize",
    description: "Match YNAB transactions to Amazon orders and categorize line items",
    permissions: ["storage", "sidePanel", "tabs"],
    host_permissions: [
      "https://*.amazon.com/*",
      "https://api.ynab.com/*",
      "https://huggingface.co/*",        // NEW: model metadata
      "https://*.huggingface.co/*",      // NEW: model file CDN (cdn-lfs.huggingface.co)
    ],
  },
```

- [ ] **Step 3: Add proactive download to background script**

In `entrypoints/background.ts`, find or add the `browser.runtime.onInstalled` listener and trigger the model load there:

```ts
import { ensureModelLoaded } from "@/background/embedder";

browser.runtime.onInstalled.addListener(() => {
  // Fire-and-forget: model file is cached by transformers.js after this.
  // Failure is non-fatal — classifier degrades to product_cache-only.
  ensureModelLoaded().catch((err) => {
    console.warn("Initial embedder load failed; will retry on first use", err);
  });
});
```

- [ ] **Step 4: Type-check**

```bash
pnpm compile
```

- [ ] **Step 5: Manual smoke (optional but recommended)**

```bash
pnpm dev
```

In Chrome, load the unpacked extension, open `chrome://extensions` → Inspect background service worker → check Network for `huggingface.co` requests on install.

- [ ] **Step 6: Commit**

```bash
git add entrypoints/background.ts wxt.config.ts
git commit -m "feat(BAC-105): proactive model download on extension install"
```

---

### Task 1.7 — Open PR 1

- [ ] **Step 1: Push branch**

```bash
git push -u origin <branch>
```

- [ ] **Step 2: Open PR**

Title: `feat: embedder foundation (BAC-105 part 1)`
Body summary: "Adds the transformers.js wrapper + math helpers + new optional fields on ProductCategory + proactive model download on install. No classifier or approval behavior changes; sets up the infrastructure for parts 2–5."

---

# PR 2 — Approval Writes Embeddings

Goal: every approval starts writing the embedding (and title) onto the `ProductCategory` row. Per-category cap=50 with recency eviction. Versioning migration runs on startup. Classifier still ignores the data.

### Task 2.1 — Eviction logic (pure function, TDD)

**Files:**
- Create: `background/embedding-eviction.ts`
- Create: `background/embedding-eviction.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// background/embedding-eviction.test.ts
import { describe, expect, it } from "vitest";
import { planEviction } from "./embedding-eviction";
import type { ProductCategory } from "@/lib/types";

const PER_CATEGORY_CAP = 50;

function row(id: string, categoryId: string, lastSeen: string): ProductCategory {
  return {
    id,
    categoryId,
    confirmedByUser: true,
    timesSeen: 1,
    lastSeen,
    title: id,
  };
}

describe("planEviction", () => {
  it("no eviction needed when category is below cap", () => {
    const existing = [
      row("amazon:A", "cat1", "2026-01-01T00:00:00Z"),
      row("amazon:B", "cat1", "2026-01-02T00:00:00Z"),
    ];
    const result = planEviction(existing, "cat1", "amazon:NEW", PER_CATEGORY_CAP);
    expect(result.toDelete).toEqual([]);
  });

  it("overwriting an existing (retailer, productId) does not evict", () => {
    const existing = Array.from({ length: PER_CATEGORY_CAP }, (_, i) =>
      row(`amazon:item${i}`, "cat1", `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
    );
    const result = planEviction(existing, "cat1", "amazon:item5", PER_CATEGORY_CAP);
    expect(result.toDelete).toEqual([]);
  });

  it("evicts oldest-by-lastSeen when new item would exceed cap", () => {
    const existing = Array.from({ length: PER_CATEGORY_CAP }, (_, i) =>
      row(`amazon:item${i}`, "cat1", `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
    );
    const result = planEviction(existing, "cat1", "amazon:NEW", PER_CATEGORY_CAP);
    expect(result.toDelete).toEqual(["amazon:item0"]);
  });

  it("ignores rows in other categories when computing cap", () => {
    const existing = [
      ...Array.from({ length: PER_CATEGORY_CAP }, (_, i) => row(`amazon:other${i}`, "catOther", "2025-01-01T00:00:00Z")),
      row("amazon:A", "cat1", "2026-01-01T00:00:00Z"),
    ];
    const result = planEviction(existing, "cat1", "amazon:NEW", PER_CATEGORY_CAP);
    expect(result.toDelete).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm test background/embedding-eviction.test.ts
```

- [ ] **Step 3: Implement**

```ts
// background/embedding-eviction.ts
import type { ProductCategory } from "@/lib/types";

export interface EvictionPlan {
  toDelete: string[];  // ids of rows to delete
}

/**
 * Decide which rows to evict before writing a new entry into a category.
 * If the incoming id already exists, it overwrites in place (no eviction).
 * Otherwise, if the destination category is at cap, evict the oldest by lastSeen.
 */
export function planEviction(
  existing: ProductCategory[],
  destinationCategoryId: string,
  incomingId: string,
  cap: number,
): EvictionPlan {
  const incomingExists = existing.some((r) => r.id === incomingId);
  if (incomingExists) return { toDelete: [] };

  const inCategory = existing.filter((r) => r.categoryId === destinationCategoryId);
  if (inCategory.length < cap) return { toDelete: [] };

  const oldest = inCategory.reduce((a, b) => (a.lastSeen < b.lastSeen ? a : b));
  return { toDelete: [oldest.id] };
}

export const PER_CATEGORY_CAP = 50;
```

- [ ] **Step 4: Run tests, expect pass**

- [ ] **Step 5: Commit**

```bash
git add background/embedding-eviction.ts background/embedding-eviction.test.ts
git commit -m "feat(BAC-105): per-category eviction logic"
```

---

### Task 2.2 — `db.ts` helpers: list all + delete

**Files:**
- Modify: `lib/db.ts`

- [ ] **Step 1: Add `getAllProductCategories` and `deleteProductCategory`**

Add after `putProductCategory`:

```ts
export async function getAllProductCategories(): Promise<ProductCategory[]> {
  const store = await getStore("productCategories");
  return requestToPromise(store.getAll());
}

export async function deleteProductCategory(id: string): Promise<void> {
  const store = await getStore("productCategories", "readwrite");
  await requestToPromise(store.delete(id));
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm compile
```

- [ ] **Step 3: Commit**

```bash
git add lib/db.ts
git commit -m "feat(BAC-105): db helpers — getAll / delete product category"
```

---

### Task 2.3 — Wire embeddings into `learnFromApproval`

**Files:**
- Modify: `background/approval.ts`
- Modify: `background/approval.test.ts` (existing — augment with new cases)

- [ ] **Step 1: Read current approval test file**

```bash
cat background/approval.test.ts
```

- [ ] **Step 2: Add a test for the new behavior** (write embedding + title on approval; evict when over cap)

Append to `background/approval.test.ts` (follow the existing mocking style; this is the shape):

```ts
// At top, alongside other mocks
vi.mock("@/background/embedder", () => ({
  embedBatch: vi.fn(async (texts: string[]) => {
    return texts.map((_, i) => {
      const v = new Float32Array(384);
      v[i % 384] = 1;
      return v;
    });
  }),
  ensureModelLoaded: vi.fn(async () => {}),
  getCurrentModelVersion: () => "bge-small-en-v1.5-q8",
}));

// In a new describe block:
describe("learnFromApproval writes embeddings", () => {
  it("writes title + embedding + embeddedAt on each approved item", async () => {
    // … set up an AllocatedTransaction with two items, approve, then read
    // the resulting ProductCategory rows and assert fields are populated.
  });

  it("falls back to writing the row without embedding fields if embedBatch throws", async () => {
    // mock embedBatch to reject; approval still succeeds; row exists with title but no embedding
  });
});
```

(Engineer note: fill the test bodies using the same `putAllocatedTransactions` + `approveTransaction` calls the existing tests use.)

- [ ] **Step 3: Run, expect fail**

```bash
pnpm test background/approval.test.ts
```

- [ ] **Step 4: Update `learnFromApproval`**

```ts
// background/approval.ts — updated learnFromApproval signature & body

import { embedBatch } from "./embedder";
import { planEviction, PER_CATEGORY_CAP } from "./embedding-eviction";
import {
  deleteProductCategory,
  getAllProductCategories,
  getProductCategory,
  putProductCategory,
} from "@/lib/db";

interface LearnInput {
  retailer: string;
  // Pull title from the AllocatedTransaction so we don't change ApprovalItem shape.
  itemsByProductId: Map<string, { title: string; categoryId: string }>;
}

async function learnFromApproval(input: LearnInput): Promise<void> {
  const entries = [...input.itemsByProductId.entries()];
  const titles = entries.map(([, v]) => v.title);

  let embeddings: (Float32Array | null)[];
  try {
    const vecs = await embedBatch(titles);
    embeddings = vecs;
  } catch (err) {
    console.warn("learnFromApproval: embedBatch failed; writing rows without vectors", err);
    embeddings = entries.map(() => null);
  }

  // Compute eviction plan once against a snapshot to keep IndexedDB writes bounded.
  const allExisting = await getAllProductCategories();
  const evictionsByCategory = new Map<string, Set<string>>();

  for (let i = 0; i < entries.length; i++) {
    const [productId, { title, categoryId }] = entries[i];
    const id = `${input.retailer}:${productId}`;
    const existing = await getProductCategory(id);
    const plan = planEviction(allExisting, categoryId, id, PER_CATEGORY_CAP);
    for (const evictId of plan.toDelete) {
      const set = evictionsByCategory.get(categoryId) ?? new Set();
      set.add(evictId);
      evictionsByCategory.set(categoryId, set);
    }

    const now = new Date().toISOString();
    const row = {
      id,
      categoryId,
      confirmedByUser: true,
      timesSeen: (existing?.timesSeen ?? 0) + 1,
      lastSeen: now,
      title,
      ...(embeddings[i]
        ? { embedding: embeddings[i]!, embeddedAt: now }
        : {}),
    };
    await putProductCategory(row);
  }

  for (const ids of evictionsByCategory.values()) {
    for (const id of ids) {
      await deleteProductCategory(id);
    }
  }
}
```

- [ ] **Step 5: Update the call site in `approveTransaction`**

Replace the existing `await learnFromApproval(tx.retailer, items)` line with:

```ts
const titleByProductId = new Map(tx.items.map((it) => [it.productId, it.title]));
const itemsByProductId = new Map(
  items.map((c) => [
    c.productId,
    {
      title: titleByProductId.get(c.productId) ?? "",
      categoryId: c.categoryId,
    },
  ]),
);
await learnFromApproval({ retailer: tx.retailer, itemsByProductId });
```

- [ ] **Step 6: Run tests, expect pass**

```bash
pnpm test background/approval.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add background/approval.ts background/approval.test.ts
git commit -m "feat(BAC-105): write title + embedding on approval, with eviction"
```

---

### Task 2.4 — Versioning migration on startup

**Files:**
- Create: `background/embedding-migration.ts`
- Create: `background/embedding-migration.test.ts`
- Modify: `entrypoints/background.ts`

- [ ] **Step 1: Write failing tests for `migrateEmbeddingsIfNeeded`**

```ts
// background/embedding-migration.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/background/embedder", () => ({
  embedBatch: vi.fn(async (texts: string[]) => {
    return texts.map(() => {
      const v = new Float32Array(384);
      v[0] = 1;
      return v;
    });
  }),
  getCurrentModelVersion: () => "bge-small-en-v1.5-q8",
}));

const settingsStore = new Map<string, string>();
vi.mock("@/lib/settings", () => ({
  getSettings: vi.fn(async () => ({
    ynabToken: null,
    planId: null,
    planName: null,
    vectorModelVersion: settingsStore.get("vectorModelVersion") ?? null,
  })),
  saveSettings: vi.fn(async (patch: Record<string, string>) => {
    for (const [k, v] of Object.entries(patch)) settingsStore.set(k, v);
  }),
}));

// Simple in-memory ProductCategory store mock
import * as db from "@/lib/db";
import type { ProductCategory } from "@/lib/types";
const storeRows = new Map<string, ProductCategory>();
vi.spyOn(db, "getAllProductCategories").mockImplementation(async () => [...storeRows.values()]);
vi.spyOn(db, "putProductCategory").mockImplementation(async (r) => {
  storeRows.set(r.id, r);
});

import { migrateEmbeddingsIfNeeded } from "./embedding-migration";

beforeEach(() => {
  storeRows.clear();
  settingsStore.clear();
});

describe("migrateEmbeddingsIfNeeded", () => {
  it("no-op when stored version matches current", async () => {
    settingsStore.set("vectorModelVersion", "bge-small-en-v1.5-q8");
    storeRows.set("amazon:A", {
      id: "amazon:A",
      categoryId: "cat1",
      confirmedByUser: true,
      timesSeen: 1,
      lastSeen: "2026-01-01",
      title: "Paper towels",
      embedding: new Float32Array(384),
      embeddedAt: "2026-01-01",
    });
    const before = storeRows.get("amazon:A")!.embedding;
    await migrateEmbeddingsIfNeeded();
    expect(storeRows.get("amazon:A")!.embedding).toBe(before); // not rewritten
  });

  it("re-embeds when version mismatches", async () => {
    settingsStore.set("vectorModelVersion", "old-version");
    storeRows.set("amazon:A", {
      id: "amazon:A",
      categoryId: "cat1",
      confirmedByUser: true,
      timesSeen: 1,
      lastSeen: "2026-01-01",
      title: "Paper towels",
      embedding: new Float32Array(384), // zeros
      embeddedAt: "2026-01-01",
    });
    await migrateEmbeddingsIfNeeded();
    expect(storeRows.get("amazon:A")!.embedding![0]).toBe(1); // re-embedded
    expect(settingsStore.get("vectorModelVersion")).toBe("bge-small-en-v1.5-q8");
  });

  it("first-run (no stored version) re-embeds and sets the stamp", async () => {
    storeRows.set("amazon:A", {
      id: "amazon:A",
      categoryId: "cat1",
      confirmedByUser: true,
      timesSeen: 1,
      lastSeen: "2026-01-01",
      title: "Paper towels",
    });
    await migrateEmbeddingsIfNeeded();
    expect(storeRows.get("amazon:A")!.embedding).toBeDefined();
    expect(settingsStore.get("vectorModelVersion")).toBe("bge-small-en-v1.5-q8");
  });

  it("skips rows without a title (defensive)", async () => {
    settingsStore.set("vectorModelVersion", "old");
    storeRows.set("amazon:legacy", {
      id: "amazon:legacy",
      categoryId: "cat1",
      confirmedByUser: true,
      timesSeen: 1,
      lastSeen: "2026-01-01",
    });
    await migrateEmbeddingsIfNeeded();
    expect(storeRows.get("amazon:legacy")!.embedding).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm test background/embedding-migration.test.ts
```

- [ ] **Step 3: Implement**

```ts
// background/embedding-migration.ts
import { embedBatch, getCurrentModelVersion } from "./embedder";
import { getAllProductCategories, putProductCategory } from "@/lib/db";
import { getSettings, saveSettings } from "@/lib/settings";

const BATCH_SIZE = 16;

/**
 * If the stored vector model version differs from the active one, re-embed
 * every ProductCategory row from its stored title. Idempotent across crashes.
 * Rows without a title are skipped — they're legacy and will get titles +
 * embeddings on their next approval.
 */
export async function migrateEmbeddingsIfNeeded(): Promise<void> {
  const settings = await getSettings();
  const current = getCurrentModelVersion();
  if (settings.vectorModelVersion === current) return;

  const allRows = await getAllProductCategories();
  const rowsWithTitle = allRows.filter((r) => typeof r.title === "string" && r.title.length > 0);

  for (let i = 0; i < rowsWithTitle.length; i += BATCH_SIZE) {
    const batch = rowsWithTitle.slice(i, i + BATCH_SIZE);
    const vecs = await embedBatch(batch.map((r) => r.title!));
    const now = new Date().toISOString();
    for (let j = 0; j < batch.length; j++) {
      await putProductCategory({
        ...batch[j],
        embedding: vecs[j],
        embeddedAt: now,
      });
    }
  }

  await saveSettings({ vectorModelVersion: current });
}
```

- [ ] **Step 4: Wire into background startup**

In `entrypoints/background.ts`, add a one-shot run on extension start. The service worker may restart often, so guard against running multiple times in a single worker lifetime:

```ts
import { migrateEmbeddingsIfNeeded } from "@/background/embedding-migration";

let migrationDone: Promise<void> | null = null;
function ensureMigrated(): Promise<void> {
  if (!migrationDone) {
    migrationDone = migrateEmbeddingsIfNeeded().catch((err) => {
      console.warn("Embedding migration failed; will retry on next worker start", err);
      migrationDone = null;
    });
  }
  return migrationDone;
}

// Call from places that need vectors to be current. The simplest entry point
// is at the start of sync; add it there in PR 3 when classifier reads vectors.
// For PR 2, also run it on extension start so backgrounded users migrate
// without needing a sync.
browser.runtime.onStartup.addListener(() => {
  ensureMigrated();
});
browser.runtime.onInstalled.addListener(() => {
  ensureMigrated();
});

// Export for PR 3 to call from sync entrypoint:
export { ensureMigrated };
```

- [ ] **Step 5: Run tests, type-check**

```bash
pnpm test
pnpm compile
```

- [ ] **Step 6: Commit**

```bash
git add background/embedding-migration.ts background/embedding-migration.test.ts entrypoints/background.ts
git commit -m "feat(BAC-105): re-embed migration on model version bump"
```

---

### Task 2.5 — Open PR 2

- [ ] **Step 1: Push branch, open PR**

Title: `feat: write embeddings on approval + version migration (BAC-105 part 2)`
Body: "Builds on part 1. Every approval now writes title + embedding onto ProductCategory rows, with cap-50 recency eviction per category. Model-version stamp lives in browser.storage.local; mismatch triggers a re-embed migration from stored titles on startup. Classifier still ignores the new data — part 3 turns the cascade on."

---

# PR 3 — Classifier Reads Embeddings + UI Source Indicator

Goal: the embedding tier becomes active. `classifyItem` returns embedding-based suggestions when the cache misses. UI shows source indicator. Classification log starts collecting data for future calibration.

### Task 3.1 — Extend `ClassifiedItem` type

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Update the `classificationSource` union and add `matchedSource`**

Find the `ClassifiedItem` interface and update:

```ts
export interface ClassifiedItem extends AllocatedItem {
  suggestedCategoryId: string | null;
  classificationSource: "product_cache" | "embedding" | null;
  /** Only set when classificationSource === "embedding". The nearest past
   *  title and its cosine, used for the UI "similar to your past X" hint. */
  matchedSource?: { title: string; cosine: number };
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm compile
```

Expect failures at call sites that construct `ClassifiedItem` — fix them by adding `matchedSource: undefined` or leaving it off (it's optional). Find call sites:

```bash
grep -rn "classificationSource" lib background components --include='*.ts' --include='*.tsx'
```

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat(BAC-105): extend ClassifiedItem with embedding source"
```

---

### Task 3.2 — Scoring function (max cosine per category, threshold gate)

**Files:**
- Create: `lib/embedding-scoring.ts`
- Create: `lib/embedding-scoring.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/embedding-scoring.test.ts
import { describe, expect, it } from "vitest";
import { scoreEmbedding } from "./embedding-scoring";
import { l2Normalize } from "./embeddings";
import type { ProductCategory } from "./types";

function row(id: string, categoryId: string, title: string, vec: Float32Array): ProductCategory {
  return {
    id,
    categoryId,
    confirmedByUser: true,
    timesSeen: 1,
    lastSeen: "2026-01-01",
    title,
    embedding: vec,
    embeddedAt: "2026-01-01",
  };
}

function vec(values: number[]): Float32Array {
  return l2Normalize(new Float32Array(values));
}

describe("scoreEmbedding", () => {
  const THRESHOLD = 0.65;

  it("returns null when no rows have embeddings", () => {
    const result = scoreEmbedding(vec([1, 0, 0]), [], THRESHOLD);
    expect(result).toBeNull();
  });

  it("returns the category whose best vector has the highest cosine, above threshold", () => {
    const rows = [
      row("a:1", "household", "paper towels", vec([1, 0.1, 0])),
      row("a:2", "household", "trash bags", vec([0.2, 1, 0])),
      row("a:3", "groceries", "bread", vec([0, 0, 1])),
    ];
    const result = scoreEmbedding(vec([1, 0, 0]), rows, THRESHOLD);
    expect(result?.categoryId).toBe("household");
    expect(result?.cosine).toBeGreaterThan(THRESHOLD);
    expect(result?.matchedTitle).toBe("paper towels");
  });

  it("returns null when best cosine is below threshold", () => {
    const rows = [row("a:1", "household", "paper towels", vec([0, 1, 0]))];
    const result = scoreEmbedding(vec([1, 0, 0]), rows, THRESHOLD);
    expect(result).toBeNull();
  });

  it("ignores rows without embeddings", () => {
    const rows: ProductCategory[] = [
      {
        id: "a:1",
        categoryId: "household",
        confirmedByUser: true,
        timesSeen: 1,
        lastSeen: "2026-01-01",
        title: "paper towels",
      },
    ];
    const result = scoreEmbedding(vec([1, 0, 0]), rows, THRESHOLD);
    expect(result).toBeNull();
  });

  it("returns the runner-up category for log/diagnostic purposes", () => {
    const rows = [
      row("a:1", "household", "paper towels", vec([1, 0.1, 0])),
      row("a:2", "groceries", "bread", vec([0.7, 0.5, 0])),
    ];
    const result = scoreEmbedding(vec([1, 0, 0]), rows, THRESHOLD);
    expect(result?.second?.categoryId).toBe("groceries");
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```ts
// lib/embedding-scoring.ts
import { cosine } from "./embeddings";
import type { ProductCategory } from "./types";

export interface ScoreResult {
  categoryId: string;
  cosine: number;
  matchedTitle: string;
  second: { categoryId: string; cosine: number } | null;
}

export interface FullScoreResult {
  /** Always populated even when below threshold — used for logs. */
  topCategoryId: string;
  topCosine: number;
  topMatchedTitle: string;
  secondCategoryId: string | null;
  secondCosine: number | null;
}

/**
 * Score an incoming embedding against all stored vectors. Per category,
 * keep the best matching vector's cosine. Pick the global winner if above
 * threshold, otherwise return null. Stored rows without an `embedding` field
 * are ignored.
 */
export function scoreEmbedding(
  query: Float32Array,
  rows: ProductCategory[],
  threshold: number,
): ScoreResult | null {
  const full = scoreEmbeddingFull(query, rows);
  if (!full) return null;
  if (full.topCosine < threshold) return null;
  return {
    categoryId: full.topCategoryId,
    cosine: full.topCosine,
    matchedTitle: full.topMatchedTitle,
    second:
      full.secondCategoryId !== null
        ? { categoryId: full.secondCategoryId, cosine: full.secondCosine! }
        : null,
  };
}

/** Variant that always returns the full picture (for log entries). */
export function scoreEmbeddingFull(
  query: Float32Array,
  rows: ProductCategory[],
): FullScoreResult | null {
  // Per-category best vector
  const bestByCategory = new Map<string, { cosine: number; title: string }>();
  for (const row of rows) {
    if (!row.embedding) continue;
    const c = cosine(query, row.embedding);
    const cur = bestByCategory.get(row.categoryId);
    if (!cur || c > cur.cosine) {
      bestByCategory.set(row.categoryId, { cosine: c, title: row.title ?? "" });
    }
  }
  if (bestByCategory.size === 0) return null;

  const sorted = [...bestByCategory.entries()].sort(
    (a, b) => b[1].cosine - a[1].cosine,
  );
  const [topCat, top] = sorted[0];
  const second = sorted[1];
  return {
    topCategoryId: topCat,
    topCosine: top.cosine,
    topMatchedTitle: top.title,
    secondCategoryId: second ? second[0] : null,
    secondCosine: second ? second[1].cosine : null,
  };
}

export const EMBEDDING_THRESHOLD = 0.65;
```

- [ ] **Step 4: Run tests, expect pass**

- [ ] **Step 5: Commit**

```bash
git add lib/embedding-scoring.ts lib/embedding-scoring.test.ts
git commit -m "feat(BAC-105): max-per-category scoring + threshold gate"
```

---

### Task 3.3 — Classification log

**Files:**
- Create: `lib/classification-log.ts`
- Create: `lib/classification-log.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// lib/classification-log.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, unknown>();
vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) storage.set(k, v);
        }),
      },
    },
  },
}));

import { appendLogEntry, readLog, patchApproval, LOG_MAX } from "./classification-log";

beforeEach(() => {
  storage.clear();
});

describe("classification log", () => {
  it("appends and reads back entries", async () => {
    await appendLogEntry({
      id: "amazon:A",
      title: "paper towels",
      topCategoryId: "household",
      topCosine: 0.8,
      secondCategoryId: null,
      secondCosine: null,
      threshold: 0.65,
      decision: "suggested",
      createdAt: "2026-01-01T00:00:00Z",
    });
    const log = await readLog();
    expect(log).toHaveLength(1);
    expect(log[0].title).toBe("paper towels");
  });

  it("evicts oldest beyond LOG_MAX entries", async () => {
    for (let i = 0; i < LOG_MAX + 5; i++) {
      await appendLogEntry({
        id: `amazon:item${i}`,
        title: `item ${i}`,
        topCategoryId: "household",
        topCosine: 0.7,
        secondCategoryId: null,
        secondCosine: null,
        threshold: 0.65,
        decision: "suggested",
        createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      });
    }
    const log = await readLog();
    expect(log).toHaveLength(LOG_MAX);
    expect(log[0].id).toBe(`amazon:item5`); // first 5 evicted
  });

  it("patches an entry with user's approved category", async () => {
    await appendLogEntry({
      id: "amazon:A",
      title: "paper towels",
      topCategoryId: "household",
      topCosine: 0.8,
      secondCategoryId: null,
      secondCosine: null,
      threshold: 0.65,
      decision: "suggested",
      createdAt: "2026-01-01T00:00:00Z",
    });
    await patchApproval("amazon:A", { userApprovedCategoryId: "household", approvedAt: "2026-01-02" });
    const log = await readLog();
    expect(log[0].userApprovedCategoryId).toBe("household");
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement**

```ts
// lib/classification-log.ts
import { browser } from "wxt/browser";

export const LOG_MAX = 500;
const STORAGE_KEY = "classificationLog";

export interface ClassificationLogEntry {
  id: string;                          // "retailer:productId"
  title: string;
  topCategoryId: string;
  topCosine: number;
  secondCategoryId: string | null;
  secondCosine: number | null;
  threshold: number;
  decision: "suggested" | "below_threshold" | "no_vectors";
  createdAt: string;
  userApprovedCategoryId?: string;
  approvedAt?: string;
}

async function readRaw(): Promise<ClassificationLogEntry[]> {
  const got = await browser.storage.local.get(STORAGE_KEY);
  const value = got[STORAGE_KEY];
  return Array.isArray(value) ? (value as ClassificationLogEntry[]) : [];
}

async function writeRaw(entries: ClassificationLogEntry[]): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: entries });
}

export async function appendLogEntry(entry: ClassificationLogEntry): Promise<void> {
  const log = await readRaw();
  log.push(entry);
  while (log.length > LOG_MAX) log.shift();
  await writeRaw(log);
}

export async function readLog(): Promise<ClassificationLogEntry[]> {
  return readRaw();
}

export async function patchApproval(
  id: string,
  patch: Pick<ClassificationLogEntry, "userApprovedCategoryId" | "approvedAt">,
): Promise<void> {
  const log = await readRaw();
  // Patch the most recent entry for this id (in case the same product was
  // classified multiple times).
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].id === id) {
      log[i] = { ...log[i], ...patch };
      break;
    }
  }
  await writeRaw(log);
}
```

- [ ] **Step 4: Run tests, expect pass**

- [ ] **Step 5: Commit**

```bash
git add lib/classification-log.ts lib/classification-log.test.ts
git commit -m "feat(BAC-105): rolling classification log in storage.local"
```

---

### Task 3.4 — Wire embedding tier into `classifyItem`

**Files:**
- Modify: `lib/classifier.ts`
- Modify: `background/sync.ts` (call-site signature change)

- [ ] **Step 1: Update `classifyItem` and `classifyItems`**

```ts
// lib/classifier.ts
import type { ClassifiedItem, ProductCategory } from "./types";
import { getAllProductCategories, getProductCategory } from "./db";
import { embed } from "@/background/embedder";
import { EMBEDDING_THRESHOLD, scoreEmbeddingFull } from "./embedding-scoring";
import { appendLogEntry } from "./classification-log";

interface ClassifyInput {
  productId: string;
  title: string;
}

interface ClassifyResult {
  categoryId: string | null;
  source: ClassifiedItem["classificationSource"];
  matchedSource?: { title: string; cosine: number };
}

export async function classifyItem(
  item: ClassifyInput,
  retailer: string,
): Promise<ClassifyResult> {
  const key = `${retailer}:${item.productId}`;
  const entry = await getProductCategory(key);
  if (entry) {
    return { categoryId: entry.categoryId, source: "product_cache" };
  }

  // Embedding tier — best-effort. Any failure degrades to null.
  try {
    const allRows = await getAllProductCategories();
    return await classifyViaEmbedding(item, retailer, allRows);
  } catch (err) {
    console.warn("classifyItem: embedding tier failed", err);
    return { categoryId: null, source: null };
  }
}

async function classifyViaEmbedding(
  item: ClassifyInput,
  retailer: string,
  rows: ProductCategory[],
): Promise<ClassifyResult> {
  const haveVectors = rows.some((r) => r.embedding);
  if (!haveVectors) {
    return { categoryId: null, source: null };
  }

  const queryVec = await embed(item.title);
  const full = scoreEmbeddingFull(queryVec, rows);
  if (!full) {
    await appendLogEntry({
      id: `${retailer}:${item.productId}`,
      title: item.title,
      topCategoryId: "",
      topCosine: 0,
      secondCategoryId: null,
      secondCosine: null,
      threshold: EMBEDDING_THRESHOLD,
      decision: "no_vectors",
      createdAt: new Date().toISOString(),
    });
    return { categoryId: null, source: null };
  }

  const suggested = full.topCosine >= EMBEDDING_THRESHOLD;
  await appendLogEntry({
    id: `${retailer}:${item.productId}`,
    title: item.title,
    topCategoryId: full.topCategoryId,
    topCosine: full.topCosine,
    secondCategoryId: full.secondCategoryId,
    secondCosine: full.secondCosine,
    threshold: EMBEDDING_THRESHOLD,
    decision: suggested ? "suggested" : "below_threshold",
    createdAt: new Date().toISOString(),
  });

  if (!suggested) return { categoryId: null, source: null };
  return {
    categoryId: full.topCategoryId,
    source: "embedding",
    matchedSource: { title: full.topMatchedTitle, cosine: full.topCosine },
  };
}

export function classifyItems<T extends { productId: string; title: string }>(
  items: T[],
  retailer: string,
): Promise<
  (T &
    Pick<ClassifiedItem, "suggestedCategoryId" | "classificationSource"> &
    Pick<ClassifiedItem, "matchedSource">)[]
> {
  return Promise.all(
    items.map(async (item) => {
      const { categoryId, source, matchedSource } = await classifyItem(item, retailer);
      return {
        ...item,
        suggestedCategoryId: categoryId,
        classificationSource: source,
        matchedSource,
      };
    }),
  );
}
```

- [ ] **Step 2: Fix the sync.ts call site** so it passes `title`

In `background/sync.ts` around the post-persist classification call (lines 150–159), the items passed to `classifyItems` need to include `title`. They likely already do (they're `AllocatedItem`s, which extend `ScrapedItem` and have `title`). Verify with:

```bash
grep -n "classifyItems" background/sync.ts
```

If the type narrowing doesn't already include `title`, broaden the input type.

- [ ] **Step 3: Wire the migration check into sync**

In `background/sync.ts`, near the top of `performSync`, ensure migrations have run before classification:

```ts
import { ensureMigrated } from "@/entrypoints/background";

export async function performSync(...): Promise<...> {
  await ensureMigrated();
  // … rest of existing sync
}
```

(If `ensureMigrated` isn't easily exportable from the entrypoint, move it to a small `background/startup.ts` module and import from both places.)

- [ ] **Step 4: Add an integration test for the cascade**

Add to `background/approval.test.ts` (or a new `lib/classifier.test.ts`) — uses the existing IndexedDB test setup pattern:

```ts
// lib/classifier.test.ts (new)
describe("classifyItem embedding tier", () => {
  it("returns product_cache hit when productId matches", async () => {
    // …
  });

  it("falls through to embedding tier when cache misses; returns suggestion above threshold", async () => {
    // Seed a ProductCategory row with title + embedding, then call classifyItem
    // with a similar title; assert source === 'embedding' and categoryId matches.
  });

  it("returns null when best cosine is below threshold", async () => {
    // Seed orthogonal vector; call classifyItem with a different vector;
    // assert categoryId null, source null.
  });

  it("writes a classification log entry on every call", async () => {
    // After classify, readLog() should contain a matching entry.
  });
});
```

- [ ] **Step 5: Run tests, type-check**

```bash
pnpm test
pnpm compile
```

- [ ] **Step 6: Commit**

```bash
git add lib/classifier.ts background/sync.ts lib/classifier.test.ts
git commit -m "feat(BAC-105): classifyItem embedding tier + classification log"
```

---

### Task 3.5 — `ClassificationIndicator` component

**Files:**
- Create: `components/ClassificationIndicator.tsx`

- [ ] **Step 1: Implement**

```tsx
// components/ClassificationIndicator.tsx
import type { ClassifiedItem } from "@/lib/types";

interface Props {
  source: ClassifiedItem["classificationSource"];
}

/**
 * Small leading icon distinguishing classification provenance.
 * - product_cache: filled checkmark — exact prior match
 * - embedding: outline sparkle — similarity suggestion
 * - null: warning — needs user input
 */
export function ClassificationIndicator({ source }: Props) {
  if (source === "product_cache") {
    return (
      <span
        className="inline-block size-4 text-emerald-600"
        title="Previously categorized"
        aria-label="Previously categorized"
      >
        {/* check-circle filled */}
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.7 14.3l6-7-1.4-1.2-5.3 6.2-2.3-2.3-1.4 1.4 3.7 3.7c.4.4 1 .4 1.4 0Z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    );
  }
  if (source === "embedding") {
    return (
      <span
        className="inline-block size-4 text-sky-600"
        title="Suggested from similar items"
        aria-label="Suggested from similar items"
      >
        {/* sparkle outline */}
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M10 3v4M10 13v4M3 10h4M13 10h4M5.5 5.5l2.8 2.8M11.7 11.7l2.8 2.8M5.5 14.5l2.8-2.8M11.7 8.3l2.8-2.8" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return (
    <span
      className="inline-block size-4 text-amber-600"
      title="Needs categorization"
      aria-label="Needs categorization"
    >
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M10 2 1 18h18L10 2Zm0 5v5m0 2v.01" stroke="white" strokeWidth="1.5" />
      </svg>
    </span>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm compile
```

- [ ] **Step 3: Commit**

```bash
git add components/ClassificationIndicator.tsx
git commit -m "feat(BAC-105): ClassificationIndicator component"
```

---

### Task 3.6 — Render indicator in `ItemCard`

**Files:**
- Modify: `components/ItemCard.tsx`

- [ ] **Step 1: Read current ItemCard**

```bash
cat components/ItemCard.tsx
```

- [ ] **Step 2: Add the indicator** as a leading element. The exact placement depends on the existing layout — render `<ClassificationIndicator source={classificationSource} />` adjacent to the title row. Replace any existing uncategorized-only warning logic with the unified 3-state indicator.

- [ ] **Step 3: Manual visual check**

```bash
pnpm dev
```

In a browser, trigger a sync that produces items in all three source states and verify each icon renders.

- [ ] **Step 4: Commit**

```bash
git add components/ItemCard.tsx
git commit -m "feat(BAC-105): show source indicator in ItemCard"
```

---

### Task 3.7 — DetailView: "similar to your past X" line

**Files:**
- Modify: `components/DetailView.tsx`

- [ ] **Step 1: Locate the per-item rendering block** (around the lines where items are mapped).

- [ ] **Step 2: Add the explanation line** under the suggested category, only when `classificationSource === "embedding"` and `matchedSource` is present:

```tsx
{item.classificationSource === "embedding" && item.matchedSource && (
  <p className="text-xs text-gray-500 italic mt-1">
    Suggested based on similarity to your past “{item.matchedSource.title}”.
  </p>
)}
```

- [ ] **Step 3: Manual visual check**

- [ ] **Step 4: Commit**

```bash
git add components/DetailView.tsx
git commit -m "feat(BAC-105): show matched-past-title explanation in DetailView"
```

---

### Task 3.8 — Patch the log on approval

**Files:**
- Modify: `background/approval.ts`

- [ ] **Step 1: Call `patchApproval` from `approveTransaction`** after the YNAB write succeeds:

```ts
import { patchApproval } from "@/lib/classification-log";

// after await updateTransaction(...) and inside the success branch
const approvedAt = new Date().toISOString();
for (const choice of items) {
  await patchApproval(`${tx.retailer}:${choice.productId}`, {
    userApprovedCategoryId: choice.categoryId,
    approvedAt,
  });
}
```

- [ ] **Step 2: Run tests, type-check**

```bash
pnpm test
pnpm compile
```

- [ ] **Step 3: Commit**

```bash
git add background/approval.ts
git commit -m "feat(BAC-105): patch classification log on approval"
```

---

### Task 3.9 — Open PR 3

- [ ] **Step 1: Push branch, open PR**

Title: `feat: embedding tier active + source indicator (BAC-105 part 3)`
Body: "Builds on parts 1–2. classifyItem now returns embedding-based suggestions when the cache misses (max-cosine per category, threshold 0.65). ItemCard shows a 3-state source indicator; DetailView renders 'similar to your past X' for embedding suggestions. Classification log starts accumulating so we can recalibrate the threshold from real data. This is the PR where the feature visibly turns on."

---

# PR 4 — Past-Order Backfill

Goal: opt-in flow that walks historical YNAB transactions through the existing scrape pipeline to bootstrap the embedding pool. Settings entry-point + progress UI.

### Task 4.1 — Backfill module (orchestration + idempotency)

**Files:**
- Create: `background/backfill.ts`
- Create: `background/backfill.test.ts`

- [ ] **Step 1: Write failing tests for the orchestrator**

```ts
// background/backfill.test.ts
import { describe, expect, it, vi } from "vitest";

// Mock the scrape pipeline + ynab + approval-time helpers.
// Test that:
//  - transactions outside the date range are skipped
//  - transactions already represented in productCategories are skipped
//  - transactions with deleted categories are skipped
//  - one failed scrape doesn't stop the run
//  - per-order delay is respected (use vi.useFakeTimers)
//  - rows are written with confirmedByUser=true, timesSeen=1, lastSeen=tx.date

// (Engineer note: full test bodies follow the existing project test style.)
```

- [ ] **Step 2: Implement**

```ts
// background/backfill.ts
import { getSettings } from "@/lib/settings";
import { listTransactionsInRange } from "@/lib/ynab";
import { getRetailerForPayee } from "@/lib/registry";
import { getAllProductCategories, putProductCategory, deleteProductCategory } from "@/lib/db";
import { embedBatch } from "./embedder";
import { planEviction, PER_CATEGORY_CAP } from "./embedding-eviction";
import type { ScrapedOrder } from "@/lib/types";

export interface BackfillOptions {
  /** ISO date string. Default: 12 months ago. */
  fromDate: string;
  /** ISO date string. Default: today. */
  toDate: string;
  /** Per-order delay in ms (anti-rate-limit). Default 2000. */
  perOrderDelayMs?: number;
  /** Cancellation signal. */
  signal?: AbortSignal;
  /** Progress callback: emitted after each transaction outcome. */
  onProgress?: (event: BackfillProgress) => void;
}

export interface BackfillProgress {
  index: number;
  total: number;
  itemsWritten: number;
  outcome: "scraped" | "skipped" | "failed";
  reason?: string;
}

export interface BackfillResult {
  total: number;
  scraped: number;
  skipped: number;
  failed: number;
  itemsWritten: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    });
  });

export async function runBackfill(options: BackfillOptions): Promise<BackfillResult> {
  const settings = await getSettings();
  if (!settings.ynabToken || !settings.planId) throw new Error("Not connected to YNAB");

  const txns = await listTransactionsInRange(
    settings.ynabToken,
    settings.planId,
    options.fromDate,
    options.toDate,
  );

  // Filter: must map to a supported retailer + must have a categoryId + not already cached
  const allRows = await getAllProductCategories();
  const knownIds = new Set(allRows.map((r) => r.id));

  const candidates = txns.filter((t) => {
    if (!t.category_id) return false;
    const mapping = getRetailerForPayee(t.payee_name ?? "");
    return mapping !== null;
  });

  let scraped = 0;
  let skipped = 0;
  let failed = 0;
  let itemsWritten = 0;
  const total = candidates.length;
  const delay = options.perOrderDelayMs ?? 2000;

  for (let i = 0; i < candidates.length; i++) {
    if (options.signal?.aborted) break;
    const tx = candidates[i];
    try {
      const order = await scrapeForBackfill(tx);
      if (!order) {
        skipped++;
        options.onProgress?.({ index: i, total, itemsWritten, outcome: "skipped", reason: "no order" });
      } else {
        const written = await persistBackfilledItems(order, tx.category_id!, knownIds, allRows);
        itemsWritten += written;
        scraped++;
        options.onProgress?.({ index: i, total, itemsWritten, outcome: "scraped" });
      }
    } catch (err) {
      failed++;
      options.onProgress?.({
        index: i,
        total,
        itemsWritten,
        outcome: "failed",
        reason: err instanceof Error ? err.message : "unknown",
      });
    }
    if (i < candidates.length - 1) {
      await sleep(delay, options.signal).catch(() => {});
    }
  }

  return { total, scraped, skipped, failed, itemsWritten };
}

async function scrapeForBackfill(tx: { payee_name: string | null }): Promise<ScrapedOrder | null> {
  // Reuse the existing per-retailer scrape entry point.
  // Engineer note: pick the right adapter call; this might look like:
  //   const mapping = getRetailerForPayee(tx.payee_name ?? "");
  //   if (!mapping) return null;
  //   return await mapping.strategy.scrape(tx);
  // Adjust to match the actual adapter API in `retailers/`.
  throw new Error("not implemented; wire to existing scrape pipeline");
}

async function persistBackfilledItems(
  order: ScrapedOrder,
  categoryId: string,
  knownIds: Set<string>,
  allRows: ReturnType<typeof getAllProductCategories> extends Promise<infer R> ? R : never,
): Promise<number> {
  // Filter out items we've already cached.
  const fresh = order.items.filter((it) => !knownIds.has(`${order.retailer}:${it.productId}`));
  if (fresh.length === 0) return 0;

  const vecs = await embedBatch(fresh.map((it) => it.title));
  const now = new Date().toISOString();

  let snapshot = allRows;
  for (let i = 0; i < fresh.length; i++) {
    const item = fresh[i];
    const id = `${order.retailer}:${item.productId}`;
    const plan = planEviction(snapshot, categoryId, id, PER_CATEGORY_CAP);
    for (const evictId of plan.toDelete) {
      await deleteProductCategory(evictId);
      snapshot = snapshot.filter((r) => r.id !== evictId);
    }
    const row = {
      id,
      categoryId,
      confirmedByUser: true,
      timesSeen: 1,
      lastSeen: now,
      title: item.title,
      embedding: vecs[i],
      embeddedAt: now,
    };
    await putProductCategory(row);
    snapshot = [...snapshot, row];
    knownIds.add(id);
  }
  return fresh.length;
}
```

- [ ] **Step 3: Verify the scrape entry point exists** in `retailers/` and wire it in. If not, this task may need to expose a small adapter façade; in that case add a helper to the registry and use it.

- [ ] **Step 4: Add the `listTransactionsInRange` helper to `lib/ynab.ts`** if it doesn't already exist. Existing YNAB code uses the standard transactions endpoint; add a date-bounded variant.

- [ ] **Step 5: Run tests**

```bash
pnpm test background/backfill.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add background/backfill.ts background/backfill.test.ts lib/ynab.ts
git commit -m "feat(BAC-105): past-order backfill orchestrator"
```

---

### Task 4.2 — Background message handler for backfill

**Files:**
- Modify: `entrypoints/background.ts`

- [ ] **Step 1: Add a `START_BACKFILL` / `CANCEL_BACKFILL` message handler**

```ts
import { runBackfill, type BackfillProgress } from "@/background/backfill";

let backfillController: AbortController | null = null;

browser.runtime.onMessage.addListener(async (msg, _sender, sendResponse) => {
  if (msg?.type === "START_BACKFILL") {
    if (backfillController) return { error: "already running" };
    backfillController = new AbortController();
    try {
      const result = await runBackfill({
        fromDate: msg.fromDate,
        toDate: msg.toDate,
        perOrderDelayMs: msg.perOrderDelayMs ?? 2000,
        signal: backfillController.signal,
        onProgress: (event: BackfillProgress) => {
          browser.runtime.sendMessage({ type: "BACKFILL_PROGRESS", event });
        },
      });
      return { ok: true, result };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "unknown" };
    } finally {
      backfillController = null;
    }
  }
  if (msg?.type === "CANCEL_BACKFILL") {
    backfillController?.abort();
    return { ok: true };
  }
});
```

- [ ] **Step 2: Type-check**

```bash
pnpm compile
```

- [ ] **Step 3: Commit**

```bash
git add entrypoints/background.ts
git commit -m "feat(BAC-105): background message handlers for backfill"
```

---

### Task 4.3 — Settings UI: backfill card

**Files:**
- Modify: appropriate settings component (path TBD by current UI structure)

- [ ] **Step 1: Locate the settings panel** (likely under `components/` or `entrypoints/sidepanel/`)

```bash
grep -rn "ynabToken" components entrypoints --include='*.tsx' | head -5
```

- [ ] **Step 2: Add a "Backfill from past orders" card** with:
  - Title + 1-sentence explanation
  - Date range picker (default: last 12 months; options: last 6 / 12 / all)
  - Start button → sends `START_BACKFILL` message
  - In-progress state: progress bar showing `index / total`, current outcome line, Cancel button
  - Summary state: "Backfilled N items across M categories. [Run again]"

Implementation sketch (adapt to project's React + Tailwind conventions):

```tsx
// pseudo-code; adapt
const [state, setState] = useState<"idle" | "running" | "done">("idle");
const [progress, setProgress] = useState<BackfillProgress | null>(null);
const [summary, setSummary] = useState<BackfillResult | null>(null);

useEffect(() => {
  const listener = (msg: { type: string; event?: BackfillProgress }) => {
    if (msg.type === "BACKFILL_PROGRESS" && msg.event) setProgress(msg.event);
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}, []);

async function start() {
  setState("running");
  const res = await browser.runtime.sendMessage({
    type: "START_BACKFILL",
    fromDate: subMonths(new Date(), 12).toISOString().slice(0, 10),
    toDate: new Date().toISOString().slice(0, 10),
  });
  setSummary(res.result ?? null);
  setState("done");
}
```

- [ ] **Step 3: Manual smoke** — open extension, click Backfill, watch progress.

- [ ] **Step 4: Commit**

```bash
git add components/...
git commit -m "feat(BAC-105): backfill settings card with progress UI"
```

---

### Task 4.4 — Open PR 4

Title: `feat: past-order backfill flow (BAC-105 part 4)`
Body: "Opt-in flow to bootstrap the embedding pool from historical YNAB-categorized transactions. Walks transactions in a date range (default last 12 months), runs them through the existing scrape pipeline, embeds titles, writes ProductCategory rows. Progress UI in settings; per-order delay (2s) to stay conservative with retailer rate-limiting."

---

# PR 5 — Calibration Analysis (Dev-Only)

Goal: a side-panel view that reads the classification log, joins with approvals, and helps tune the threshold from real data.

### Task 5.1 — Add `debugCalibration` setting

**Files:**
- Modify: `lib/settings.ts`

- [ ] **Step 1: Add `debugCalibration: boolean | null` to the Settings interface and any default-getter**

- [ ] **Step 2: Commit**

```bash
git add lib/settings.ts
git commit -m "feat(BAC-105): debugCalibration setting flag"
```

---

### Task 5.2 — Calibration analysis pure functions (TDD)

**Files:**
- Create: `lib/calibration-analysis.ts`
- Create: `lib/calibration-analysis.test.ts`

- [ ] **Step 1: Write tests for `analyzeAt(threshold)` and `sweepThresholds()`**

```ts
// lib/calibration-analysis.test.ts
import { describe, expect, it } from "vitest";
import { analyzeAt, sweepThresholds } from "./calibration-analysis";
import type { ClassificationLogEntry } from "./classification-log";

function entry(opts: Partial<ClassificationLogEntry> & Pick<ClassificationLogEntry, "topCosine">): ClassificationLogEntry {
  return {
    id: opts.id ?? "amazon:item",
    title: opts.title ?? "test",
    topCategoryId: opts.topCategoryId ?? "household",
    topCosine: opts.topCosine,
    secondCategoryId: opts.secondCategoryId ?? null,
    secondCosine: opts.secondCosine ?? null,
    threshold: opts.threshold ?? 0.65,
    decision: opts.decision ?? "suggested",
    createdAt: opts.createdAt ?? "2026-01-01",
    userApprovedCategoryId: opts.userApprovedCategoryId,
    approvedAt: opts.approvedAt,
  };
}

describe("analyzeAt", () => {
  it("computes precision at threshold", () => {
    const log = [
      // Above thr=0.6, correct
      entry({ topCosine: 0.8, topCategoryId: "household", userApprovedCategoryId: "household" }),
      // Above thr=0.6, wrong
      entry({ topCosine: 0.7, topCategoryId: "household", userApprovedCategoryId: "groceries" }),
      // Below thr=0.6 → ignored for precision
      entry({ topCosine: 0.5, topCategoryId: "household", userApprovedCategoryId: "household" }),
    ];
    const r = analyzeAt(log, 0.6);
    expect(r.precision).toBeCloseTo(0.5);
  });

  it("computes missed recall: entries below threshold whose top was correct", () => {
    const log = [
      entry({ topCosine: 0.5, topCategoryId: "household", userApprovedCategoryId: "household" }),
      entry({ topCosine: 0.4, topCategoryId: "household", userApprovedCategoryId: "household" }),
      entry({ topCosine: 0.3, topCategoryId: "household", userApprovedCategoryId: "groceries" }),
    ];
    const r = analyzeAt(log, 0.6);
    expect(r.missedRecall).toBe(2); // two correct-but-below entries
  });
});

describe("sweepThresholds", () => {
  it("returns precision/recall at each step", () => {
    const log = [
      entry({ topCosine: 0.8, topCategoryId: "h", userApprovedCategoryId: "h" }),
      entry({ topCosine: 0.6, topCategoryId: "h", userApprovedCategoryId: "g" }),
    ];
    const sweep = sweepThresholds(log, [0.5, 0.7, 0.9]);
    expect(sweep).toHaveLength(3);
    expect(sweep[0].threshold).toBe(0.5);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// lib/calibration-analysis.ts
import type { ClassificationLogEntry } from "./classification-log";

export interface AnalysisPoint {
  threshold: number;
  suggestedCount: number;
  correctCount: number;
  precision: number;
  missedRecall: number; // entries below threshold whose top was correct
}

export function analyzeAt(log: ClassificationLogEntry[], threshold: number): AnalysisPoint {
  const labeled = log.filter((e) => e.userApprovedCategoryId !== undefined);
  let suggestedCount = 0;
  let correctCount = 0;
  let missedRecall = 0;
  for (const e of labeled) {
    const wouldSuggest = e.topCosine >= threshold;
    const wasCorrect = e.topCategoryId === e.userApprovedCategoryId;
    if (wouldSuggest) {
      suggestedCount++;
      if (wasCorrect) correctCount++;
    } else if (wasCorrect) {
      missedRecall++;
    }
  }
  return {
    threshold,
    suggestedCount,
    correctCount,
    precision: suggestedCount === 0 ? 0 : correctCount / suggestedCount,
    missedRecall,
  };
}

export function sweepThresholds(
  log: ClassificationLogEntry[],
  thresholds: number[] = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85],
): AnalysisPoint[] {
  return thresholds.map((t) => analyzeAt(log, t));
}
```

- [ ] **Step 3: Run tests, expect pass**

- [ ] **Step 4: Commit**

```bash
git add lib/calibration-analysis.ts lib/calibration-analysis.test.ts
git commit -m "feat(BAC-105): calibration analysis pure functions"
```

---

### Task 5.3 — `CalibrationView` component (dev-only)

**Files:**
- Create: `components/CalibrationView.tsx`

- [ ] **Step 1: Implement** — a side-panel section that loads the log, computes the sweep, renders a small table + histogram. Gated behind `settings.debugCalibration`.

```tsx
// components/CalibrationView.tsx
import { useEffect, useState } from "react";
import { readLog, type ClassificationLogEntry } from "@/lib/classification-log";
import { sweepThresholds, analyzeAt, type AnalysisPoint } from "@/lib/calibration-analysis";
import { EMBEDDING_THRESHOLD } from "@/lib/embedding-scoring";

export function CalibrationView() {
  const [log, setLog] = useState<ClassificationLogEntry[]>([]);

  useEffect(() => {
    readLog().then(setLog);
  }, []);

  const labeled = log.filter((e) => e.userApprovedCategoryId !== undefined);
  const sweep: AnalysisPoint[] = sweepThresholds(log);
  const current = analyzeAt(log, EMBEDDING_THRESHOLD);

  return (
    <div className="p-4 space-y-4 text-sm">
      <header>
        <h2 className="text-base font-semibold">Calibration (debug)</h2>
        <p className="text-gray-500">
          {log.length} log entries · {labeled.length} labeled by approval.
          Current threshold: {EMBEDDING_THRESHOLD.toFixed(2)} (precision{" "}
          {(current.precision * 100).toFixed(1)}%, suggested{" "}
          {current.suggestedCount}).
        </p>
      </header>

      <section>
        <h3 className="font-medium mb-2">Threshold sweep</h3>
        <table className="w-full text-xs">
          <thead className="text-left">
            <tr>
              <th>thr</th>
              <th>suggested</th>
              <th>correct</th>
              <th>precision</th>
              <th>missed</th>
            </tr>
          </thead>
          <tbody>
            {sweep.map((p) => (
              <tr key={p.threshold} className={p.threshold === EMBEDDING_THRESHOLD ? "bg-yellow-50" : ""}>
                <td>{p.threshold.toFixed(2)}</td>
                <td>{p.suggestedCount}</td>
                <td>{p.correctCount}</td>
                <td>{(p.precision * 100).toFixed(1)}%</td>
                <td>{p.missedRecall}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3 className="font-medium mb-2">Recent entries</h3>
        <ul className="space-y-1 text-xs">
          {log.slice(-20).reverse().map((e) => (
            <li key={`${e.id}-${e.createdAt}`} className="font-mono">
              {e.topCosine.toFixed(3)} · {e.decision} · {e.title.slice(0, 40)}
              {e.userApprovedCategoryId
                ? ` → ${e.topCategoryId === e.userApprovedCategoryId ? "✓" : "✗"}`
                : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Mount it conditionally** in the side panel (likely `entrypoints/sidepanel/...`):

```tsx
{settings.debugCalibration && <CalibrationView />}
```

- [ ] **Step 3: Manual smoke** — toggle `debugCalibration` in storage, reload side panel, verify the view renders.

- [ ] **Step 4: Commit**

```bash
git add components/CalibrationView.tsx entrypoints/sidepanel/...
git commit -m "feat(BAC-105): dev-only calibration view"
```

---

### Task 5.4 — Open PR 5

Title: `feat: dev-only calibration analysis (BAC-105 part 5)`
Body: "Builds on parts 1–4. Adds a debug-flag-gated side-panel view that reads the classification log accumulated since part 3, joins with approvals, and renders precision/recall at a threshold sweep. Use this to recalibrate the 0.65 default from real data."

---

## Final Self-Review

Done with the plan. A short post-write check:

- **Spec coverage:**
  - Embedder + WASM-in-service-worker ✓ (PR 1)
  - Model versioning + migration ✓ (PR 2)
  - `learnFromApproval` writes embedding + title ✓ (PR 2)
  - Per-category cap=50 + recency eviction ✓ (PR 2, used by PR 4 too)
  - `classifyItem` adds embedding tier ✓ (PR 3)
  - Max-cosine scoring + threshold gate ✓ (PR 3)
  - Cross-retailer generalization ✓ (falls out of design; no special code needed)
  - UI 3-state source indicator ✓ (PR 3)
  - DetailView "similar to your past X" line ✓ (PR 3)
  - Classification log writes ✓ (PR 3)
  - Failure semantics (degrade to null) ✓ (PR 3, in `classifyItem` catch)
  - Backfill opt-in flow ✓ (PR 4)
  - Calibration analysis ✓ (PR 5)

- **Cross-task type consistency:** `ScoreResult` vs `FullScoreResult` are both used. `EMBEDDING_THRESHOLD` is exported from one place. `ClassificationLogEntry` is defined once and re-used.

- **Open implementation question:** PR 4 task 4.1 has `scrapeForBackfill` as a stub — the engineer must wire it to whatever entry point `retailers/` exposes. Acceptable since the existing scrape API is established and discoverable; flagged in-place.

- **No placeholders** in code blocks. PR 4 task 4.1's `scrapeForBackfill` body explicitly throws "not implemented" with a comment pointing to the adapter API — the engineer must complete it. This is a known integration point, not a plan placeholder.
