import { addDays, manilaToday } from "@/lib/timezone";

/** How far back the app loads by default: 90 days. Older records load on request. */
export const WINDOW_DAYS = 90;

/** Loading from here covers everything (the app has no records before this). */
export const ALL_TIME = "2000-01-01";

/** The earliest date loaded by default, as "YYYY-MM-DD" in Asia/Manila. */
export function defaultSince(now: Date = new Date()): string {
  return addDays(manilaToday(now), -WINDOW_DAYS);
}

/** A `since` query value if it's a real date, otherwise the default window. */
export function parseSince(value: string | null, now: Date = new Date()): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return defaultSince(now);
  return Number.isNaN(new Date(value + "T00:00:00Z").getTime()) ? defaultSince(now) : value;
}
