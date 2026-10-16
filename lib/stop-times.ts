import type { AttendanceTap, BookingOption, ScheduleLeg, StopTap, StopTapLocation, TripAttendance, TripTimeCorrection } from "@/lib/kova-api";
import { BASE_RADIUS_M, MAX_ACCURACY_ALLOWANCE_M, distanceLabel } from "@/lib/attendance";

/**
 * Where one TIME OUT or TIME IN on the printed form comes from:
 *
 *   Leg 1 TIME OUT   = Start trip
 *   Leg N TIME IN    = Arrived at leg N's destination
 *   Leg N+1 TIME OUT = Leaving leg N's destination
 *   Final TIME IN    = End trip
 */
export type TimeSource =
  | { kind: "START" | "END" }
  | { kind: StopTap["kind"]; legId: string; place: string };

/**
 * One form time: which cell it is (an Admin's entry is stored against it),
 * where it comes from, the tap once it's made, and an Admin's entry if any.
 */
export type FormTime = {
  cell: { legId: string; field: TripTimeCorrection["field"] };
  source: TimeSource;
  tap: (Omit<AttendanceTap, "location"> & { location: StopTapLocation | null }) | null;
  correction: TripTimeCorrection | null;
};

export type LegTimes = { leg: ScheduleLeg; out: FormTime; in: FormTime };

export type Place = { lat: number; lng: number };

/** Metres between two points, by the haversine formula (same as distance_m in Postgres, 0044). */
export function distanceMetres(a: Place, b: Place): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const h = Math.sin(rad(a.lat - b.lat) / 2) ** 2 + Math.cos(rad(b.lat)) * Math.cos(rad(a.lat)) * Math.sin(rad(a.lng - b.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** A name for matching only: "  Wilcon   Calasiao " -> "wilcon calasiao" (option_name_key, 0049). */
export const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Finds a leg's destination's saved location as it is now: through the leg's
 * destination choice, or, for a leg typed in as "Other" before it became a
 * choice, through the choice with the same name. Null when there is none.
 */
export function placeResolver(destinations: BookingOption[]): (leg: ScheduleLeg) => Place | null {
  const byId = new Map(destinations.map((item) => [item.id, item.location ?? null]));
  const byName = new Map(destinations.filter((item) => item.location).map((item) => [nameKey(item.name), item.location!]));
  return (leg) => (leg.destinationId ? (byId.get(leg.destinationId) ?? null) : (byName.get(nameKey(leg.destinationName)) ?? null));
}

/** A stop tap's identity, e.g. "ARRIVE:<leg id>". */
export const stopKey = (source: { kind: string; legId?: string }) => `${source.kind}:${source.legId ?? ""}`;

/**
 * The TIME OUT and TIME IN of each leg, from Start/End trip, the stop taps
 * and any Admin entries (which print in place of the tap). With `placeOf`,
 * each stop tap's distance is worked out again from its saved position and
 * the destination's location as it is now, so a location set after the tap
 * still checks it; without it, the distance saved with the tap is used.
 */
export function legTimes(
  legs: ScheduleLeg[],
  attendance: TripAttendance | undefined,
  taps: StopTap[],
  corrections: TripTimeCorrection[] = [],
  placeOf?: (leg: ScheduleLeg) => Place | null,
  /** A Company trip ends at its last stop (0055): that stop's TIME IN is End trip. */
  endsAtLastLeg = false,
): LegTimes[] {
  const tapFor = (kind: StopTap["kind"], legId: string) => {
    const tap = taps.find((item) => item.kind === kind && item.legId === legId) ?? null;
    const leg = legs.find((item) => item.id === legId);
    if (!tap || !tap.location || !placeOf || !leg) return tap;
    const place = placeOf(leg);
    return { ...tap, location: { ...tap.location, distanceM: place ? distanceMetres(tap.location, place) : null } };
  };
  const correctionFor = (legId: string, field: TripTimeCorrection["field"]) =>
    corrections.find((item) => item.legId === legId && item.field === field) ?? null;
  return legs.map((leg, index) => {
    const previous = legs[index - 1];
    const outCell = { legId: leg.id, field: "OUT" as const };
    const inCell = { legId: leg.id, field: "IN" as const };
    const out: FormTime = previous
      ? {
          cell: outCell,
          source: { kind: "LEAVE", legId: previous.id, place: previous.destinationName },
          tap: tapFor("LEAVE", previous.id),
          correction: correctionFor(leg.id, "OUT"),
        }
      : { cell: outCell, source: { kind: "START" }, tap: attendance?.start ?? null, correction: correctionFor(leg.id, "OUT") };
    const timeIn: FormTime = leg.isFinal || (endsAtLastLeg && index === legs.length - 1)
      ? { cell: inCell, source: { kind: "END" }, tap: attendance?.end ?? null, correction: correctionFor(leg.id, "IN") }
      : {
          cell: inCell,
          source: { kind: "ARRIVE", legId: leg.id, place: leg.destinationName },
          tap: tapFor("ARRIVE", leg.id),
          correction: correctionFor(leg.id, "IN"),
        };
    return { leg, out, in: timeIn };
  });
}

/** A tap's Manila time as "HH:MM", 24-hour, as the form is written. */
export const manilaHhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** What prints for a form time: the Admin's entry, else the tap, else null (missing). */
export function formTimeValue(time: FormTime): string | null {
  if (time.correction) return time.correction.time;
  return time.tap ? manilaHhmm(time.tap.at) : null;
}

/**
 * How many TIME OUT / TIME IN cells are still empty (same rule as
 * trip_times_missing, 0046): a stop reported missed (0061) needs no Time In,
 * and the leg after it no Time Out.
 */
export const missingTimes = (times: LegTimes[], missed: ReadonlySet<string> = new Set()) =>
  times.reduce(
    (count, item, index) =>
      count +
      Number(!formTimeValue(item.out) && !(index > 0 && missed.has(times[index - 1].leg.id))) +
      Number(!formTimeValue(item.in) && !missed.has(item.leg.id)),
    0,
  );

/**
 * Whether a stop tap could have been at its destination, with the same
 * allowance for the phone's error margin as taps at ANONANG. Null when it
 * can't be checked: no position, or the destination has none saved.
 */
export function atStop(location: StopTapLocation | null): boolean | null {
  if (!location || location.distanceM === null) return null;
  return location.distanceM - Math.min(location.accuracyM ?? 0, MAX_ACCURACY_ALLOWANCE_M) <= BASE_RADIUS_M;
}

/** Where a stop tap was, e.g. "at City Hall", "1.2 km from City Hall (±20 m)", "no place location set" or "no location". */
export function stopPlaceLabel(location: StopTapLocation | null, place: string): string {
  if (!location) return "no location";
  if (location.distanceM === null) return "no place location set";
  if (location.distanceM <= BASE_RADIUS_M) return `at ${place}`;
  const margin = location.accuracyM === null ? "" : ` (±${distanceLabel(location.accuracyM)})`;
  return `${distanceLabel(location.distanceM)} from ${place}${margin}`;
}

/** One step of a trip as the Driver sees it, in route order. */
export type TripStep = {
  time: FormTime;
  /** done: tapped; next: the one button to press; skipped: passed without a tap; missed: a stop reported missed (0061); later: still ahead. */
  state: "done" | "next" | "skipped" | "missed" | "later";
};

/**
 * The trip as a simple list of steps for the Driver: Start trip, then
 * Arrived / Leaving at each stop, then End trip. Exactly one step is "next"
 * until End trip is tapped; a step before the latest tap that was never
 * tapped is "skipped" (an Admin fills its time in). Arrived and Leaving at
 * a stop reported missed are "missed": the next step after them is next.
 */
export function tripSteps(times: LegTimes[], missed: ReadonlySet<string> = new Set()): TripStep[] {
  const sequence = times.flatMap((item) => [item.out, item.in]);
  const isMissed = (time: FormTime) => "legId" in time.source && missed.has(time.source.legId);
  let last = -1;
  sequence.forEach((time, index) => {
    if (time.tap || isMissed(time)) last = index;
  });
  return sequence.map((time, index) => ({
    time,
    state: time.tap ? "done" : isMissed(time) ? "missed" : index < last ? "skipped" : index === last + 1 ? "next" : "later",
  }));
}

/** "13:07" as "1:07 PM", to match how taps read; "" stays "". */
export function hhmmLabel(hhmm: string): string {
  if (!hhmm) return "";
  const [hours, minutes] = hhmm.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}
