import type { HistoryEntry } from "@/lib/kova-api";

// Fields only an Admin may set; stripped from anything a Driver submits so a
// Driver can never write finance data, approvals, or history for themselves.
const ADMIN_ONLY_FIELDS = ["pm", "coo", "submitted", "received", "reference", "finance", "financeDate", "history"] as const;

export function stripAdminOnlyFields<T extends Record<string, unknown>>(data: T) {
  const clone: Record<string, unknown> = { ...data };
  for (const field of ADMIN_ONLY_FIELDS) delete clone[field];
  return clone;
}

export function omit<T extends Record<string, unknown>>(data: T, keys: readonly string[]) {
  const clone: Record<string, unknown> = { ...data };
  for (const key of keys) delete clone[key];
  return clone;
}

export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: HistoryEntry["changes"] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  keys.delete("history");
  for (const field of keys) {
    const beforeValue = before[field];
    const afterValue = after[field];
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes.push({ field, before: beforeValue ?? null, after: afterValue ?? null });
    }
  }
  return changes;
}

export function isAnonangRoundTrip(legs: unknown) {
  if (!Array.isArray(legs) || legs.length === 0) return false;
  const first = legs[0] as { origin?: string };
  const last = legs[legs.length - 1] as { destination?: string };
  return first?.origin?.trim().toUpperCase() === "ANONANG" && last?.destination?.trim().toUpperCase() === "ANONANG";
}

export function canFinishTrip(date: string, endHour: number, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(endHour)) return false;
  const end = new Date(`${date}T00:00:00`);
  if (Number.isNaN(end.getTime())) return false;
  end.setHours(endHour, 0, 0, 0);
  return now.getTime() >= end.getTime();
}
