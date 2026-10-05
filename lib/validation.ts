import { z } from "zod";

/**
 * Shared Zod pieces for request bodies. Routes only shape-check here; the
 * business rules (dates, ownership, conflicts) stay in Postgres.
 */

/** A string, or "" when missing or not a string. */
export const text = z.string().catch("");

/** A trimmed string, or "" when missing or not a string. */
export const trimmedText = z.string().trim().catch("");

/** A calendar date as YYYY-MM-DD. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A list of non-empty strings. */
export const ids = z.array(z.string().min(1));

/** The row version a form was opened on: a whole number (a numeric string is accepted). */
export const rowVersion = z.coerce.number().int();

/** A body that carries only a row version. */
export const rowVersionBody = z.object({ rowVersion });

/** The parsed body, or null when it doesn't match the schema. */
export function parseWith<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> | null {
  const result = schema.safeParse(body);
  return result.success ? result.data : null;
}
