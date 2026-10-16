import type { Account, Schedule, ScheduleRevision, TransportRequest, Vehicle } from "@/lib/kova-api";
import { addDays } from "@/lib/timezone";
import { currentRevision, openRevision, publishedRevision } from "@/lib/trip-record";

/**
 * The Scheduling page (prototype "KOVA Scheduler"): one screen per day with
 * what's still to plan on the left and every vehicle's trips on the right.
 * These are its pure rules; the database stays the authority on saves.
 */

/** Monday of a "YYYY-MM-DD" date's week. */
export function mondayOf(date: string) {
  const weekday = new Date(date + "T12:00:00").getDay();
  return addDays(date, -((weekday + 6) % 7));
}

/** "52-A" for a stop of a request group, "" for an older request. */
export const stopNumber = (request: TransportRequest) => (request.group ? `${request.group.number}-${request.stopLetter}` : "");

export type TripKind = "DAILY" | "COMPANY";

/**
 * The Scheduling page opened on a day and kind, and with `tripId` on that
 * trip's vehicle; the old planner links and notifications lead here.
 */
export function schedulingHref(date?: string, kind?: TripKind, tripId?: string) {
  const query = [date && `date=${encodeURIComponent(date)}`, kind && `type=${kind}`, tripId && `trip=${encodeURIComponent(tripId)}`]
    .filter(Boolean)
    .join("&");
  return query ? `/scheduling?${query}` : "/scheduling";
}

/** Daily Vehicle Trip or Company Trip; requests made before groups are Daily. */
export const kindOf = (request: TransportRequest): TripKind => request.group?.form ?? "DAILY";

const waiting = (request: TransportRequest) => request.status === "ACTIVE" && request.progress === "NOT_YET_SCHEDULED";
const ofKind = (request: TransportRequest, kind?: TripKind) => !kind || kindOf(request) === kind;

/** How high a stop sits in "To plan": Urgent, then a fixed time, then any time that day. */
export const stopRank = (request: TransportRequest) =>
  (request.requestType === "URGENT" ? 100 : 0) + (request.flexibility === "FIXED" ? 30 : request.flexibility === "DAY" ? 15 : 0);

const byRank = (a: TransportRequest, b: TransportRequest) =>
  stopRank(b) - stopRank(a) || (a.fixedTime ?? "").localeCompare(b.fixedTime ?? "") || a.createdAt.localeCompare(b.createdAt);

/** Stops for this day still waiting, other than "any day that week" ones; of one kind when given. */
export const toPlan = (requests: TransportRequest[], day: string, kind?: TripKind) =>
  requests
    .filter((request) => waiting(request) && ofKind(request, kind) && request.date === day && request.flexibility !== "WEEK")
    .sort(byRank);

/** "Any day that week" stops still waiting, for the week this day is in. */
export const weekStops = (requests: TransportRequest[], day: string, kind?: TripKind) =>
  requests
    .filter(
      (request) => waiting(request) && ofKind(request, kind) && request.flexibility === "WEEK" && mondayOf(request.date) === mondayOf(day),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || byRank(a, b));

/**
 * Stops that may go on any day from today (0065): missed on the road, or
 * still waiting after their day passed. Listed on every other day, so they
 * don't drop off Scheduling; adding one to a trip moves it to that day.
 */
export const carriedStops = (requests: TransportRequest[], day: string, today: string, kind?: TripKind) =>
  requests
    .filter(
      (request) =>
        waiting(request) &&
        ofKind(request, kind) &&
        (!!request.missedAt || request.date < today) &&
        request.date !== day &&
        !(request.flexibility === "WEEK" && mondayOf(request.date) === mondayOf(day)),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || byRank(a, b));

/** What the day strip shows under each day. */
export function dayCounts(requests: TransportRequest[], day: string, kind?: TripKind) {
  const stops = toPlan(requests, day, kind);
  return { toPlan: stops.length, urgent: stops.filter((stop) => stop.requestType === "URGENT").length };
}

/**
 * Where a stop goes, for grouping: its destination, and for a Company Trip
 * also the requester's vehicle, since only that vehicle can take it.
 */
export function placeKey(request: TransportRequest) {
  const destination = request.destinations[0];
  const place = destination?.destinationId ?? `other:${destination?.destinationName ?? ""}`;
  return request.group?.form === "COMPANY" ? `company:${request.group.vehiclePlate}:${place}` : place;
}

/** Stops at the same place, most urgent place first; a group of one is a single stop. */
export function placeGroups(stops: TransportRequest[]): TransportRequest[][] {
  const groups = new Map<string, TransportRequest[]>();
  for (const stop of stops) groups.set(placeKey(stop), [...(groups.get(placeKey(stop)) ?? []), stop]);
  return [...groups.values()]
    .map((group) => group.sort(byRank))
    .sort((a, b) => Math.max(...b.map(stopRank)) - Math.max(...a.map(stopRank)));
}

export type Trip = { schedule: Schedule; revision: ScheduleRevision };

export type VehicleRow = {
  vehicle: Vehicle;
  /** A vehicle that can be requested for company trips takes Company trips only. */
  kind: "DAILY" | "COMPANY";
  /** The vehicle's Driver for Daily trips; Company trips use the Driver each requester picked. */
  driver?: Account;
  trips: Trip[];
};

/** Every vehicle that can run this day, with its trips that day (several only for Company trips). */
export function vehicleRows(vehicles: Vehicle[], accounts: Account[], schedules: Schedule[], day: string): VehicleRow[] {
  const trips = schedules
    .filter((schedule) => schedule.status === "ACTIVE" && schedule.date === day)
    .flatMap((schedule) => {
      const revision = currentRevision(schedule);
      return revision ? [{ schedule, revision }] : [];
    });
  return vehicles
    .filter((vehicle) => vehicle.status === "Active" || trips.some((trip) => trip.revision.plate === vehicle.plate))
    .map((vehicle) => {
      const driver = accounts.find(
        (account) => account.id === vehicle.assignedDriverId && account.role === "Driver" && account.status === "Active",
      );
      return {
        vehicle,
        kind: vehicle.companyTrips ? ("COMPANY" as const) : ("DAILY" as const),
        driver: vehicle.companyTrips ? undefined : driver,
        trips: trips
          .filter((trip) => trip.revision.plate === vehicle.plate)
          .sort((a, b) => (a.revision.legs[0]?.plannedTimeOut ?? "").localeCompare(b.revision.legs[0]?.plannedTimeOut ?? "")),
      };
    })
    .sort((a, b) => (a.kind === b.kind ? a.vehicle.name.localeCompare(b.vehicle.name) : a.kind === "DAILY" ? -1 : 1));
}

export type TripState = "DRAFT" | "RETURNED" | "SUBMITTED" | "APPROVED" | "CHANGES" | "CHANGES_SUBMITTED" | "ON_THE_ROAD";

/**
 * Where a trip stands, as the prototype names it. An approved trip with an
 * open version has changes on the way: a draft only the Scheduler sees, or
 * submitted for the Admin (on a trip on the road too: approved changes are
 * written onto the route the Driver follows, 0060).
 */
export function tripState(schedule: Schedule, started: boolean): TripState {
  const open = openRevision(schedule);
  const published = publishedRevision(schedule);
  if (published && open) return open.status === "SUBMITTED" ? "CHANGES_SUBMITTED" : "CHANGES";
  if (open) return open.status as "DRAFT" | "RETURNED" | "SUBMITTED";
  return started ? "ON_THE_ROAD" : "APPROVED";
}

export const tripStateLabel: Record<TripState, string> = {
  DRAFT: "Draft · not sent",
  RETURNED: "Returned",
  SUBMITTED: "Waiting for Admin",
  APPROVED: "Approved",
  CHANGES: "Draft changes · not sent",
  CHANGES_SUBMITTED: "Changes waiting for Admin",
  ON_THE_ROAD: "On the road",
};

/** The tag colour for each state (globals.css .sc-tag). */
export const tripStateTone: Record<TripState, "ok" | "warn" | "error" | "info"> = {
  DRAFT: "warn",
  RETURNED: "error",
  SUBMITTED: "warn",
  APPROVED: "ok",
  CHANGES: "warn",
  CHANGES_SUBMITTED: "warn",
  ON_THE_ROAD: "info",
};

/** Waiting for the Admin: nothing about it can change until it's approved or returned. */
/** Submitted and waiting for the Admin; the Scheduler can still change it (0057). */
export const isWaiting = (state: TripState) => state === "SUBMITTED" || state === "CHANGES_SUBMITTED";
