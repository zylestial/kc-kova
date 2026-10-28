"use client";
import { useId, useState, type ReactNode } from "react";
import { ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A filter row (.admin-trip-filters) that phones fold behind a "Filters"
 * button, so a screen's records show without scrolling past every field
 * first. Wider screens always show the row and never the button
 * (.filters-toggle / .filters-collapsible in globals.css).
 *
 * `more` holds the less-used filters: wider screens tuck them behind a
 * "More filters" button (open from the start when one of them is set), and
 * phones show them with the rest once Filters is open.
 */
export default function FilterFold({
  active,
  more,
  moreActive = 0,
  children,
}: {
  /** How many filters are set, shown on the button. */
  active: number;
  more?: ReactNode;
  /** How many of the `more` filters are set. */
  moreActive?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(moreActive > 0);
  const id = useId();
  const moreId = useId();
  return (
    <>
      <Button variant="outline" className="filters-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <ListFilter size={16} /> {open ? "Hide filters" : "Filters"}
        {active > 0 && <span className="count">{active}</span>}
      </Button>
      <div id={id} className={"admin-trip-filters filters-collapsible" + (open ? " open" : "")}>
        {children}
        {more && (
          <>
            <div id={moreId} className={"filters-more" + (moreOpen ? " open" : "")}>
              {more}
            </div>
            <Button variant="ghost" className="more-filters-toggle" aria-expanded={moreOpen} aria-controls={moreId} onClick={() => setMoreOpen(!moreOpen)}>
              <ListFilter size={16} /> {moreOpen ? "Fewer filters" : "More filters"}
              {!moreOpen && moreActive > 0 && <span className="count">{moreActive}</span>}
            </Button>
          </>
        )}
      </div>
    </>
  );
}
