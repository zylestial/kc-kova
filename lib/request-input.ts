import { z } from "zod";
import type { RequestInput } from "@/lib/kova-api";
import { isoDate, parseWith, text, trimmedText } from "@/lib/validation";

const destination = z
  .object({ destinationId: text, destinationOther: trimmedText, purposeId: text, purposeOther: trimmedText })
  .refine((row) => row.destinationId || row.destinationOther)
  .refine((row) => row.purposeId || row.purposeOther);

const requestBody = z.object({
  date: isoDate,
  projectId: text,
  projectOther: trimmedText,
  vehiclePlate: z.string().trim().min(1),
  destinations: z.array(destination).min(1),
});

/**
 * Shape-checks a New request / Edit request body before it reaches the
 * RPC. Only structure is checked here; the date rules, active options and
 * edit lock are enforced by create_request/update_request in Postgres. A
 * request type in the body is ignored: the route derives it from the date.
 * Returns null when the body isn't usable.
 */
export function parseRequestInput(body: unknown): RequestInput | null {
  return parseWith(requestBody, body);
}
