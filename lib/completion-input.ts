export type CompletionInput = {
  startOdometer: number;
  endOdometer: number;
  fullTank: boolean | null;
  fleetCardUsed: boolean | null;
  gasReceiptAttached: boolean | null;
};

/** A field that's optional and tri-state: true, false, or left unanswered (null/absent). */
function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * Shape-checks a Complete trip body before it reaches submit_completion.
 * Odometers must be whole numbers, start no lower than 0 and end no lower
 * than start; whether the trip has ended and who may complete it are
 * enforced in Postgres. The three return checks are optional and never
 * required to complete a trip. Returns null when the body isn't usable.
 */
export function parseCompletionInput(body: unknown): CompletionInput | null {
  if (!body || typeof body !== "object") return null;
  const { startOdometer, endOdometer, fullTank, fleetCardUsed, gasReceiptAttached } = body as Record<string, unknown>;
  if (!Number.isSafeInteger(startOdometer) || !Number.isSafeInteger(endOdometer)) return null;
  const start = startOdometer as number;
  const end = endOdometer as number;
  if (start < 0 || end < start) return null;
  return {
    startOdometer: start,
    endOdometer: end,
    fullTank: optionalBoolean(fullTank),
    fleetCardUsed: optionalBoolean(fleetCardUsed),
    gasReceiptAttached: optionalBoolean(gasReceiptAttached),
  };
}

/** A problem note, trimmed; null when missing or blank. */
export function parseProblemNote(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const note = (body as Record<string, unknown>).note;
  if (typeof note !== "string") return null;
  return note.trim() || null;
}

export type HandleProblemInput = { handlingNote: string; followUpScheduleId: string | null };

/**
 * Shape-checks a Mark handled body: a required handling note (trimmed) and
 * an optional follow-up schedule id. Whether that schedule is a different,
 * active one is enforced in Postgres. Returns null when the body isn't usable.
 */
export function parseHandleProblemInput(body: unknown): HandleProblemInput | null {
  if (!body || typeof body !== "object") return null;
  const { handlingNote, followUpScheduleId } = body as Record<string, unknown>;
  if (typeof handlingNote !== "string" || !handlingNote.trim()) return null;
  if (followUpScheduleId != null && typeof followUpScheduleId !== "string") return null;
  return { handlingNote: handlingNote.trim(), followUpScheduleId: followUpScheduleId || null };
}
