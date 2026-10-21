import { z } from "zod";
import { parseWith } from "@/lib/validation";

export type CompletionInput = {
  /** Both null for a vehicle without an odometer (0078). */
  startOdometer: number | null;
  endOdometer: number | null;
  fullTank: boolean | null;
  fleetCardUsed: boolean | null;
  gasReceiptAttached: boolean | null;
};

const reading = z.number().int().safe();

/** A field that's optional and tri-state: true, false, or left unanswered (null/absent). */
const optionalBoolean = z.boolean().nullable().catch(null);

const completionBody = z
  .object({
    startOdometer: reading.min(0).nullable().default(null),
    endOdometer: reading.nullable().default(null),
    fullTank: optionalBoolean,
    fleetCardUsed: optionalBoolean,
    gasReceiptAttached: optionalBoolean,
  })
  .refine(({ startOdometer: start, endOdometer: end }) =>
    start === null || end === null ? start === end : end >= start,
  );

/**
 * Shape-checks a Complete trip body before it reaches submit_completion.
 * Odometers are both left out (a vehicle without one, 0078) or both whole
 * numbers, start no lower than 0 and end no lower than start; whether the
 * vehicle needs them, whether the trip has ended and who may complete it
 * are enforced in Postgres. The three return checks are optional and never
 * required to complete a trip. Returns null when the body isn't usable.
 */
export function parseCompletionInput(body: unknown): CompletionInput | null {
  return parseWith(completionBody, body);
}

const problemBody = z.object({ note: z.string().trim().min(1) });

/** A problem note, trimmed; null when missing or blank. */
export function parseProblemNote(body: unknown): string | null {
  return parseWith(problemBody, body)?.note ?? null;
}

export type HandleProblemInput = { handlingNote: string; followUpScheduleId: string | null };

const handleProblemBody = z.object({
  handlingNote: z.string().trim().min(1),
  followUpScheduleId: z
    .string()
    .nullish()
    .transform((id) => id || null),
});

/**
 * Shape-checks a Mark handled body: a required handling note (trimmed) and
 * an optional follow-up schedule id. Whether that schedule is a different,
 * active one is enforced in Postgres. Returns null when the body isn't usable.
 */
export function parseHandleProblemInput(body: unknown): HandleProblemInput | null {
  return parseWith(handleProblemBody, body);
}
