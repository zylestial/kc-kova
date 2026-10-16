import type { BookingOption, ScheduleInput, ScheduleLeg, TransportRequest } from "@/lib/kova-api";
import { canShareTrip, MAX_TRIP_LEGS } from "@/lib/company-trips";
import { MAX_LEGS, openRevision, publishedRevision } from "@/lib/trip-record";
import { tripState, type Trip, type VehicleRow } from "@/lib/scheduling";
import {
  BASE_PLACE,
  driveMinutes,
  estimateTimes,
  startTime,
  stayFor,
  stayMinutes,
  toMinutes,
  type EstimateLeg,
  type Place,
} from "@/lib/trip-estimate";

/**
 * Where a stop (or a "Plan together" group) can go on the Scheduling page
 * (prototype "Fit it in" and drag and drop): for each vehicle, the trip it
 * would join or start, where on the route, when it would arrive, and the
 * draft that gets saved. save_schedule_draft and create_company_trip stay
 * the authority; this only shows the choice before a save.
 */

export type PlanContext = {
  requests: TransportRequest[];
  destinations: BookingOption[];
  day: string;
  isToday: boolean;
  /** "HH:MM" in Manila. */
  now: string;
  started: (scheduleId: string) => boolean;
  /** How many legs from the start of a trip on the road the Driver has reached: they can't change (0060). */
  reached: (scheduleId: string) => number;
};

export type PlanOption = {
  row: VehicleRow;
  /** The trip it joins; none for a new trip. */
  trip?: Trip;
  /** The open version to save over; null to start changes to an approved trip. */
  rowVersion: number | null;
  input: ScheduleInput;
  /** "HH:MM" the first of these stops is reached. */
  arrive: string;
  /** "HH:MM" the trip ends. */
  end: string;
  /** Minutes this adds to the trip (the whole trip for a new one). */
  extra: number;
  /** Stops with a fixed time this would make late. */
  late: string[];
  /** Why it can't go here; "" when it can. */
  blocked: string;
  /** How it fits, e.g. "Free now · new trip" or "After Wilcon". */
  label: string;
  /** It changes an approved trip, so it goes into draft changes for the Admin. */
  needsAdmin: boolean;
  /** The trip is waiting for the Admin: this takes it back to draft, to resubmit. */
  takesBack: boolean;
  /** The trip is on the road: this changes it straight away, for the Driver (0060). */
  live: boolean;
};

/** A leg being worked on: what save_schedule_draft takes, with the times the Scheduler set. */
export type WorkLeg = {
  /** A saved leg's id, kept so the Driver's taps stay on it (0060). */
  id?: string;
  destinationId?: string;
  stops: string[];
  isFinal: boolean;
  contactName: string;
  contactNumber: string;
  timeOut?: string;
  timeIn?: string;
};

/** After this a trip runs past the Driver's day (prototype WORK_END). */
export const DAY_END = "18:00";

/** A stop that can go any time doesn't share a fixed-time leg the vehicle would wait longer than this for. */
const MAX_WAIT = 30;

/** A fixed-time stop counts as late more than 5 minutes either side of its time. */
const isLate = (fixed: string, arrive: string) => Math.abs(toMinutes(arrive) - toMinutes(fixed)) > 5;

/**
 * Times a trip's legs from its start (lib/trip-estimate): each leg's place
 * from its destination's saved location, its stay from the purposes it
 * serves, a fixed-time stop's time, and the times the Scheduler set
 * (timeOut / timeIn on the leg). A Daily trip leaves ANONANG; a Company trip
 * leaves its starting point, which has no saved location.
 */
export function legTimer(context: Pick<PlanContext, "requests" | "destinations">, company: boolean) {
  const { requests, destinations } = context;
  const requestOf = (stopId: string) => requests.find((request) => request.destinations.some((item) => item.id === stopId));
  const placeOf = (destinationId?: string): Place | null =>
    destinationId ? (destinations.find((option) => option.id === destinationId)?.location ?? null) : null;
  const estimateLeg = (leg: WorkLeg): EstimateLeg => {
    if (leg.isFinal) return { place: BASE_PLACE, stay: 0, timeOut: leg.timeOut, timeIn: leg.timeIn };
    const served = leg.stops.map(requestOf).filter((request): request is TransportRequest => !!request);
    const fixed = served.filter((request) => request.flexibility === "FIXED" && request.fixedTime).map((request) => request.fixedTime!);
    return {
      place: placeOf(leg.destinationId),
      stay: served.length ? stayMinutes(served.map((request) => request.urgentReason?.name ?? request.destinations[0]?.purposeName ?? "")) : stayFor("fuel"),
      fixedTime: fixed.sort()[0],
      timeOut: leg.timeOut,
      timeIn: leg.timeIn,
    };
  };
  const timed = <T extends WorkLeg>(legs: T[], start: string) => {
    const times = estimateTimes(legs.map(estimateLeg), start, company ? null : BASE_PLACE);
    return legs.map((leg, index) => ({ ...leg, ...times[index] }));
  };
  /** Minutes the vehicle waits at a timed leg before its time: arriving later than the drive takes. */
  const waitAt = (legs: Array<WorkLeg & { timeOut: string; timeIn: string }>, index: number) => {
    const from = index === 0 ? (company ? null : BASE_PLACE) : estimateLeg(legs[index - 1]).place;
    return toMinutes(legs[index].timeIn) - toMinutes(legs[index].timeOut) - driveMinutes(from, estimateLeg(legs[index]).place);
  };
  /** Requests with a fixed time these timed legs reach more than 5 minutes off. */
  const lateIn = (legs: Array<WorkLeg & { timeIn: string }>) =>
    legs.flatMap((leg) =>
      leg.stops.flatMap((stopId) => {
        const request = requestOf(stopId);
        return request?.flexibility === "FIXED" && request.fixedTime && isLate(request.fixedTime, leg.timeIn) ? [request.id] : [];
      }),
    );
  return { timed, lateIn, waitAt, requestOf };
}

/** Best first: vehicles that can take it, fewest late stops, ending by 6 PM, then the soonest (Urgent) or the fewest added minutes. */
export function planOptions(stops: TransportRequest[], rows: VehicleRow[], context: PlanContext): PlanOption[] {
  const urgent = stops.some((stop) => stop.requestType === "URGENT");
  return rows
    .map((row) => planOn(stops, row, context))
    .sort(
      (a, b) =>
        Number(!!a.blocked) - Number(!!b.blocked) ||
        a.late.length - b.late.length ||
        Number(a.end > DAY_END) - Number(b.end > DAY_END) ||
        (urgent ? a.arrive.localeCompare(b.arrive) : a.extra - b.extra),
    );
}

/** The best way to add these stops to one vehicle's day. */
export function planOn(stops: TransportRequest[], row: VehicleRow, context: PlanContext): PlanOption {
  const { requests } = context;
  const company = row.kind === "COMPANY";
  const { timed, lateIn, waitAt, requestOf } = legTimer(context, company);
  const stopIds = stops.map((stop) => stop.destinations[0]?.id).filter((id): id is string => !!id);
  const newLeg: WorkLeg = {
    destinationId: stops[0].destinations[0]?.destinationId,
    stops: stopIds,
    isFinal: false,
    contactName: stops.map((stop) => stop.contact).filter(Boolean).join(", ").slice(0, 100),
    contactNumber: "",
  };
  const toInput = (legs: Array<WorkLeg & { timeOut: string; timeIn: string }>, requestIds: string[]): ScheduleInput => ({
    date: context.day,
    plate: row.vehicle.plate,
    requestIds,
    legs: legs.map((leg) => ({
      ...(leg.id ? { id: leg.id } : {}),
      destinationId: leg.isFinal ? undefined : leg.destinationId,
      plannedTimeOut: leg.timeOut,
      plannedTimeIn: leg.timeIn,
      contactName: leg.contactName,
      contactNumber: leg.contactNumber,
      stops: leg.isFinal ? [] : leg.stops,
      isFinal: leg.isFinal,
    })),
  });
  const ids = stops.map((stop) => stop.id);
  const fail = (blocked: string): PlanOption => ({
    row,
    rowVersion: null,
    input: { date: context.day, plate: row.vehicle.plate, requestIds: ids, legs: [] },
    arrive: "",
    end: "",
    extra: 0,
    late: [],
    blocked,
    label: "",
    needsAdmin: false,
    takesBack: false,
    live: false,
  });

  if (company) {
    const asked = stops.find((stop) => stop.group?.vehiclePlate !== row.vehicle.plate);
    if (asked) return fail(`Asked for ${asked.group?.vehiclePlate ?? "another vehicle"}`);
  } else if (!row.driver) {
    return fail("No Driver assigned");
  }

  // The trip these stops would join: a Daily vehicle's one trip; a Company
  // vehicle's trip for the same department, Driver and starting point that
  // hasn't started (once one has, the next goes after it as a new trip).
  const joinable = row.trips.find(
    (trip) =>
      !company ||
      (!context.started(trip.schedule.id) &&
        trip.revision.requestIds.some((id) => {
          const request = requests.find((item) => item.id === id);
          return request && canShareTrip(request, stops[0]);
        })),
  );
  const fresh = (start: string): PlanOption => {
    const legs = timed(company ? [newLeg] : [newLeg, { isFinal: true, stops: [], contactName: "", contactNumber: "" }], start);
    const end = legs.at(-1)!.timeIn;
    return {
      row,
      rowVersion: null,
      input: toInput(legs, ids),
      arrive: legs[0].timeIn,
      end,
      extra: toMinutes(end) - toMinutes(start),
      late: lateIn(legs),
      blocked: "",
      label: `Free${context.isToday ? " now" : ""} · new trip`,
      needsAdmin: false,
      takesBack: false,
      live: false,
    };
  };

  if (!joinable) {
    if (!row.trips.length) return fresh(startTime(context.isToday, context.now));
    if (!company) return fail("Already has a trip");
    // Another Company trip that day: start after the last one ends.
    const lastEnd = row.trips
      .flatMap((trip) => trip.revision.legs.map((leg) => leg.plannedTimeIn))
      .filter(Boolean)
      .sort()
      .at(-1);
    const start = startTime(context.isToday, context.now);
    const after = lastEnd ? Math.max(toMinutes(start), toMinutes(lastEnd) + 15) : toMinutes(start);
    return fresh(`${String(Math.floor(after / 60)).padStart(2, "0")}:${String(after % 60).padStart(2, "0")}`);
  }

  const state = tripState(joinable.schedule, context.started(joinable.schedule.id));
  // On the road, the stops go in after the legs the Driver has reached,
  // straight onto the route the Driver follows (0060).
  const live = state === "ON_THE_ROAD";
  const revision = (live && publishedRevision(joinable.schedule)) || joinable.revision;
  const reached = live ? context.reached(joinable.schedule.id) : 0;
  const base: WorkLeg[] = revision.legs.map((leg: ScheduleLeg) => ({
    id: leg.id,
    destinationId: leg.destinationId,
    stops: leg.stops,
    isFinal: leg.isFinal,
    contactName: leg.contactName,
    contactNumber: leg.contactNumber,
    timeOut: leg.plannedTimeOut || undefined,
    timeIn: leg.plannedTimeIn || undefined,
  }));
  const start = base[0]?.timeOut ?? startTime(context.isToday, context.now);
  const baseTimed = timed(base, start);
  const baseEnd = baseTimed.at(-1)?.timeIn ?? start;
  const wasLate = new Set(lateIn(baseTimed));
  // Times the Scheduler set stay before the change; from it on, they're estimated again.
  const unpinFrom = (legs: WorkLeg[], from: number) =>
    legs.map((leg, index) => (index < from ? leg : index === 0 ? { ...leg, timeIn: undefined } : { ...leg, timeOut: undefined, timeIn: undefined }));

  const last = base.findIndex((leg) => leg.isFinal);
  const every = Array.from({ length: (last === -1 ? base.length : last) + 1 }, (_, index) => index).filter((at) => at >= reached);
  // A Company trip keeps the requester's order: 52-A before 52-B.
  const inOrder = (at: number) =>
    base.every((leg, index) =>
      leg.stops.every((id) => {
        const other = requestOf(id);
        if (!other?.group || other.group.id !== stops[0].group?.id) return true;
        return other.stopLetter < stops[0].stopLetter === index < at;
      }),
    );
  const ordered = company ? every.filter(inOrder) : every;
  const positions = ordered.length ? ordered : every;
  // As its own leg: fewest late fixed-time stops, then the earliest end; on
  // a tie the later place, so fewer legs move.
  let best: { legs: Array<WorkLeg & { timeOut: string; timeIn: string }>; at: number; late: number } | null = null;
  for (const at of positions) {
    const candidate = timed(unpinFrom([...base.slice(0, at), newLeg, ...base.slice(at)], at), start);
    const late = lateIn(candidate).length;
    const ends = toMinutes(candidate.at(-1)!.timeIn);
    if (!best || late < best.late || (late === best.late && ends <= toMinutes(best.legs.at(-1)!.timeIn)))
      best = { legs: candidate, at, late };
  }
  let legs = best!.legs;
  let label = best!.at === 0 ? (company ? "First stop" : "First stop after ANONANG") : `After ${revision.legs[best!.at - 1].destinationName}`;
  // Sharing a leg the trip already has at that place is better, unless it
  // makes more stops late, or mixes fixed-time and any-time stops on a leg
  // the vehicle would wait at: then the any-time stop goes in its own leg.
  const same = base.findIndex((leg) => !leg.isFinal && leg.destinationId && leg.destinationId === newLeg.destinationId);
  if (same >= reached) {
    const merged = timed(
      unpinFrom(
        base.map((leg, index) => (index === same ? { ...leg, stops: [...leg.stops, ...stopIds] } : leg)),
        same,
      ),
      start,
    );
    const fixed = merged[same].stops.filter((id) => requestOf(id)?.flexibility === "FIXED");
    const mixed = fixed.length > 0 && fixed.length < merged[same].stops.length;
    if (lateIn(merged).length <= best!.late && !(mixed && waitAt(merged, same) > MAX_WAIT)) {
      legs = merged;
      label = `Combine with the ${revision.legs[same].destinationName} stop`;
    }
  }
  const index = legs.findIndex((leg) => stopIds.some((id) => leg.stops.includes(id)));
  const end = legs.at(-1)!.timeIn;
  const open = openRevision(joinable.schedule);
  return {
    row,
    trip: joinable,
    rowVersion: live ? revision.rowVersion : open ? open.rowVersion : null,
    input: toInput(legs, [...new Set([...revision.requestIds, ...ids])]),
    arrive: legs[index].timeIn,
    end,
    extra: toMinutes(end) - toMinutes(baseEnd),
    late: lateIn(legs).filter((id) => !wasLate.has(id)),
    blocked: legs.length > (company ? MAX_TRIP_LEGS : MAX_LEGS) ? `Over ${company ? MAX_TRIP_LEGS : MAX_LEGS} legs` : "",
    label,
    needsAdmin: !live && !open,
    takesBack: !live && open?.status === "SUBMITTED",
    live,
  };
}
