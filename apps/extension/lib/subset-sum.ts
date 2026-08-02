/**
 * Exact subset-sum over non-negative integers (cents).
 *
 * Domain-free by design: this module knows about numbers, not orders, charges
 * or items. Callers map their domain onto `values` and read the returned
 * indices back out.
 *
 * Cost is O(n × sum(values)) — pseudo-polynomial, so it grows with the total
 * rather than exponentially with the count. A 37-item, $251 order resolves in
 * well under a millisecond, where enumerating 2^37 subsets would not finish.
 */

/** `via[s]` marker: no subset reaches sum `s`. */
const UNREACHABLE = -1;
/** `via[s]` marker: sum 0, reached by the empty subset, which has no predecessor. */
const ORIGIN = -2;

export interface ClosestSubset {
  /** Indices into `values`, ascending. Empty when the nearest sum is 0. */
  indices: number[];
  /** Sum of `indices` — the reachable total nearest the requested target. */
  sum: number;
}

/**
 * Indices of the subset of `values` whose sum sits closest to `target`.
 *
 * An exact hit is always found when one exists. Ties between two equidistant
 * reachable sums resolve to the smaller sum, so the result is deterministic for
 * a given input — callers can rely on repeat runs agreeing.
 *
 * `values` are expected to be non-negative integers (cents). Zero-valued
 * entries are never selected — they cannot move a sum, so no subset needs them.
 */
export function closestSubset(values: readonly number[], target: number): ClosestSubset {
  const total = values.reduce((a, b) => a + b, 0);

  // `via[s]` is the item that first completed sum `s`, so the subset behind any
  // reachable `s` is recovered by walking s → s − values[via[s]] back to 0.
  //
  // This table is written in place, and deliberately: rebuilding it immutably
  // would copy a `total`-sized array once per item, which is precisely the cost
  // this module exists to avoid. The mutation is local to the call — no state
  // escapes, and the function is referentially transparent.
  const via = new Int32Array(total + 1).fill(UNREACHABLE);
  via[0] = ORIGIN;

  values.forEach((value, index) => {
    // Cheap skip. A zero could never be recorded anyway — `via[s + 0]` is
    // reachable exactly when `via[s]` is, so the write test below can't fire —
    // and this also keeps negatives out, which would index outside the table.
    if (value <= 0) return;
    // Two rules together stop an item being used twice in one chain. Descending
    // keeps this pass's writes above the read cursor, so `index` can't extend
    // its own results. Writing only into an UNREACHABLE slot then freezes every
    // entry the moment it is first filled, so `via[s − values[i]]` is always an
    // item strictly below `i` — which is what makes traceBack's chain strictly
    // decreasing. Dropping either rule admits repeats: without the write guard,
    // closestSubset([434, 434, 434], 868) returns the same index twice.
    for (let s = total - value; s >= 0; s--) {
      if (via[s] !== UNREACHABLE && via[s + value] === UNREACHABLE) {
        via[s + value] = index;
      }
    }
  });

  const sum = nearestReachable(via, target);
  return { indices: traceBack(via, values, sum), sum };
}

/** The reachable sum nearest `target`. Scanning upward with a strict
 *  improvement test makes ties resolve to the smaller sum. */
function nearestReachable(via: Int32Array, target: number): number {
  let best = 0;
  let bestDistance = Math.abs(target);
  for (let s = 1; s < via.length; s++) {
    if (via[s] === UNREACHABLE) continue;
    const distance = Math.abs(s - target);
    if (distance < bestDistance) {
      best = s;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Walk the `via` chain from `sum` back to 0, collecting the items behind it.
 *
 * Because entries are written once and never overwritten (see closestSubset),
 * each step moves to a strictly smaller sum reached by a strictly lower item
 * index. The walk therefore terminates, no item repeats, and the indices come
 * out descending — reversed here to the ascending order callers expect.
 */
function traceBack(via: Int32Array, values: readonly number[], sum: number): number[] {
  const indices: number[] = [];
  let s = sum;
  while (s > 0) {
    const index = via[s];
    indices.push(index);
    s -= values[index];
  }
  return indices.reverse();
}
