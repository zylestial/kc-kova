import type { AttendanceTap, Schedule, ScheduleRevision, TripAttendance } from "@/lib/kova-api";
import { dateInBusinessTimezone } from "@/lib/timezone";

/** How far from ANONANG a tap may be and still count as at base, in metres. */
export const BASE_RADIUS_M = 150;

/** Why a tap needs an Admin's eye; an empty list means it was at base, on the day. */
export type TapFlag = "off-base" | "no-location" | "late";

export const tapFlagLabel: Record<TapFlag, string> = {
  "off-base": "Away from ANONANG",
  "no-location": "No location",
  late: "Tapped after the trip day",
};

/**
 * Flags for one Start/End tap. Away from base is a recorded distance over
 * BASE_RADIUS_M; late is a tap on a later Asia/Manila day than the trip.
 */
export function tapFlags(tap: AttendanceTap, scheduleDate: string): TapFlag[] {
  const flags: TapFlag[] = [];
  if (!tap.location) flags.push("no-location");
  else if (tap.location.distanceM > BASE_RADIUS_M) flags.push("off-base");
  if (dateInBusinessTimezone(tap.at) > scheduleDate) flags.push("late");
  return flags;
}

/** A tap's time in Manila, e.g. "8:05 AM". */
export function tapTimeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
}

/** Where a tap was, e.g. "at ANONANG", "1.2 km from ANONANG" or "no location". */
export function tapPlaceLabel(tap: AttendanceTap): string {
  if (!tap.location) return "no location";
  return tap.location.distanceM > BASE_RADIUS_M ? `${distanceLabel(tap.location.distanceM)} from ANONANG` : "at ANONANG";
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
