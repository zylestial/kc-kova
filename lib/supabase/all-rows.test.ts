import { describe, expect, it } from "vitest";
import { allRows, PAGE_SIZE } from "@/lib/supabase/all-rows";

/** A table of `total` numbered rows, served the way Supabase caps a page. */
function table(total: number) {
  const ranges: Array<[number, number]> = [];
  const page = async (from: number, to: number) => {
    ranges.push([from, to]);
    const end = Math.min(to + 1, total, from + PAGE_SIZE);
    return { data: Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i), error: null };
  };
  return { page, ranges };
}

describe("allRows", () => {
  it("returns a short list in one query", async () => {
    const { page, ranges } = table(3);
    expect((await allRows(page)).data).toEqual([0, 1, 2]);
    expect(ranges).toEqual([[0, PAGE_SIZE - 1]]);
  });

  it("keeps going past the first page", async () => {
    const { page, ranges } = table(PAGE_SIZE * 2 + 5);
    const { data } = await allRows(page);
    expect(data).toHaveLength(PAGE_SIZE * 2 + 5);
    expect(data?.at(-1)).toBe(PAGE_SIZE * 2 + 4);
    expect(ranges).toHaveLength(3);
  });

  it("asks once more when the last page is exactly full", async () => {
    const { page, ranges } = table(PAGE_SIZE);
    expect((await allRows(page)).data).toHaveLength(PAGE_SIZE);
    expect(ranges).toHaveLength(2);
  });

  it("stops at an error", async () => {
    const error = { message: "boom" };
    expect(await allRows(async () => ({ data: null, error }))).toEqual({ data: null, error });
  });
});
