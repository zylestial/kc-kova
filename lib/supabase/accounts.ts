import type { SupabaseClient } from "@supabase/supabase-js";
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
  can_drive_company: boolean;
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
    canDriveCompany: row.can_drive_company,
  };
}

export type NewAccount = {
  name: string;
  username: string;
  role: Role;
  status: "Active" | "Inactive";
  password: string;
  position: string;
  driverType: DriverType | null;
  canRequestDaily: boolean;
  canRequestCompany: boolean;
};

/**
 * Creates the Auth user (on the made-up email) and its `accounts` row,
 * removing the Auth user again if the row is refused. Used by the Admin's
 * Add Account and by accepting an invite. `admin` is the service-role
 * client; the password policy is the caller's to check first.
 */
export async function createAccount(
  admin: SupabaseClient,
  input: NewAccount,
): Promise<{ account: Account } | { status: number; message: string }> {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: usernameToAuthEmail(input.username),
    password: input.password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    console.error("[accounts] createUser failed:", createError);
    const isDuplicate = createError?.code === "email_exists" || /already been registered/i.test(createError?.message ?? "");
    return isDuplicate ? { status: 409, message: "Username already exists." } : { status: 422, message: "Could not create the account." };
  }

  const { data: accountRow, error: insertError } = await admin
    .from("accounts")
    .insert({
      id: created.user.id,
      username: input.username,
      name: input.name,
      role: input.role,
      status: input.status,
      position: input.position,
      driver_type: input.driverType,
      can_request_daily: input.canRequestDaily,
      can_request_company: input.canRequestCompany,
    })
    .select("*")
    .single();
  if (insertError || !accountRow) {
    console.error("[accounts] accounts insert failed:", insertError);
    await admin.auth.admin.deleteUser(created.user.id);
    if (insertError?.code === "23505") return { status: 409, message: "Username already exists." };
    return { status: 422, message: requestAccessError(insertError) ?? "Could not create the account." };
  }
  return { account: toAccount(accountRow) };
}

/**
 * Moves an account's Auth user to the made-up email for `username`, the
 * first half of a rename (the `accounts` row is the caller's). Null when
 * done, else why not. `admin` is the service-role client.
 */
export async function renameAuthUser(admin: SupabaseClient, accountId: string, username: string) {
  // Auth answers a taken email on update with a bare 500, so look first.
  const { data: owner } = await admin
    .from("accounts")
    .select("id")
    .ilike("username", username.trim().replace(/[\\%_]/g, (char) => `\\${char}`))
    .neq("id", accountId)
    .maybeSingle();
  if (owner) return { status: 409, message: "Username already exists." };
  const { error } = await admin.auth.admin.updateUserById(accountId, { email: usernameToAuthEmail(username) });
  if (!error) return null;
  const isDuplicate = error.code === "email_exists" || /already been registered/i.test(error.message ?? "");
  return isDuplicate ? { status: 409, message: "Username already exists." } : { status: 422, message: "Could not update the account." };
}
