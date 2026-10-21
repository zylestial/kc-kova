/** Supabase's API returns at most this many rows per query (max_rows, supabase/config.toml). */
export const PAGE_SIZE = 1000;

type Page<T> = { data: T[] | null; error: unknown };

/**
 * Every row of a query, fetched a page at a time. A plain select stops at
 * PAGE_SIZE rows without saying so, so a long list would quietly lose rows.
 * `page` builds the query for one range and must sort on a unique column,
 * or rows can repeat or go missing between pages.
 *
 *   allRows((from, to) => supabase.from("stop_taps").select("*").order("id").range(from, to))
 */
export async function allRows<T>(page: (from: number, to: number) => PromiseLike<Page<T>>): Promise<Page<T>> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return { data: rows, error: null };
  }
}
