"use client";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { nextSort, type Sort } from "@/lib/table-sort";

/** A table column: its heading and, if it can be sorted, the sort key. */
export type SortColumn<K extends string> = { label: string; key?: K };

/**
 * A table's header row where sortable headings are buttons: click to sort
 * ascending, again for descending, a third time for the screen's default
 * order. Phones hide the header row (stacked tables), so pair it with
 * SortSelect in the filter row.
 */
export function SortableHead<K extends string>({
  columns,
  sort,
  onSort,
}: {
  columns: SortColumn<K>[];
  sort: Sort<K>;
  onSort: (sort: Sort<K>) => void;
}) {
  return (
    <thead>
      <tr>
        {columns.map(({ label, key }, index) => {
          if (!key) return <th key={index}>{label}</th>;
          const dir = sort?.key === key ? sort.dir : null;
          const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ArrowUpDown;
          return (
            <th key={index} aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}>
              <button type="button" className={"th-sort" + (dir ? " active" : "")} onClick={() => onSort(nextSort(sort, key))}>
                {label}
                <Icon size={12} aria-hidden />
              </button>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

/** The same choice as SortableHead as a "Sort by" picker, shown only on phones (.sort-select). */
export function SortSelect<K extends string>({
  columns,
  sort,
  onSort,
}: {
  columns: SortColumn<K>[];
  sort: Sort<K>;
  onSort: (sort: Sort<K>) => void;
}) {
  const sortable = columns.filter((column): column is Required<SortColumn<K>> => !!column.key);
  const label = (text: string) => text.charAt(0) + text.slice(1).toLowerCase();
  return (
    <label className="field sort-select">
      <span>Sort by</span>
      <Select
        value={sort ? `${sort.key}:${sort.dir}` : "default"}
        onValueChange={(value) => {
          if (value === "default") return onSort(null);
          const [key, dir] = value.split(":") as [K, "asc" | "desc"];
          onSort({ key, dir });
        }}
      >
        <SelectTrigger aria-label="Sort by">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Default order</SelectItem>
          {sortable.flatMap(({ label: text, key }) => [
            <SelectItem key={key + ":asc"} value={key + ":asc"}>
              {label(text)} ↑
            </SelectItem>,
            <SelectItem key={key + ":desc"} value={key + ":desc"}>
              {label(text)} ↓
            </SelectItem>,
          ])}
        </SelectContent>
      </Select>
    </label>
  );
}
