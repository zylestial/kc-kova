export type CompletionInput = { startOdometer: number; endOdometer: number };

/**
 * Shape-checks a Complete trip body before it reaches submit_completion.
 * Odometers must be whole numbers, start no lower than 0 and end no lower
 * than start; whether the trip has ended and who may complete it are
 * enforced in Postgres. Returns null when the body isn't usable.
 */
export function parseCompletionInput(body: unknown): CompletionInput | null {
  if (!body || typeof body !== "object") return null;
  const { startOdometer, endOdometer } = body as Record<string, unknown>;
  if (!Number.isSafeInteger(startOdometer) || !Number.isSafeInteger(endOdometer)) return null;
  const start = startOdometer as number;
  const end = endOdometer as number;
  if (start < 0 || end < start) return null;
  return { startOdometer: start, endOdometer: end };
}

/** A problem note, trimmed; null when missing or blank. */
export function parseProblemNote(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const note = (body as Record<string, unknown>).note;
  if (typeof note !== "string") return null;
  return note.trim() || null;
}
