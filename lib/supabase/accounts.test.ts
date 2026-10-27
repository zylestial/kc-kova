import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { saveWithRename, usernameToAuthEmail } from "@/lib/supabase/accounts";

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
