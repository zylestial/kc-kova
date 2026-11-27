import { z } from "zod";
import type { CompanyTripInput } from "@/lib/kova-api";
import { isoDate, parseWith, text, trimmedText } from "@/lib/validation";

const time = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .catch("");

const body = z.object({
  date: isoDate,
  departmentId: text,
  vehiclePlate: trimmedText,
  driverId: text,
  purpose: trimmedText.pipe(z.string().max(300)),
  fleetCard: trimmedText,
  priority: z.enum(["REGULAR", "URGENT"]).catch("REGULAR"),
  urgentReasonId: text,
  timeOut: time,
  stops: z.array(z.object({ destinationId: text, arriveAt: time, leaveAt: time })).max(8),
  passengers: z
    .array(z.union([z.object({ accountId: z.string().uuid() }).strict(), z.object({ guestName: z.string().trim().min(1).max(100) }).strict()]))
    .max(15),
});

/**
 * Shape-checks a Company trip request before it reaches
 * request_company_trip (0094). Only structure is checked here; every rule
 * (who may ask, the vehicle and people being free, the fleet card, the
 * times) is enforced in Postgres. Returns null when the body isn't usable.
 */
export function parseCompanyTripInput(input: unknown): CompanyTripInput | null {
  return parseWith(body, input);
}
