import { z } from "zod";
import type { AttendanceInput } from "@/lib/kova-api";
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
