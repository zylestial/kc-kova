import { z } from "zod";
import type { ScheduleInput } from "@/lib/kova-api";
import { ids, isoDate, parseWith, text, trimmedText } from "@/lib/validation";

const leg = z
  .object({
    destinationId: text,
    plannedTimeOut: text,
    plannedTimeIn: text,
    contactName: trimmedText,
    contactNumber: trimmedText,
    stops: ids.nullish().transform((stops) => stops ?? []),
    isFinal: z.unknown().optional().transform((value) => value === true),
  })
  .transform(({ destinationId, ...rest }) => ({
    ...rest,
    destinationId: rest.isFinal ? undefined : destinationId || undefined,
  }));

const scheduleBody = z.object({
  date: isoDate,
  plate: z.string().min(1),
  requestIds: ids,
  legs: z.array(leg),
});

/**
 * Shape-checks a Save draft body before it reaches save_schedule_draft.
 * Only structure is checked here; route continuity, times, the 8-leg
 * limit, request ownership of stops and reservation conflicts are
 * enforced in Postgres. Origins are never read from the body: the server
 * derives them. Returns null when the body isn't usable.
 */
export function parseScheduleInput(body: unknown): ScheduleInput | null {
  return parseWith(scheduleBody, body);
}
