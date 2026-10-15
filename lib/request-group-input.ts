import { z } from "zod";
import type { RequestForm, RequestGroupInput } from "@/lib/kova-api";
import { isoDate, parseWith, text, trimmedText } from "@/lib/validation";

const stop = z.object({
  id: z.string().uuid().optional().catch(undefined),
  projectId: text,
  projectOther: trimmedText,
  destinationId: text,
  destinationOther: trimmedText,
  purposeId: text,
  purposeOther: trimmedText,
  urgentReasonId: text,
  details: trimmedText.pipe(z.string().max(150)),
  flexibility: z.enum(["DAY", "FIXED", "WEEK"]).catch("DAY"),
  fixedTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .catch(""),
  contact: trimmedText,
  supplierId: text,
});

const groupBody = z.object({
  date: isoDate,
  stops: z.array(stop).max(20),
  startingPointId: text,
  vehiclePlate: trimmedText,
  driverId: text,
  supervisorId: text,
  headId: text,
  siteOfficer: trimmedText,
  siteCompany: trimmedText,
});

/**
 * Shape-checks a Daily or Company Trip request body before it reaches
 * create_request_group / update_request_group. Only structure is checked
 * here; every rule (who may ask, required fields, active choices, the
 * date, locks) is enforced in Postgres (0052). Returns null when the body
 * isn't usable.
 */
export function parseRequestGroupInput(body: unknown): RequestGroupInput | null {
  return parseWith(groupBody, body);
}

export function parseRequestForm(body: unknown): RequestForm | null {
  return parseWith(z.object({ form: z.enum(["DAILY", "COMPANY"]) }), body)?.form ?? null;
}
