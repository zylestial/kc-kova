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

/** Monday to Saturday of a date's week: the days vehicles run. */
export const weekDays = (date: string) => Array.from({ length: 6 }, (_, index) => addDays(mondayOf(date), index));

/** "52-A" for a stop of a request group, "" for an older request. */
export const stopNumber = (request: TransportRequest) => (request.group ? `${request.group.number}-${request.stopLetter}` : "");

const waiting = (request: TransportRequest) => request.status === "ACTIVE" && request.progress === "NOT_YET_SCHEDULED";

/** How high a stop sits in "To plan": Urgent, then a fixed time, then any time that day. */
export const stopRank = (request: TransportRequest) =>
  (request.requestType === "URGENT" ? 100 : 0) + (request.flexibility === "FIXED" ? 30 : request.flexibility === "DAY" ? 15 : 0);

const byRank = (a: TransportRequest, b: TransportRequest) =>
  stopRank(b) - stopRank(a) || (a.fixedTime ?? "").localeCompare(b.fixedTime ?? "") || a.createdAt.localeCompare(b.createdAt);

/** Stops for this day still waiting, other than "any day that week" ones. */
export const toPlan = (requests: TransportRequest[], day: string) =>
  requests.filter((request) => waiting(request) && request.date === day && request.flexibility !== "WEEK").sort(byRank);

/** "Any day that week" stops still waiting, for the week this day is in. */
export const weekStops = (requests: TransportRequest[], day: string) =>
  requests
    .filter((request) => waiting(request) && request.flexibility === "WEEK" && mondayOf(request.date) === mondayOf(day))
    .sort((a, b) => a.date.localeCompare(b.date) || byRank(a, b));

/** What the day strip shows under each day. */
export function dayCounts(requests: TransportRequest[], day: string) {
  const stops = toPlan(requests, day);
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
 * submitted for the Admin.
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
export const isLocked = (state: TripState) => state === "SUBMITTED" || state === "CHANGES_SUBMITTED";
