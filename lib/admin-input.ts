import { z } from "zod";
import type { Role } from "@/lib/kova-api";

/**
 * Body schemas for the Admin-only routes (accounts, vehicles, booking
 * options). Shape only: uniqueness, driver assignment and the Admin check
 * itself are enforced in Postgres and the routes.
 */

const ROLES = ["Requester", "Scheduler", "Admin", "Driver"] as const satisfies readonly Role[];
const STATUSES = ["Active", "Inactive"] as const;

/** A non-blank string, trimmed. */
const required = z.string().trim().min(1);
const status = z.enum(STATUSES);
/** A status that falls back to Active when missing or unknown (creating). */
const statusOrActive = status.catch("Active");
/** An optional id: a blank or missing value means none. */
const optionalId = z
  .string()
  .catch("")
  .transform((id) => id || null);

export const createAccountBody = z.object({
  name: required,
  username: required,
  role: z.enum(ROLES),
  status: statusOrActive,
  password: z.string().min(1),
});

export const updateAccountBody = z.object({ name: required, username: required, role: z.enum(ROLES), status });

/** Any string; the password policy gives the message for a bad one. */
export const passwordBody = z.object({ password: z.string() }).catch({ password: "" });

export const createVehicleBody = z.object({ plate: required, name: required, status: statusOrActive, assignedDriverId: optionalId });

export const updateVehicleBody = z.object({ plate: required, name: required, status, assignedDriverId: optionalId });

export const bookingOptionBody = z.object({
  name: required,
  status: statusOrActive,
  isOtherStop: z.unknown().optional().transform((value) => value === true),
  /** Destinations only; missing or null clears it. */
  location: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .nullable()
    .default(null),
});
