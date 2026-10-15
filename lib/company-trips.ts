import type { CompanyTripRun, TransportRequest, TripAttendance } from "@/lib/kova-api";

/**
 * Company trip rules (Company Trip Flow prototype): which stops can share a
 * trip, and the steps the requester taps on My Trips. The database decides
 * for real (0054_company_trips.sql, 0055).
 */

/** A trip has at most this many legs (0027). */
export const MAX_TRIP_LEGS = 8;

/**
 * Whether two stops can share a trip: the same vehicle and Driver (the
 * requester picked them), one department and one starting point.
 */
export function canShareTrip(a: TransportRequest, b: TransportRequest) {
  const ga = a.group;
  const gb = b.group;
  return (
    !!ga &&
    !!gb &&
    ga.vehiclePlate === gb.vehiclePlate &&
    ga.driver?.id === gb.driver?.id &&
    ga.department?.id === gb.department?.id &&
    ga.startingPoint?.id === gb.startingPoint?.id
  );
}

export type CompanyStep = {
  /** "START", "END", or "ARRIVE:<leg id>" / "LEAVE:<leg id>". */
  key: string;
  kind: "START" | "ARRIVE" | "LEAVE" | "END";
  legId?: string;
  label: string;
  /** When it was tapped, if it has been. */
  at?: string;
};

/**
 * A Company trip's taps in route order (0055): Start trip at the starting
 * point, Arrived and Leaving at each stop but the last, then End trip on
 * arriving at the last stop.
 */
export function companyTripSteps(
  legs: Array<{ id: string; origin: string; destinationName: string }>,
  run: { startAt: string; endAt?: string } | undefined,
  taps: Array<{ legId: string; kind: "ARRIVE" | "LEAVE"; at: string }>,
): CompanyStep[] {
  if (!legs.length) return [];
  const tapAt = (legId: string, kind: "ARRIVE" | "LEAVE") => taps.find((tap) => tap.legId === legId && tap.kind === kind)?.at;
  const last = legs.at(-1)!;
  return [
    { key: "START", kind: "START", label: `Start trip at ${legs[0].origin}`, at: run?.startAt },
    ...legs.slice(0, -1).flatMap((leg) => [
      { key: `ARRIVE:${leg.id}`, kind: "ARRIVE" as const, legId: leg.id, label: `Arrived at ${leg.destinationName}`, at: tapAt(leg.id, "ARRIVE") },
      { key: `LEAVE:${leg.id}`, kind: "LEAVE" as const, legId: leg.id, label: `Leaving ${leg.destinationName}`, at: tapAt(leg.id, "LEAVE") },
    ]),
    { key: "END", kind: "END", label: `Arrived at ${last.destinationName} · End trip`, at: run?.endAt },
  ];
}

/**
 * A Company trip's Start and End trip in the shape of a Driver's attendance,
 * so the form's times (lib/stop-times legTimes) come out the same way.
 */
export function runAsAttendance(run: CompanyTripRun | undefined): TripAttendance | undefined {
  if (!run) return undefined;
  return {
    id: run.id,
    scheduleId: run.scheduleId,
    revisionId: run.revisionId,
    driverId: "",
    start: { at: run.startAt, recordedByAccountId: "", location: null },
    end: run.endAt ? { at: run.endAt, recordedByAccountId: "", location: null } : undefined,
  };
}
