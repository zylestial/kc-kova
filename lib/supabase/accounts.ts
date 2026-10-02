import type { Account, Role } from "@/lib/kova-api";

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

type AccountRow = {
  id: string;
  username: string;
  name: string;
  role: Role;
  status: "Active" | "Inactive";
};

export function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    status: row.status,
  };
}
