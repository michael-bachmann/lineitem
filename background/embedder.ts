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
      dtype: "q8",
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
