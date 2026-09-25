import type { ScheduleInput } from "@/lib/kova-api";

/**
 * Shape-checks a Save draft body before it reaches save_schedule_draft.
 * Only structure is checked here; route continuity, times, the 8-leg
 * limit, request ownership of stops and reservation conflicts are
 * enforced in Postgres. Origins are never read from the body: the server
 * derives them. Returns null when the body isn't usable.
 */
export function parseScheduleInput(body: unknown): ScheduleInput | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const text = (source: Record<string, unknown>, key: string) =>
    typeof source[key] === "string" ? (source[key] as string) : "";
  const strings = (items: unknown) =>
    Array.isArray(items) && items.every((item) => typeof item === "string" && item) ? (items as string[]) : null;

  const date = text(value, "date");
  const plate = text(value, "plate");
  const requestIds = strings(value.requestIds);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !plate || !requestIds || !Array.isArray(value.legs)) return null;

  const legs: ScheduleInput["legs"] = [];
  for (const item of value.legs) {
    if (!item || typeof item !== "object") return null;
    const leg = item as Record<string, unknown>;
    const isFinal = leg.isFinal === true;
    const stops = strings(leg.stops ?? []);
    if (!stops) return null;
    legs.push({
      destinationId: isFinal ? undefined : text(leg, "destinationId") || undefined,
      plannedTimeOut: text(leg, "plannedTimeOut"),
      plannedTimeIn: text(leg, "plannedTimeIn"),
      contactName: text(leg, "contactName").trim(),
      contactNumber: text(leg, "contactNumber").trim(),
      stops,
      isFinal,
    });
  }

  return { date, plate, requestIds, legs };
}
