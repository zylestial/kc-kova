import type { Schedule, TripCompletion } from "@/lib/kova-api";

/** A trip longer than this is probably a typo in a reading, so the Driver is asked to check. */
export const LONG_TRIP_KM = 500;

/**
 * The ending reading of the most recent completed trip in this vehicle, to
 * pre-fill the next trip's starting reading. Null when the vehicle has no
 * completed trip visible to this person.
 */
export function lastEndReading(plate: string, schedules: Schedule[], completions: TripCompletion[]): number | null {
  const plateOf = (completion: TripCompletion) =>
    schedules.find((schedule) => schedule.id === completion.scheduleId)?.revisions.find((revision) => revision.id === completion.revisionId)
      ?.plate;
  const latest = completions
    .filter((completion) => plateOf(completion) === plate)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
  return latest ? latest.endOdometer : null;
}

/** A warning for a distance that looks wrong, or "" when it looks normal. */
export function longTripWarning(distance: number): string {
  return distance > LONG_TRIP_KM
    ? `That is ${distance.toLocaleString("en-US")} km, which is a very long trip. Check both readings before you submit.`
    : "";
}
