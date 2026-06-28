/**
 * Like `Promise.all(items.map(fn))`, but awaits each call before starting the
 * next — i.e. a sequential async map. Use it where the calls must not overlap:
 * one retailer browser tab at a time, one embedder pass at a time. (remeda is
 * synchronous, and `Promise.all(map(...))` would run everything concurrently.)
 *
 * `fn` receives the index too, mirroring `Array.prototype.map`, so callers can
 * derive progress without a running counter.
 */
export async function mapSeries<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (const [index, item] of items.entries()) results.push(await fn(item, index));
  return results;
}
