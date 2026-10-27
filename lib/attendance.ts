import type { AttendanceTap, CompanyTripRun, Schedule, ScheduleRevision, TripAttendance } from "@/lib/kova-api";
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
export type TapFlag = "off-base" | "no-location" | "late" | "sent-later";

export const tapFlagLabel: Record<TapFlag, string> = {
  "off-base": "Away from ANONANG",
  "no-location": "No location",
  late: "Tapped after the trip day",
  "sent-later": "Saved on the phone, sent later",
};

/**
 * How long after its time a tap saved on the phone (0077) may reach KOVA
 * before it's flagged. The phone's time is trusted only between the step
 * before and the moment KOVA got it, so a tap sent much later could also be
 * one given an earlier time on purpose: the Admin judges which.
 */
export const SENT_LATER_AFTER_MS = 5 * 60 * 1000;

/** Whether a tap reached KOVA at least SENT_LATER_AFTER_MS after the time it carries. */
export function sentLater(tap: { at: string; sentAt?: string }): boolean {
  return !!tap.sentAt && new Date(tap.sentAt).getTime() - new Date(tap.at).getTime() >= SENT_LATER_AFTER_MS;
}

/** "40 min", "2 h 5 min", "1 d 3 h". */
function durationLabel(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  return hours % 24 ? `${Math.floor(hours / 24)} d ${hours % 24} h` : `${Math.floor(hours / 24)} d`;
}

/**
 * What a flagged tap says about when it arrived, e.g. "Saved on the phone,
 * sent 8:40 AM (40 min later)", with the date when it came on a later
 * Manila day. "" when it isn't flagged.
 */
export function sentLaterLabel(tap: { at: string; sentAt?: string }): string {
  if (!sentLater(tap)) return "";
  const sentAt = tap.sentAt!;
  const day =
    dateInBusinessTimezone(sentAt) === dateInBusinessTimezone(tap.at)
      ? ""
      : `${new Date(sentAt).toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric" })}, `;
  const gap = durationLabel(new Date(sentAt).getTime() - new Date(tap.at).getTime());
  return `Saved on the phone, sent ${day}${tapTimeLabel(sentAt)} (${gap} later)`;
}

/**
 * Flags for one Start/End tap. Away from base is a position that couldn't be
 * within BASE_RADIUS_M even allowing for the phone's error margin; late is a
 * tap on a later Asia/Manila day than the trip; sent later is a tap saved on
 * the phone that reached KOVA SENT_LATER_AFTER_MS or more after its time
 * (0077). A Company trip starts and
 * ends away from ANONANG, so `company` taps are never flagged as away.
 */
export function tapFlags(tap: AttendanceTap, scheduleDate: string, company = false): TapFlag[] {
  const flags: TapFlag[] = [];
  if (!tap.location) flags.push("no-location");
  else if (!company && !couldBeAtBase(tap.location)) flags.push("off-base");
  if (dateInBusinessTimezone(tap.at) > scheduleDate) flags.push("late");
  if (sentLater(tap)) flags.push("sent-later");
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
export function tapPlaceLabel(tap: AttendanceTap, company = false): string {
  const location = tap.location;
  if (!location) return "no location";
  // Not measured from ANONANG (0079); the address, when the lookup found one.
  if (company) return location.address ? `near ${location.address}` : "on the map";
  if (location.distanceM <= BASE_RADIUS_M) return "at ANONANG";
  const margin = location.accuracyM === null ? "" : ` (±${distanceLabel(location.accuracyM)})`;
  return `${distanceLabel(location.distanceM)} from ANONANG${margin}`;
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

/** One Driver's day on one schedule, for the Admin's Attendance screen; a Company trip's are its Start / End trip (0079). */
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
export function buildAttendanceRows(
  schedules: Schedule[],
  attendance: TripAttendance[],
  today: string,
  companyRuns: CompanyTripRun[] = [],
): AttendanceRow[] {
  const rows = schedules.flatMap((schedule) => {
    if (schedule.status !== "ACTIVE" || schedule.date > today) return [];
    const revision = schedule.revisions.find((item) => item.id === schedule.publishedRevisionId);
    if (!revision) return [];
    const company = schedule.kind === "COMPANY";
    const run = company ? companyRuns.find((item) => item.scheduleId === schedule.id) : undefined;
    const taps: TripAttendance | null = company
      ? run?.startTap
        ? { id: run.id, scheduleId: schedule.id, revisionId: run.revisionId, driverId: revision.driverId, start: run.startTap, end: run.endTap }
        : null
      : (attendance.find((item) => item.scheduleId === schedule.id) ?? null);
    const status: AttendanceStatus = !taps ? "MISSING" : taps.end ? "COMPLETE" : "STARTED";
    const flags = taps
      ? [...new Set([...tapFlags(taps.start, schedule.date, company), ...(taps.end ? tapFlags(taps.end, schedule.date, company) : [])])]
      : [];
    return [{ schedule, revision, attendance: taps, status, flags }];
  });
  return rows.sort((a, b) => b.schedule.date.localeCompare(a.schedule.date) || a.revision.driverName.localeCompare(b.revision.driverName));
}
