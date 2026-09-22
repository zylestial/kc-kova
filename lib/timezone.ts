/**
 * Asia/Manila calendar-day helpers used for the Regular/Urgent booking
 * deadline rules, independent of the browser's or server's local timezone.
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

/** Whether `date` ("YYYY-MM-DD") is same-day or next-day relative to "today" in Manila. */
export function isUrgentEligibleDate(date: string, now: Date = new Date()): boolean {
  const today = manilaToday(now);
  return date === today || date === addDays(today, 1);
}
