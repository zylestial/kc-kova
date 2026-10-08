import { describe, expect, it } from "vitest";
import { nextSort, sortRows, type SortValues } from "@/lib/table-sort";

type Row = { id: string; plate: string; km: number };
const rows: Row[] = [
  { id: "a", plate: "UAT-10", km: 5 },
  { id: "b", plate: "UAT-2", km: 40 },
  { id: "c", plate: "uat-2", km: 12 },
];
const values: SortValues<Row, "plate" | "km"> = { plate: (row) => row.plate, km: (row) => row.km };
const ids = (list: Row[]) => list.map((row) => row.id);

describe("nextSort", () => {
  it("cycles a column through ascending, descending and back to the default", () => {
    expect(nextSort(null, "plate")).toEqual({ key: "plate", dir: "asc" });
    expect(nextSort({ key: "plate", dir: "asc" }, "plate")).toEqual({ key: "plate", dir: "desc" });
    expect(nextSort({ key: "plate", dir: "desc" }, "plate")).toBeNull();
  });

  it("starts ascending when another column is clicked", () => {
    expect(nextSort({ key: "plate", dir: "desc" }, "km")).toEqual({ key: "km", dir: "asc" });
  });
});

describe("sortRows", () => {
  it("leaves the default order alone without a sort", () => {
    expect(sortRows(rows, null, values)).toBe(rows);
  });

  it("sorts numbers both ways", () => {
    expect(ids(sortRows(rows, { key: "km", dir: "asc" }, values))).toEqual(["a", "c", "b"]);
    expect(ids(sortRows(rows, { key: "km", dir: "desc" }, values))).toEqual(["b", "c", "a"]);
  });

  it("sorts text naturally, ignoring case, and keeps ties in their default order", () => {
    expect(ids(sortRows(rows, { key: "plate", dir: "asc" }, values))).toEqual(["b", "c", "a"]);
  });

  it("does not change the rows it was given", () => {
    sortRows(rows, { key: "km", dir: "asc" }, values);
    expect(ids(rows)).toEqual(["a", "b", "c"]);
  });
});
