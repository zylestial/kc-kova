import type { AttendanceTap, ScheduleLeg, StopTap, StopTapLocation, TripAttendance, TripTimeCorrection } from "@/lib/kova-api";
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

/** A stop tap's identity, e.g. "ARRIVE:<leg id>". */
export const stopKey = (source: { kind: string; legId?: string }) => `${source.kind}:${source.legId ?? ""}`;

/**
 * The TIME OUT and TIME IN of each leg, from Start/End trip, the stop taps
 * and any Admin entries (which print in place of the tap).
 */
export function legTimes(
  legs: ScheduleLeg[],
  attendance: TripAttendance | undefined,
  taps: StopTap[],
  corrections: TripTimeCorrection[] = [],
): LegTimes[] {
  const tapFor = (kind: StopTap["kind"], legId: string) => taps.find((tap) => tap.kind === kind && tap.legId === legId) ?? null;
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
    const timeIn: FormTime = leg.isFinal
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

/** How many TIME OUT / TIME IN cells are still empty (same rule as trip_times_missing, 0046). */
export const missingTimes = (times: LegTimes[]) =>
  times.reduce((count, item) => count + Number(!formTimeValue(item.out)) + Number(!formTimeValue(item.in)), 0);

/**
 * The stop taps a Driver may make now, as stopKey()s: the next one after the
 * latest tap in route order, and the one after it, so a forgotten Arrived
 * can be passed by tapping Leaving (and a forgotten Leaving by the next
 * Arrived), in that order. Nothing before Start trip or after End trip.
 */
export function openStopTaps(times: LegTimes[]): Set<string> {
  const sequence = times.flatMap((item) => [item.out, item.in]);
  if (!sequence[0]?.tap || sequence[sequence.length - 1]?.tap) return new Set();
  let last = 0;
  sequence.forEach((time, index) => {
    if (time.tap) last = index;
  });
  return new Set(
    sequence
      .slice(last + 1)
      .filter((time) => time.source.kind === "ARRIVE" || time.source.kind === "LEAVE")
      .slice(0, 2)
      .map((time) => stopKey(time.source)),
  );
}

/**
 * Whether a stop tap could have been at its destination, with the same
 * allowance for the phone's error margin as taps at ANONANG. Null when it
 * can't be checked: no position, or the destination has none saved.
 */
export function atStop(location: StopTapLocation | null): boolean | null {
  if (!location || location.distanceM === null) return null;
  return location.distanceM - Math.min(location.accuracyM ?? 0, MAX_ACCURACY_ALLOWANCE_M) <= BASE_RADIUS_M;
}

/** Where a stop tap was, e.g. "at City Hall", "1.2 km from City Hall (±20 m)", "location not checked" or "no location". */
export function stopPlaceLabel(location: StopTapLocation | null, place: string): string {
  if (!location) return "no location";
  if (location.distanceM === null) return "location not checked";
  if (location.distanceM <= BASE_RADIUS_M) return `at ${place}`;
  const margin = location.accuracyM === null ? "" : ` (±${distanceLabel(location.accuracyM)})`;
  return `${distanceLabel(location.distanceM)} from ${place}${margin}`;
}

/** One step of a trip as the Driver sees it, in route order. */
export type TripStep = {
  time: FormTime;
  /** done: tapped; next: the one button to press; skipped: passed without a tap; later: still ahead. */
  state: "done" | "next" | "skipped" | "later";
};

/**
 * The trip as a simple list of steps for the Driver: Start trip, then
 * Arrived / Leaving at each stop, then End trip. Exactly one step is "next"
 * until End trip is tapped; a step before the latest tap that was never
 * tapped is "skipped" (an Admin fills its time in).
 */
export function tripSteps(times: LegTimes[]): TripStep[] {
  const sequence = times.flatMap((item) => [item.out, item.in]);
  let last = -1;
  sequence.forEach((time, index) => {
    if (time.tap) last = index;
  });
  return sequence.map((time, index) => ({
    time,
    state: time.tap ? "done" : index < last ? "skipped" : index === last + 1 ? "next" : "later",
  }));
}
