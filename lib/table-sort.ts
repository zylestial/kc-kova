/** A table's chosen order: a column and a direction, or null for the screen's own default order. */
export type Sort<K extends string> = { key: K; dir: "asc" | "desc" } | null;

/** Clicking a column: unsorted → ascending → descending → back to the default order. */
export function nextSort<K extends string>(current: Sort<K>, key: K): Sort<K> {
  if (current?.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}

/** What a column sorts by for one row: text (compared naturally, so "UAT-2" < "UAT-10") or a number. */
export type SortValues<T, K extends string> = Record<K, (row: T) => string | number>;

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/**
 * The rows in the chosen order, or unchanged for no sort. Stable, so rows
 * that tie keep the screen's default order between them.
 */
export function sortRows<T, K extends string>(rows: T[], sort: Sort<K>, values: SortValues<T, K>): T[] {
  if (!sort) return rows;
  const value = values[sort.key];
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const order = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
    return order * sign;
  });
}
