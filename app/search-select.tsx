"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

export type SearchOption = { id: string; name: string; hint?: string };

/** "  Wilcon   BAUANG " -> "wilcon bauang", matched the way the database does (option_name_key, 0049). */
const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const tidy = (name: string) => name.trim().replace(/\s+/g, " ");

type Row = { kind: "none" } | { kind: "option"; option: SearchOption } | { kind: "add"; name: string };

/**
 * A dropdown you type into: the list narrows to the names containing what
 * was typed. With onAdd, a name that isn't on the list shows Add "…", which
 * adds it to the list (0098) and picks it. Keyboard: arrows, Enter, Esc.
 */
export function SearchSelect({
  label,
  value,
  options,
  placeholder = "Select",
  noneLabel,
  disabled,
  invalid,
  onPick,
  onAdd,
}: {
  label: string;
  value: string;
  options: SearchOption[];
  placeholder?: string;
  /** An optional field: this first choice clears it. */
  noneLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  onPick: (id: string) => void;
  /** Adds a typed name to the list; resolves to the option to pick. */
  onAdd?: (name: string) => Promise<SearchOption>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  // The name just added, until the refreshed list has it.
  const [added, setAdded] = useState<SearchOption>();
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const all = added && !options.some((item) => item.id === added.id) ? [...options, added] : options;
  const selected = all.find((item) => item.id === value);
  const term = nameKey(query);
  const rows: Row[] = [
    ...(noneLabel && !term ? [{ kind: "none" as const }] : []),
    ...all.filter((item) => !term || nameKey(item.name).includes(term)).map((option) => ({ kind: "option" as const, option })),
    ...(onAdd && term.length >= 2 && !all.some((item) => nameKey(item.name) === term) ? [{ kind: "add" as const, name: tidy(query) }] : []),
  ];

  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
  };
  const choose = async (row: Row | undefined) => {
    if (!row || adding) return;
    if (row.kind === "none") onPick("");
    if (row.kind === "option") onPick(row.option.id);
    if (row.kind === "add" && onAdd) {
      setAdding(true);
      setAddError("");
      try {
        const option = await onAdd(row.name);
        setAdded(option);
        onPick(option.id);
      } catch (caught) {
        setAddError(caught instanceof Error ? caught.message : "The name could not be added.");
        return;
      } finally {
        setAdding(false);
      }
    }
    close();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) return setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (rows.length ? (index + step + rows.length) % rows.length : 0));
    } else if (event.key === "Enter") {
      if (open) {
        event.preventDefault();
        void choose(rows[active]);
      }
    } else if (event.key === "Escape" && open) {
      event.stopPropagation();
      close();
    }
  };
  const rowId = (index: number) => `${listId}-${index}`;

  return (
    <>
      <Popover open={open && !disabled} onOpenChange={(next) => !next && close()}>
        <PopoverAnchor asChild>
          <Input
            ref={input}
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && rows[active] ? rowId(active) : undefined}
            aria-invalid={invalid}
            autoComplete="off"
            disabled={disabled}
            className="search-select-input"
            placeholder={open && selected ? selected.name : placeholder}
            value={open ? query : (selected?.name ?? "")}
            onClick={() => setOpen(true)}
            onFocus={() => setOpen(true)}
            onBlur={close}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              setAddError("");
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="search-select-list"
          style={{ width: "var(--radix-popper-anchor-width)" }}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.target === input.current && event.preventDefault()}
          // Keeps focus in the box, so a click picks before the list closes.
          onMouseDown={(event) => event.preventDefault()}
        >
          <ul role="listbox" id={listId} aria-label={label}>
            {rows.map((row, index) => (
              <li
                key={row.kind === "option" ? row.option.id : row.kind}
                id={rowId(index)}
                role="option"
                aria-selected={row.kind === "option" ? row.option.id === value : row.kind === "none" ? !value : false}
                className={(index === active ? "active" : "") + (row.kind === "add" ? " add" : "")}
                onMouseEnter={() => setActive(index)}
                onClick={() => void choose(row)}
              >
                {row.kind === "none" && noneLabel}
                {row.kind === "option" && (
                  <>
                    <span>{row.option.name}</span>
                    {row.option.hint && <small>{row.option.hint}</small>}
                  </>
                )}
                {row.kind === "add" && (adding ? `Adding “${row.name}”…` : `Add “${row.name}”`)}
              </li>
            ))}
            {!rows.length && <li className="empty">No matches found.</li>}
          </ul>
        </PopoverContent>
      </Popover>
      {addError && <small className="field-hint">{addError}</small>}
    </>
  );
}
