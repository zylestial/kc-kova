"use client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { datePresetLabel, presetRange, type DateFilter, type DatePreset } from "@/lib/date-range";
import { manilaToday } from "@/lib/timezone";

/**
 * A "Dates" quick pick for a filter row (.admin-trip-filters). Custom range
 * adds From and To boxes, starting from whatever the last quick pick covered.
 */
export default function DateRangeFilter({ value, onChange }: { value: DateFilter; onChange: (value: DateFilter) => void }) {
  function pick(preset: DatePreset) {
    if (preset !== "custom") return onChange({ preset, from: "", to: "" });
    const current = value.preset === "custom" ? value : presetRange(value.preset, manilaToday());
    onChange({ preset, ...current });
  }

  return (
    <>
      <label className="field">
        <span>Dates</span>
        <Select value={value.preset} onValueChange={(preset) => pick(preset as DatePreset)}>
          <SelectTrigger aria-label="Dates">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(datePresetLabel) as DatePreset[]).map((preset) => (
              <SelectItem key={preset} value={preset}>
                {datePresetLabel[preset]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {value.preset === "custom" && (
        <>
          <label className="field">
            <span>From</span>
            <Input type="date" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          </label>
          <label className="field">
            <span>To</span>
            <Input type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} />
          </label>
        </>
      )}
    </>
  );
}
