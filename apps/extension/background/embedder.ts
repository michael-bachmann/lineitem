import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { browser } from "wxt/browser";
import type { PublicPath } from "wxt/browser";

/**
 * Hugging Face model used for item-title embeddings. bge-small-en-v1.5 is a
 * 33M-param sentence encoder; the q8-quantized ONNX variant is ~30MB.
 * https://huggingface.co/Xenova/bge-small-en-v1.5
 */
const MODEL_ID = "Xenova/bge-small-en-v1.5";

const EMBEDDING_DIMS = 384;

/**
 * Module-scope singleton. The model is expensive to instantiate (~30MB
 * download on first ever load, then WASM init from disk cache), so we keep
 * one instance per service-worker lifetime. MV3 kills the SW on idle; on
 * the next message the file loads from cache in ~1s.
 */
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

/** Configure ONNX Runtime Web for the extension before the first `pipeline()`
 *  call. Idempotent. numThreads=1 because extension contexts aren't
 *  cross-origin-isolated, so there's no SharedArrayBuffer for ORT's threaded
 *  build to use.
 *
 *  wasmPaths is set on FIREFOX ONLY, and the asymmetry is load-bearing:
 *  - Setting wasmPaths makes ORT load its glue via a dynamic `import()`.
 *  - Firefox's classic background page allows that, and needs the explicit path
 *    because otherwise ORT can't resolve its own script URL and falls back to
 *    the jsDelivr CDN, which the extension CSP blocks.
 *  - Chrome's MV3 background is a service worker, where `import()` is forbidden
 *    ("import() is disallowed on ServiceWorkerGlobalScope"). So on Chrome we
 *    leave wasmPaths unset and let ORT use its statically-bundled glue, which
 *    fetches the .wasm from /ort/ (see the de-inline base in wxt.config.ts).
 *    Leaving it unset is safe because transformers.js skips its own jsDelivr
 *    wasmPaths default when it detects a service worker. */
let runtimeConfigured = false;
function configureOnnxRuntime(): void {
  if (runtimeConfigured) return;
  // env.backends.onnx.wasm is typed as possibly undefined by @huggingface/transformers.
  const wasm = env.backends.onnx.wasm!;
  wasm.numThreads = 1;
  if (import.meta.env.BROWSER === "firefox") {
    // Cast: `/ort/` is a dynamic path not in WXT's generated PublicPath union.
    wasm.wasmPaths = browser.runtime.getURL("/ort/" as unknown as PublicPath);
  }
  runtimeConfigured = true;
}

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    configureOnnxRuntime();
    // `pipeline()`'s overloaded generic over every task expands to a union
    // TS can't resolve in one shot; the cast narrows to the task we asked for.
    extractorPromise = pipeline("feature-extraction", MODEL_ID, {
      dtype: "q8",
    }) as unknown as Promise<FeatureExtractionPipeline>;
  }
  return extractorPromise;
}

/** Pre-warm the model so the first sync doesn't pay the load cost in-band. */
export async function ensureModelLoaded(): Promise<void> {
  await getExtractor();
}

export async function embed(text: string): Promise<Float32Array> {
  const [vec] = await embedBatch([text]);
  return vec;
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  // Mean pooling averages per-token vectors into one fixed-size vector per
  // input (bge's recommended pooling). `normalize: true` makes cosine ≡ dot.
  const result = await extractor(texts, { pooling: "mean", normalize: true });
  // The model returns a Tensor with shape [N, EMBEDDING_DIMS] backed by a
  // single flat Float32Array. Slice into N copies — each slice() detaches
  // from the Tensor's underlying buffer so we can safely persist the result.
  const data = result.data as Float32Array;
  return Array.from({ length: texts.length }, (_, i) =>
    data.slice(i * EMBEDDING_DIMS, (i + 1) * EMBEDDING_DIMS),
  );
}

/** @internal — for tests only. */
export function _resetForTest(): void {
  extractorPromise = null;
  runtimeConfigured = false;
}
