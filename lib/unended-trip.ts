import type { CompanyTripRun, Schedule, TripAttendance } from "@/lib/kova-api";

export type UnendedTrip = { scheduleId: string; date: string; plate: string; kind: Schedule["kind"] };

/**
 * A trip this Driver started but never tapped End trip on, other than
 * `currentId`: a Daily trip with Start but no End, or a Company trip run with
 * no End (owner, 2026-11-16: warn on Start trip, don't block). The oldest
 * first; null when there's none, or for an Admin viewing as Driver (no
 * driverId).
 */
export function unendedTrip(
  schedules: Schedule[],
  attendance: TripAttendance[],
  companyRuns: CompanyTripRun[],
  driverId: string | null,
  currentId: string,
): UnendedTrip | null {
  if (!driverId) return null;
  const found = schedules.flatMap((schedule) => {
    if (schedule.id === currentId || schedule.status !== "ACTIVE") return [];
    const revision = schedule.revisions.find((item) => item.id === schedule.publishedRevisionId);
    if (!revision || revision.driverId !== driverId) return [];
    const open =
      schedule.kind === "COMPANY"
        ? companyRuns.some((run) => run.scheduleId === schedule.id && !run.endAt)
        : attendance.some((item) => item.scheduleId === schedule.id && !item.end);
    return open ? [{ scheduleId: schedule.id, date: schedule.date, plate: revision.plate, kind: schedule.kind }] : [];
  });
  return found.sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
}
