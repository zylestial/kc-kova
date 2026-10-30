import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requestAccessError, saveWithRename, toAccount, usernameToAuthEmail } from "@/lib/supabase/accounts";

describe("usernameToAuthEmail", () => {
  it("lowercases and trims the username before building the email", () => {
    expect(usernameToAuthEmail("  Jane.Doe  ")).toBe("jane.doe@accounts.kova.internal");
  });

  it("is stable for the same username", () => {
    expect(usernameToAuthEmail("driver1")).toBe(usernameToAuthEmail("driver1"));
  });
});

describe("toAccount", () => {
  it("maps a DB row onto the Account shape", () => {
    const account = toAccount({
      id: "11111111-1111-1111-1111-111111111111",
      username: "jane",
      name: "Jane Doe",
      role: "Requester",
      status: "Active",
      position: "Purchasing Officer",
      driver_type: null,
      can_request_daily: false,
      can_request_company: true,
      can_drive_company: true,
      tour_seen_at: null,
    });
    expect(account).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      name: "Jane Doe",
      username: "jane",
      role: "Requester",
      status: "Active",
      position: "Purchasing Officer",
      driverType: undefined,
      canRequestDaily: false,
      canRequestCompany: true,
      canDriveCompany: true,
      tourSeen: false,
    });
  });
});

describe("requestAccessError", () => {
  it("explains the request-access constraints, and nothing else", () => {
    expect(requestAccessError({ message: 'violates check constraint "accounts_truck_drivers_cannot_request"' })).toBe(
      "A Truck driver can't be allowed to make requests.",
    );
    expect(requestAccessError({ message: 'violates check constraint "accounts_company_trips_need_position"' })).toBe(
      "Add a Position to allow company trips.",
    );
    expect(requestAccessError({ message: "something else" })).toBeNull();
    expect(requestAccessError(null)).toBeNull();
  });
});

// The Auth user's made-up email, and the usernames other accounts already have.
let authEmail = "";
let taken: string[] = [];
const updateUserById = vi.fn(async (_id: string, { email }: { email: string }) => {
  authEmail = email;
  return { error: null };
});
const admin = {
  from: () => ({
    select: () => ({
      ilike: (_: string, username: string) => ({
        neq: () => ({ maybeSingle: async () => ({ data: taken.includes(username.toLowerCase()) ? { id: "other" } : null }) }),
      }),
    }),
  }),
  auth: { admin: { updateUserById } },
} as unknown as SupabaseClient;

const saved = { data: { id: "a1" }, error: null };
const refusedRow = { data: null, error: { code: "23514", message: "accounts_company_trips_need_position" } };

describe("saveWithRename", () => {
  beforeEach(() => {
    authEmail = usernameToAuthEmail("ana");
    taken = [];
    updateUserById.mockClear();
  });

  it("moves the Auth user, then saves the row", async () => {
    const save = vi.fn(async () => saved);
    expect(await saveWithRename(admin, "a1", "ana", "ana.cruz", save)).toEqual({ result: saved });
    expect(save).toHaveBeenCalledOnce();
    expect(authEmail).toBe(usernameToAuthEmail("ana.cruz"));
  });

  it("moves the Auth user back when the row is refused, so the old username still signs in", async () => {
    expect(await saveWithRename(admin, "a1", "ana", "ana.cruz", async () => refusedRow)).toEqual({ result: refusedRow });
    expect(authEmail).toBe(usernameToAuthEmail("ana"));
  });

  it("saves nothing when the new username is taken", async () => {
    taken = ["ben"];
    const save = vi.fn(async () => saved);
    expect(await saveWithRename(admin, "a1", "ana", "Ben", save)).toEqual({ refused: { status: 409, message: "Username already exists." } });
    expect(save).not.toHaveBeenCalled();
    expect(authEmail).toBe(usernameToAuthEmail("ana"));
  });

  it("only saves the row for a change of case", async () => {
    await saveWithRename(admin, "a1", "ana", "Ana", async () => saved);
    expect(updateUserById).not.toHaveBeenCalled();
  });
});
