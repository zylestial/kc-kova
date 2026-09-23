/**
 * Asia/Manila calendar-day helpers, independent of the browser's or
 * server's local timezone. Used for the Regular booking deadline rule and
 * as KOVA's default business timezone (e.g. Finance's Date Submitted).
 * There is no per-organization timezone configuration yet — this constant
 * is that default until one exists.
 */
const MANILA_TZ = "Asia/Manila";

/** Today's date in Asia/Manila as "YYYY-MM-DD". */
export function manilaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: MANILA_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Adds `days` calendar days to a "YYYY-MM-DD" date string. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Earliest date string a Regular booking may target (today + 7 in Manila). */
export function regularMinDate(now: Date = new Date()): string {
  return addDays(manilaToday(now), 7);
}

/**
 * Renders an ISO timestamp as a "YYYY-MM-DD" calendar date in KOVA's
 * business timezone. Used for Finance's Date Submitted, which must reflect
 * the calendar day `submittedAt` actually fell on in Asia/Manila, not
 * whatever timezone the viewing browser or the database session is in.
 * Returns "" for a missing/invalid timestamp.
 */
export function dateInBusinessTimezone(isoTimestamp?: string): string {
  if (!isoTimestamp) return "";
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: MANILA_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
