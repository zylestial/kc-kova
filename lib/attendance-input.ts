import { z } from "zod";
import type { AttendanceInput, CompanyRunInput, StopTapInput, TripTimeInput } from "@/lib/kova-api";
import { parseWith } from "@/lib/validation";

const location = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).nullable().catch(null),
});

const attendanceBody = z.object({
  kind: z.enum(["START", "END"]),
  location: location.nullable().default(null),
});

/**
 * Shape-checks a Start/End trip body before it reaches
 * record_trip_attendance: the kind of tap and, when the phone shared it, a
 * position in range (accuracy is optional). Who may tap, and when, is
 * enforced in Postgres. Returns null when the body isn't usable.
 */
export function parseAttendanceInput(body: unknown): AttendanceInput | null {
  return parseWith(attendanceBody, body);
}

const companyRunBody = z.object({
  kind: z.enum(["START", "END"]),
  odometer: z.number().int().min(0).max(9_999_999),
  location: location.nullable().default(null),
});

/**
 * Shape-checks a Company trip's Start/End trip body (0055): the kind, a
 * whole-number odometer reading and the optional position. Whether it may
 * be recorded, and that the end isn't below the start, is checked in
 * Postgres. Returns null when the body isn't usable.
 */
export function parseCompanyRunInput(body: unknown): CompanyRunInput | null {
  return parseWith(companyRunBody, body);
}

const stopTapBody = z.object({
  legId: z.uuid(),
  kind: z.enum(["ARRIVE", "LEAVE"]),
  location: location.nullable().default(null),
});

/**
 * Shape-checks an Arrived/Leaving body before it reaches record_stop_tap:
 * the leg, the kind of tap and the optional position. Returns null when the
 * body isn't usable.
 */
export function parseStopTapInput(body: unknown): StopTapInput | null {
  return parseWith(stopTapBody, body);
}

const tripTimeBody = z.object({
  legId: z.uuid(),
  field: z.enum(["OUT", "IN"]),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
});

/**
 * Shape-checks an Admin's Time Out / Time In before it reaches
 * set_trip_time: the leg, which time, and "HH:MM" (or null to clear).
 * Returns null when the body isn't usable.
 */
export function parseTripTimeInput(body: unknown): TripTimeInput | null {
  return parseWith(tripTimeBody, body);
}
