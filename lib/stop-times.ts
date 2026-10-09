import type { AttendanceTap, ScheduleLeg, StopTap, StopTapLocation, TripAttendance } from "@/lib/kova-api";
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

/** One form time: where it comes from, and the tap once it's made. */
export type FormTime = {
  source: TimeSource;
  tap: (Omit<AttendanceTap, "location"> & { location: StopTapLocation | null }) | null;
};

export type LegTimes = { leg: ScheduleLeg; out: FormTime; in: FormTime };

/** A stop tap's identity, e.g. "ARRIVE:<leg id>". */
export const stopKey = (source: { kind: string; legId?: string }) => `${source.kind}:${source.legId ?? ""}`;

/**
 * The TIME OUT and TIME IN of each leg, from Start/End trip and the stop
 * taps. A time is null until its tap is made.
 */
export function legTimes(legs: ScheduleLeg[], attendance: TripAttendance | undefined, taps: StopTap[]): LegTimes[] {
  const tapFor = (kind: StopTap["kind"], legId: string) => taps.find((tap) => tap.kind === kind && tap.legId === legId) ?? null;
  return legs.map((leg, index) => {
    const previous = legs[index - 1];
    const out: FormTime = previous
      ? { source: { kind: "LEAVE", legId: previous.id, place: previous.destinationName }, tap: tapFor("LEAVE", previous.id) }
      : { source: { kind: "START" }, tap: attendance?.start ?? null };
    const timeIn: FormTime = leg.isFinal
      ? { source: { kind: "END" }, tap: attendance?.end ?? null }
      : { source: { kind: "ARRIVE", legId: leg.id, place: leg.destinationName }, tap: tapFor("ARRIVE", leg.id) };
    return { leg, out, in: timeIn };
  });
}

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
