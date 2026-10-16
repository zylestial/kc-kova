import { distanceMetres } from "@/lib/stop-times";

/**
 * Planned times the Scheduling page fills in (prototype "KOVA Scheduler"):
 * how long the drive between two places takes, from their saved locations,
 * and how long the vehicle stays at a stop, from its purpose. The Scheduler
 * can always type or drag a time instead.
 */

export type Place = { lat: number; lng: number };

/** ANONANG, the base every Daily trip starts and ends at (as in 0042). */
export const BASE_PLACE: Place = { lat: 16.103769, lng: 120.436222 };

/** Minutes for a drive between places without a saved location. */
export const UNKNOWN_DRIVE = 30;
/** Road distance is about this much longer than a straight line. */
const ROAD_FACTOR = 1.4;
/** Average speed in town, km/h. */
const SPEED = 25;

/** Drive minutes between two places, in 5-minute steps, at least 5. */
export function driveMinutes(from: Place | null | undefined, to: Place | null | undefined) {
  if (!from || !to) return UNKNOWN_DRIVE;
  const km = (distanceMetres(from, to) / 1000) * ROAD_FACTOR;
  if (km < 0.05) return 0;
  return Math.max(5, Math.ceil(((km / SPEED) * 60) / 5) * 5);
}

/** Minutes at a stop for one purpose. */
export function stayFor(purpose: string) {
  const name = purpose.toLowerCase();
  if (name.includes("fuel")) return 15;
  if (name.includes("site visit") || name.includes("inspection")) return 90;
  if (name.includes("deliver") || name.includes("submission") || name.includes("submit")) return 45;
  return 30;
}

/** Minutes at a stop serving several requests: the longest, plus 10 for each other one. */
export function stayMinutes(purposes: string[]) {
  if (!purposes.length) return 0;
  return Math.max(...purposes.map(stayFor)) + 10 * (purposes.length - 1);
}

export const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const toHhmm = (minutes: number) => {
  const clamped = Math.max(0, Math.min(Math.round(minutes), 23 * 60 + 59));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
};

export type EstimateLeg = {
  /** Where the leg ends; null when the place has no saved location. */
  place: Place | null;
  /** Minutes spent there before the next leg leaves (0 for the last leg). */
  stay: number;
  /** "HH:MM": a fixed-time stop on this leg, which it shouldn't reach before. */
  fixedTime?: string;
  /** "HH:MM" the Scheduler set: kept as they are. */
  timeOut?: string;
  timeIn?: string;
};

/**
 * Each leg's Time Out and Time In ("HH:MM"), from the trip's start: each
 * leg leaves when the vehicle is done at the place before, and arrives a
 * drive later, or at its fixed time if that's later. Times the Scheduler
 * set are kept, and later legs follow them.
 */
export function estimateTimes(legs: EstimateLeg[], start: string, from: Place | null = BASE_PLACE) {
  let at = toMinutes(start);
  let previous = from;
  return legs.map((leg) => {
    const out = leg.timeOut ? toMinutes(leg.timeOut) : at;
    let arrive = out + driveMinutes(previous, leg.place);
    if (leg.fixedTime && toMinutes(leg.fixedTime) > arrive) arrive = toMinutes(leg.fixedTime);
    if (leg.timeIn) arrive = toMinutes(leg.timeIn);
    at = arrive + leg.stay;
    previous = leg.place;
    return { timeOut: toHhmm(out), timeIn: toHhmm(arrive) };
  });
}

/** When a new trip starts: 8 AM, or on a trip for today, now (to the next 5 minutes) if that's later. */
export function startTime(isToday: boolean, now: string) {
  if (!isToday) return "08:00";
  const minutes = Math.ceil(toMinutes(now) / 5) * 5;
  return minutes > 8 * 60 ? toHhmm(minutes) : "08:00";
}
