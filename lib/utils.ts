/** Group items by a key function. Returns a Map preserving insertion order. */
export function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  return items.reduce((map, item) => {
    const key = keyFn(item);
    map.set(key, [...(map.get(key) ?? []), item]);
    return map;
  }, new Map<string, T[]>());
}
