import { addDays } from "@/lib/timezone";

export type DatePreset = "any" | "today" | "this-week" | "this-month" | "last-month" | "custom";

/** A date filter: a quick pick, or a custom From/To ("" leaves that end open). */
export type DateFilter = { preset: DatePreset; from: string; to: string };

export const anyDate: DateFilter = { preset: "any", from: "", to: "" };

export const datePresetLabel: Record<DatePreset, string> = {
  any: "Any date",
  today: "Today",
  "this-week": "This week",
  "this-month": "This month",
  "last-month": "Last month",
  custom: "Custom range",
};

const monthStart = (date: string) => date.slice(0, 8) + "01";
const monthEnd = (date: string) => addDays(monthStart(addDays(monthStart(date), 31)), -1);

/**
 * The From/To dates a quick pick covers, relative to `today` ("YYYY-MM-DD",
 * Asia/Manila). Weeks run Monday to Sunday, like the Schedules week view.
 */
export function presetRange(preset: DatePreset, today: string): { from: string; to: string } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "this-week": {
      const monday = addDays(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7));
      return { from: monday, to: addDays(monday, 6) };
    }
    case "this-month":
      return { from: monthStart(today), to: monthEnd(today) };
    case "last-month": {
      const last = addDays(monthStart(today), -1);
      return { from: monthStart(last), to: last };
    }
    default:
      return { from: "", to: "" };
  }
}

/** Whether a "YYYY-MM-DD" date falls inside the filter (both ends inclusive). */
export function inDateFilter(date: string, filter: DateFilter, today: string): boolean {
  const { from, to } = filter.preset === "custom" ? filter : presetRange(filter.preset, today);
  return (!from || date >= from) && (!to || date <= to);
}
