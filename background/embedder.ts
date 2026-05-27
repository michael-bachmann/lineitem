import { pipeline } from "@huggingface/transformers";

/**
 * Hugging Face model used for item-title embeddings. bge-small-en-v1.5 is a
 * 33M-param sentence encoder; the q8-quantized ONNX variant is ~30MB.
 * https://huggingface.co/Xenova/bge-small-en-v1.5
 */
const MODEL_ID = "Xenova/bge-small-en-v1.5";

/** Version stamp used to invalidate stored vectors when the model changes. */
const MODEL_VERSION = "bge-small-en-v1.5-q8";

const EMBEDDING_DIMS = 384;

/**
 * The shape returned by `pipeline("feature-extraction", ...)`. Accepts a
 * string or batch of strings; returns a flat Float32Array (rows
 * concatenated) plus the (batch_size, hidden_dim) shape.
 */
type FeatureExtractor = (
  texts: string | string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

/**
 * Module-scope singleton. The model is expensive to instantiate (~30MB
 * download on first ever load, then WASM init from disk cache), so we keep
 * one instance per service-worker lifetime. MV3 kills the SW on idle; on
 * the next message the file loads from cache in ~1s.
 */
let extractorPromise: Promise<FeatureExtractor> | null = null;

function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_ID, {
      dtype: "q8",
    }) as unknown as Promise<FeatureExtractor>;
  }
  return extractorPromise;
}

export function getCurrentModelVersion(): string {
  return MODEL_VERSION;
}

/** Pre-warm the model so the first sync doesn't pay the load cost in-band. */
export async function ensureModelLoaded(): Promise<void> {
  await getExtractor();
}

/**
 * Slice a flat (batchSize × EMBEDDING_DIMS) tensor into per-row vectors.
 * Rows are already L2-normalized by the model's `normalize: true` option.
 */
function unpackBatch(data: Float32Array, batchSize: number): Float32Array[] {
  return Array.from({ length: batchSize }, (_, i) =>
    data.slice(i * EMBEDDING_DIMS, (i + 1) * EMBEDDING_DIMS),
  );
}

export async function embed(text: string): Promise<Float32Array> {
  const extractor = await getExtractor();
  // Mean pooling averages per-token vectors into one fixed-size vector per
  // input (bge's recommended pooling). `normalize: true` makes cosine ≡ dot.
  const result = await extractor(text, { pooling: "mean", normalize: true });
  return result.data.slice(0, EMBEDDING_DIMS);
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
