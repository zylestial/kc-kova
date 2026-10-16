"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** "all", or the trip kind (`schedules.kind`, a request group's form). */
export type FormFilterValue = "all" | "DAILY" | "COMPANY";

/** Whether a trip or request of `kind` passes the filter. */
export const formMatches = (filter: FormFilterValue, kind: "DAILY" | "COMPANY") => filter === "all" || filter === kind;

/**
 * Daily Vehicle Trips or Company Trips (Company Trip Flow prototype,
 * "Review & print"), the same picker on every screen that lists both.
 */
export default function FormFilter({ value, onChange }: { value: FormFilterValue; onChange: (value: FormFilterValue) => void }) {
  return (
    <label className="field">
      <span>Form</span>
      <Select value={value} onValueChange={(next) => onChange(next as FormFilterValue)}>
        <SelectTrigger aria-label="Form filter">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All forms</SelectItem>
          <SelectItem value="DAILY">Daily Vehicle Trips</SelectItem>
          <SelectItem value="COMPANY">Company Trips</SelectItem>
        </SelectContent>
      </Select>
    </label>
  );
}
