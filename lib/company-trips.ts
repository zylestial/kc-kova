import type { CompanyTripRun, Schedule, ScheduleInput, TransportRequest, TripAttendance } from "@/lib/kova-api";
import { currentRevision, poolOrder } from "@/lib/trip-record";

/**
 * The Company trip planner's rules (Company Trip Flow prototype, "Plan").
 * The database decides for real (0054_company_trips.sql); these let the
 * planner show the same thing before a save.
 */

/** Where the timeline starts and ends, in minutes after midnight (6 AM to 7 PM). */
export const DAY_START = 6 * 60;
export const DAY_END = 19 * 60;
/** The estimate allows this long for each drive, and this long at each stop. */
const DRIVE = 30;
const STAY = 30;
/** A trip has at most this many legs (0027). */
export const MAX_TRIP_LEGS = 8;

export const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};
export const toTime = (minutes: number) => {
  const clamped = Math.max(0, Math.min(minutes, 23 * 60 + 59));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
};

/** "52-A" for a stop of a request group. */
export const stopNumber = (request: TransportRequest) =>
  request.group ? `${request.group.number}-${request.stopLetter}` : "";

/** A day's Company Trip stops that are still active. */
export function companyStops(requests: TransportRequest[], date: string) {
  return requests.filter((request) => request.group?.form === "COMPANY" && request.status === "ACTIVE" && request.date === date);
}

/** Stops waiting to be planned, most urgent first: Urgent, then fixed times, any time that day, any day that week. */
export function waitingStops(stops: TransportRequest[]) {
  return stops.filter((request) => request.progress === "NOT_YET_SCHEDULED").sort(poolOrder);
}

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

/** Waiting stops, kept together when requested together, in the order they're listed. */
export function linkedRuns(stops: TransportRequest[]): TransportRequest[][] {
  const runs: TransportRequest[][] = [];
  for (const stop of stops) {
    const last = runs.at(-1);
    if (last && stop.group && last[0].group?.id === stop.group.id) last.push(stop);
    else runs.push([stop]);
  }
  return runs;
}

export type TripLeg = { requestId: string; plannedTimeOut: string; plannedTimeIn: string };

/**
 * A first guess at each leg's times: from 8 AM (or in time for the first
 * fixed-time stop), half an hour's drive to each stop and half an hour
 * there. A fixed-time stop is reached at its time when that's later.
 */
export function estimateLegs(stops: TransportRequest[]): TripLeg[] {
  const firstFixed = stops.findIndex((stop) => stop.flexibility === "FIXED" && stop.fixedTime);
  let at = 8 * 60;
  if (firstFixed >= 0) at = Math.max(DAY_START, toMinutes(stops[firstFixed].fixedTime!) - DRIVE - firstFixed * (DRIVE + STAY));
  return stops.map((stop) => {
    let timeIn = at + DRIVE;
    if (stop.flexibility === "FIXED" && stop.fixedTime && toMinutes(stop.fixedTime) > timeIn) timeIn = toMinutes(stop.fixedTime);
    const leg = { requestId: stop.id, plannedTimeOut: toTime(timeIn - DRIVE), plannedTimeIn: toTime(timeIn) };
    at = timeIn + STAY;
    return leg;
  });
}

/** The legs as save_schedule_draft takes them: one per stop, in order, with no leg back to ANONANG. */
export function tripInput(date: string, plate: string, stops: TransportRequest[], legs: TripLeg[]): ScheduleInput {
  const byId = new Map(stops.map((stop) => [stop.id, stop]));
  return {
    date,
    plate,
    requestIds: legs.map((leg) => leg.requestId),
    legs: legs.map((leg) => {
      const stop = byId.get(leg.requestId)!;
      const destination = stop.destinations[0];
      return {
        destinationId: destination?.destinationId,
        plannedTimeOut: leg.plannedTimeOut,
        plannedTimeIn: leg.plannedTimeIn,
        contactName: stop.contact,
        contactNumber: "",
        stops: destination ? [destination.id] : [],
        isFinal: false,
      };
    }),
  };
}

/** What's wrong with a trip's times, in the planner's words; [] when it can be saved. */
export function legProblems(legs: TripLeg[], stops: TransportRequest[]): string[] {
  const problems: string[] = [];
  if (!legs.length) problems.push("Pick at least one stop.");
  if (legs.length > MAX_TRIP_LEGS) problems.push(`A trip can have at most ${MAX_TRIP_LEGS} stops.`);
  const byId = new Map(stops.map((stop) => [stop.id, stop]));
  legs.forEach((leg, index) => {
    const name = stopNumber(byId.get(leg.requestId)!) || `Leg ${index + 1}`;
    if (!leg.plannedTimeOut || !leg.plannedTimeIn) problems.push(`${name}: enter Time Out and Time In.`);
    else if (toMinutes(leg.plannedTimeIn) <= toMinutes(leg.plannedTimeOut)) problems.push(`${name}: Time In must be after Time Out.`);
    const previous = legs[index - 1];
    if (previous?.plannedTimeIn && leg.plannedTimeOut && toMinutes(leg.plannedTimeOut) < toMinutes(previous.plannedTimeIn))
      problems.push(`${name}: Time Out can't be before the previous stop's Time In.`);
  });
  return problems;
}

/** A day's Company trips that are still live, with the version a Scheduler works from. */
export function companyTripsOn(schedules: Schedule[], date: string) {
  return schedules
    .filter((schedule) => schedule.kind === "COMPANY" && schedule.status === "ACTIVE" && schedule.date === date)
    .map((schedule) => ({ schedule, revision: currentRevision(schedule)! }))
    .filter((trip) => !!trip.revision);
}

/** First Time Out to last Time In, or null while a leg has no times. */
export function tripSpan(legs: Array<{ plannedTimeOut: string; plannedTimeIn: string }>) {
  if (!legs.length || legs.some((leg) => !leg.plannedTimeOut || !leg.plannedTimeIn)) return null;
  return { start: legs[0].plannedTimeOut, end: legs.at(-1)!.plannedTimeIn };
}

/** Whether two time spans overlap (touching ends don't). */
export function overlaps(a: { start: string; end: string }, b: { start: string; end: string }) {
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);
}

/** Where a time sits on the timeline, as a percentage of its width. */
export function timelinePercent(time: string) {
  const minutes = Math.min(Math.max(toMinutes(time), DAY_START), DAY_END);
  return ((minutes - DAY_START) / (DAY_END - DAY_START)) * 100;
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
