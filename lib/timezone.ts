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

/**
 * Why a v2 request date isn't allowed, or "" when it is. Mirrors
 * check_request_date (supabase/migrations/0040_urgent_within_week.sql) so the
 * form can grey out days; the database still makes the real decision.
 * Regular: 7+ days ahead. Urgent: today up to 6 days ahead, so every
 * future date suits exactly one type. Admin may also pick any past date.
 */
export function requestDateError(
  date: string,
  requestType: "REGULAR" | "URGENT",
  isAdmin: boolean,
  now: Date = new Date(),
): string {
  const today = manilaToday(now);
  if (isAdmin && date < today) return "";
  if (requestType === "REGULAR" && date < addDays(today, 7)) return "Regular requests need at least 7 days' notice";
  if (requestType === "URGENT" && (date < today || date >= addDays(today, 7))) return "Urgent requests are for today up to 6 days ahead";
  return "";
}

/**
 * Whether a trip has ended: its last planned Time In ("HH:MM", Asia/Manila,
 * which has no daylight saving) on its date is at or before `now`. Mirrors
 * submit_completion (supabase/migrations/0029_v2_completion_rpcs.sql) so the
 * Driver's Complete trip button can wait; the database decides for real.
 */
export function hasTripEnded(date: string, timeIn: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(timeIn)) return false;
  const end = new Date(`${date}T${timeIn}:00+08:00`);
  return !Number.isNaN(end.getTime()) && end.getTime() <= now.getTime();
}
