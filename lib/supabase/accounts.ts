import type { Account, DriverType, Role } from "@/lib/kova-api";

/**
 * Supabase Auth requires an email, but KOVA accounts sign in with a
 * username. Every account uses a synthetic email in this fixed domain so
 * the username stays the single source of truth; account creation (Admin
 * only) must use this same helper.
 */
const AUTH_EMAIL_DOMAIN = "accounts.kova.internal";

export function usernameToAuthEmail(username: string) {
  return `${username.trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;
}

/**
 * The message for an account save refused by one of 0051's request-access
 * constraints, or null when it was something else.
 */
export function requestAccessError(error: { message?: string } | null): string | null {
  const message = error?.message ?? "";
  if (message.includes("accounts_truck_drivers_cannot_request")) return "A Truck driver can't be allowed to make requests.";
  if (message.includes("accounts_company_trips_need_position")) return "Add a Position to allow company trips.";
  return null;
}

type AccountRow = {
  id: string;
  username: string;
  name: string;
  role: Role;
  status: "Active" | "Inactive";
  position: string;
  driver_type: DriverType | null;
  can_request_daily: boolean;
  can_request_company: boolean;
};

export function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    status: row.status,
    position: row.position,
    driverType: row.driver_type ?? undefined,
    canRequestDaily: row.can_request_daily,
    canRequestCompany: row.can_request_company,
  };
}
