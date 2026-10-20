import { z } from "zod";
import { DRIVER_TYPES, type Role } from "@/lib/kova-api";

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

/**
 * Who may request what (0051). The Driver-only fields are dropped for
 * other roles; a Truck driver with a switch on, or company trips without a
 * Position, is refused by the database's constraints.
 */
const requestAccess = {
  position: z.string().trim().catch(""),
  driverType: z.enum(DRIVER_TYPES).catch("Truck"),
  canRequestDaily: z.boolean().catch(false),
  canRequestCompany: z.boolean().catch(false),
};
/** An email as typed, lowercased; "" when missing. The routes say when one is required or invalid. */
const optionalEmail = z.string().trim().toLowerCase().catch("");

function forRole<T extends { role: Role; driverType: string; canRequestDaily: boolean }>(body: T) {
  return body.role === "Driver" ? body : { ...body, driverType: null, canRequestDaily: false };
}

export const updateAccountBody = z
  .object({ name: required, username: required, role: z.enum(ROLES), status, email: optionalEmail, ...requestAccess })
  .transform(forRole);

/** Any string; the password policy gives the message for a bad one. */
export const passwordBody = z.object({ password: z.string() }).catch({ password: "" });

/** "Can be requested for company trips"; off unless sent (0051). */
const companyTrips = z.boolean().catch(false);

export const createVehicleBody = z.object({
  plate: required,
  name: required,
  status: statusOrActive,
  assignedDriverId: optionalId,
  companyTrips,
});

export const updateVehicleBody = z.object({ plate: required, name: required, status, assignedDriverId: optionalId, companyTrips });

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

const email = z.email();

/**
 * The emails an Admin pasted to invite: split on spaces, commas, semicolons
 * or new lines, lowercased, with repeats dropped. Anything that isn't an
 * email comes back in `invalid` so the Admin can fix it.
 */
export function parseEmailList(input: string) {
  const items = [...new Set(input.split(/[\s,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))];
  return {
    valid: items.filter((item) => email.safeParse(item).success),
    invalid: items.filter((item) => !email.safeParse(item).success),
  };
}

/**
 * A batch of invites: one role and set of request permissions for every
 * email in it. Switches the role can't have are turned off here, the same
 * way the Add Account form sends them (0051, 0059).
 */
export const inviteBody = z
  .object({ emails: z.string().catch(""), role: z.enum(ROLES), ...requestAccess })
  .transform(forRole)
  .transform((body) => {
    const carDriver = body.role === "Driver" && body.driverType === "Company car";
    const companyAllowed = body.role === "Requester" || body.role === "Admin" || carDriver;
    return {
      emails: body.emails,
      role: body.role,
      driverType: body.driverType,
      canRequestDaily: carDriver && body.canRequestDaily,
      canRequestCompany: companyAllowed && body.canRequestCompany,
    };
  });
