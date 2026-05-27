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

/** L2-normalize. Returns a new Float32Array. */
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
