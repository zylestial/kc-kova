import type { AttendanceTap, Schedule, ScheduleRevision, TripAttendance } from "@/lib/kova-api";
import { dateInBusinessTimezone } from "@/lib/timezone";

/** How far from ANONANG a tap may be and still count as at base, in metres. */
export const BASE_RADIUS_M = 150;

/**
 * The most of a phone's own error margin (its reported accuracy) a tap gets
 * the benefit of. A rough first reading indoors is often off by a few hundred
 * metres; past this, the reading is too vague to excuse.
 */
export const MAX_ACCURACY_ALLOWANCE_M = 250;

/**
 * Whether a position could be within BASE_RADIUS_M of ANONANG, allowing for
 * the phone's error margin (up to MAX_ACCURACY_ALLOWANCE_M): 350 m away at
 * ±250 m could be at base, 350 m at ±20 m couldn't.
 */
export function couldBeAtBase(location: NonNullable<AttendanceTap["location"]>): boolean {
  return location.distanceM - Math.min(location.accuracyM ?? 0, MAX_ACCURACY_ALLOWANCE_M) <= BASE_RADIUS_M;
}

/** Why a tap needs an Admin's eye; an empty list means it was at base, on the day. */
export type TapFlag = "off-base" | "no-location" | "late";

export const tapFlagLabel: Record<TapFlag, string> = {
  "off-base": "Away from ANONANG",
  "no-location": "No location",
  late: "Tapped after the trip day",
};

/**
 * Flags for one Start/End tap. Away from base is a position that couldn't be
 * within BASE_RADIUS_M even allowing for the phone's error margin; late is a
 * tap on a later Asia/Manila day than the trip.
 */
export function tapFlags(tap: AttendanceTap, scheduleDate: string): TapFlag[] {
  const flags: TapFlag[] = [];
  if (!tap.location) flags.push("no-location");
  else if (!couldBeAtBase(tap.location)) flags.push("off-base");
  if (dateInBusinessTimezone(tap.at) > scheduleDate) flags.push("late");
  return flags;
}

/** A tap's time in Manila, e.g. "8:05 AM". */
export function tapTimeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
}

/**
 * Where a tap was, e.g. "at ANONANG", "1.2 km from ANONANG (±20 m)" or "no
 * location". Past BASE_RADIUS_M the phone's error margin is shown, so a rough
 * reading is easy to tell from a Driver who really was elsewhere.
 */
export function tapPlaceLabel(tap: AttendanceTap): string {
  const location = tap.location;
  if (!location) return "no location";
  if (location.distanceM <= BASE_RADIUS_M) return "at ANONANG";
  const margin = location.accuracyM === null ? "" : ` (±${distanceLabel(location.accuracyM)})`;
  return `${distanceLabel(location.distanceM)} from ANONANG${margin}`;
}

/** "near Rizal St, Bolaoen, Pangasinan" for a tap flagged away from base with a known address; null otherwise. */
export function tapNearLabel(tap: AttendanceTap): string | null {
  return tap.location?.address && !couldBeAtBase(tap.location) ? `near ${tap.location.address}` : null;
}

/** The position exactly as the phone reported it, e.g. "16.106913, 120.436222" (6 decimals, about 0.1 m). */
export function coordinatesLabel(location: { lat: number; lng: number }): string {
  return `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`;
}

/** "45 m" or "1.2 km". */
export function distanceLabel(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

/** A link that opens the position in Google Maps; no API key needed. */
export function mapUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export type AttendanceStatus = "COMPLETE" | "STARTED" | "MISSING";

export const attendanceStatusLabel: Record<AttendanceStatus, string> = {
  COMPLETE: "Started and ended",
  STARTED: "Not ended",
  MISSING: "Not started",
};

/** One Driver's day on one schedule, for the Admin's Attendance screen. */
export type AttendanceRow = {
  schedule: Schedule;
  revision: ScheduleRevision;
  attendance: TripAttendance | null;
  status: AttendanceStatus;
  /** Flags across both taps, without repeats. */
  flags: TapFlag[];
};

/**
 * Every published, active schedule on or before `today`, with its taps (if
 * any), newest first. A trip still ahead isn't listed: nobody can be absent
 * from it yet.
 */
export function buildAttendanceRows(schedules: Schedule[], attendance: TripAttendance[], today: string): AttendanceRow[] {
  const rows = schedules.flatMap((schedule) => {
    if (schedule.status !== "ACTIVE" || schedule.date > today) return [];
    const revision = schedule.revisions.find((item) => item.id === schedule.publishedRevisionId);
    if (!revision) return [];
    const taps = attendance.find((item) => item.scheduleId === schedule.id) ?? null;
    const status: AttendanceStatus = !taps ? "MISSING" : taps.end ? "COMPLETE" : "STARTED";
    const flags = taps
      ? [...new Set([...tapFlags(taps.start, schedule.date), ...(taps.end ? tapFlags(taps.end, schedule.date) : [])])]
      : [];
    return [{ schedule, revision, attendance: taps, status, flags }];
  });
  return rows.sort((a, b) => b.schedule.date.localeCompare(a.schedule.date) || a.revision.driverName.localeCompare(b.revision.driverName));
}
