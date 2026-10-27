import type { Schedule, TripCompletion } from "@/lib/kova-api";

/** A trip longer than this is probably a typo in a reading, so the Driver is asked to check. */
export const LONG_TRIP_KM = 500;

/**
 * The ending reading of the most recent completed trip in this vehicle, to
 * pre-fill the next trip's starting reading. Null when the vehicle has no
 * completed trip with readings visible to this person (0078: a trip made
 * while it had no odometer has none).
 */
export function lastEndReading(plate: string, schedules: Schedule[], completions: TripCompletion[]): number | null {
  const plateOf = (completion: TripCompletion) =>
    schedules.find((schedule) => schedule.id === completion.scheduleId)?.revisions.find((revision) => revision.id === completion.revisionId)
      ?.plate;
  const latest = completions
    .filter((completion) => completion.endOdometer !== null && plateOf(completion) === plate)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
  return latest ? latest.endOdometer : null;
}

/** A warning for a distance that looks wrong, or "" when it looks normal. */
export function longTripWarning(distance: number): string {
  return distance > LONG_TRIP_KM
    ? `That is ${distance.toLocaleString("en-US")} km, which is a very long trip. Check both readings before you submit.`
    : "";
}

/** Said in place of readings for a trip in a vehicle without an odometer (0078). */
export const NO_ODOMETER = "No odometer";

/** A reading or distance as "1,234 km", or NO_ODOMETER when the trip has none. */
export function kmLabel(km: number | null | undefined): string {
  return km === null || km === undefined ? NO_ODOMETER : `${km.toLocaleString("en-US")} km`;
}

/** "48215 → 48262 (47 km)", or NO_ODOMETER for a trip without readings. */
export function readingsLabel(completion: Pick<TripCompletion, "startOdometer" | "endOdometer" | "distance">): string {
  const { startOdometer: start, endOdometer: end, distance } = completion;
  return start === null || end === null ? NO_ODOMETER : `${start} → ${end} (${distance} km)`;
}

/** A reading or distance on a printed form: "48215 km", or N/A for a trip without readings (0078). */
export function printKm(km: number | null | undefined): string {
  return km === null || km === undefined ? "N/A (no odometer)" : `${km} km`;
}
