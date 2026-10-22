"use client";
import type { ReactNode } from "react";
import { ChevronLeft, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** One list or view in the rail: its count, and a warning when it needs the Admin. */
export type RailItem = { id: string; section: string; label: string; count: number; warn?: boolean; note?: string };

/**
 * Settings' list layout (owner's prototype, 2026-10-22): a rail of lists
 * grouped under headings on the left, one list's table on the right. On a
 * phone the rail is the first screen and a list opens on its own, with
 * "All lists" to go back (`open`).
 */
export function ListLayout({
  items,
  selected,
  onSelect,
  search,
  onSearch,
  searchLabel,
  open,
  children,
}: {
  items: RailItem[];
  selected: string;
  onSelect: (id: string) => void;
  /** The rail's search, across every list of the tab. */
  search: string;
  onSearch: (value: string) => void;
  searchLabel: string;
  /** A list (or the search results) is showing; on a phone the rail hides. */
  open: boolean;
  children: ReactNode;
}) {
  const sections = [...new Set(items.map((item) => item.section))];
  return (
    <div className={"settings-lists" + (open ? " open" : "")}>
      <nav className="settings-rail" aria-label="Lists">
        <Input type="search" value={search} placeholder={searchLabel} aria-label={searchLabel} onChange={(e) => onSearch(e.target.value)} />
        {sections.map((section) => (
          <div key={section} className="settings-rail-section">
            <h2>{section}</h2>
            {items
              .filter((item) => item.section === section)
              .map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className="settings-rail-item"
                  aria-current={item.id === selected && !search.trim() ? "true" : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  <span>
                    {item.label}
                    {item.note && <small>{item.note}</small>}
                  </span>
                  <span className={"count" + (item.warn ? " warn" : "")} aria-label={`${item.count}${item.warn ? ", needs attention" : ""}`}>
                    {item.warn && <TriangleAlert size={12} aria-hidden="true" />} {item.count}
                  </span>
                </button>
              ))}
          </div>
        ))}
      </nav>
      <section className="settings-pane">{children}</section>
    </div>
  );
}

/** A list's heading: back (phones), title and tag, what it's for, and its main action. */
export function PaneHead({ title, tag, about, onBack, action }: { title: string; tag?: ReactNode; about: string; onBack: () => void; action?: ReactNode }) {
  return (
    <div className="settings-pane-head">
      <div>
        <button type="button" className="settings-back" onClick={onBack}>
          <ChevronLeft size={16} /> All lists
        </button>
        <h3>
          {title} {tag}
        </h3>
        <p>{about}</p>
      </div>
      {action}
    </div>
  );
}

export type StatusFilter = "Active" | "Inactive" | "all";

/** A list's own search and its Active / Inactive / All filter. */
export function PaneTools({
  search,
  onSearch,
  searchLabel,
  status,
  onStatus,
}: {
  search: string;
  onSearch: (value: string) => void;
  searchLabel: string;
  status?: StatusFilter;
  onStatus?: (value: StatusFilter) => void;
}) {
  return (
    <div className="settings-tools">
      <Input type="search" value={search} placeholder={searchLabel} aria-label={searchLabel} onChange={(e) => onSearch(e.target.value)} />
      {status && onStatus && (
        <Select value={status} onValueChange={(value) => onStatus(value as StatusFilter)}>
          <SelectTrigger aria-label="Status filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Active">Active</SelectItem>
            <SelectItem value="Inactive">Inactive</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

/** Whether `term` (already trimmed and lowercased) is in any of the fields. */
export const matchesSearch = (term: string, ...fields: (string | null | undefined)[]) =>
  !term || fields.some((field) => (field ?? "").toLowerCase().includes(term));

/** The yellow banner at the top of a tab: what still has to be set up. */
export function SetupBanner({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="notice settings-setup" role="status">
      <TriangleAlert size={18} aria-hidden="true" />
      <div>
        <b>{title}</b>
        <span>{children}</span>
      </div>
    </div>
  );
}

/** The search results across a tab's lists; each opens its list, searched for it. */
export function SearchResults({
  term,
  hits,
  onBack,
  onOpen,
}: {
  term: string;
  hits: { key: string; title: string; detail: string; open: () => void }[];
  onBack: () => void;
  onOpen?: () => void;
}) {
  return (
    <>
      <PaneHead title={`Results for “${term}”`} about={`${hits.length} match${hits.length === 1 ? "" : "es"}.`} onBack={onBack} />
      {hits.length ? (
        <div className="settings-hits">
          {hits.map((hit) => (
            <button
              type="button"
              key={hit.key}
              onClick={() => {
                hit.open();
                onOpen?.();
              }}
            >
              <span>{hit.title}</span>
              <small>{hit.detail}</small>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">
          <h3>Nothing matches</h3>
          <p>Check the spelling.</p>
        </div>
      )}
    </>
  );
}
