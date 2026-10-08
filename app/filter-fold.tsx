"use client";
import { useId, useState, type ReactNode } from "react";
import { ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A filter row (.admin-trip-filters) that phones fold behind a "Filters"
 * button, so a screen's records show without scrolling past every field
 * first. Wider screens always show the row and never the button
 * (.filters-toggle / .filters-collapsible in globals.css).
 */
export default function FilterFold({ active, children }: { /** How many filters are set, shown on the button. */ active: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <Button variant="outline" className="filters-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <ListFilter size={16} /> {open ? "Hide filters" : "Filters"}
        {active > 0 && <span className="count">{active}</span>}
      </Button>
      <div id={id} className={"admin-trip-filters filters-collapsible" + (open ? " open" : "")}>
        {children}
      </div>
    </>
  );
}
