import { describe, expect, it } from "vitest";
import { toAccount, usernameToAuthEmail } from "@/lib/supabase/accounts";

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
      role: "Booker",
      status: "Active",
      project: "Site A",
    });
    expect(account).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      name: "Jane Doe",
      username: "jane",
      role: "Booker",
      status: "Active",
      project: "Site A",
    });
  });

  it("maps a null project to undefined", () => {
    const account = toAccount({
      id: "1",
      username: "jane",
      name: "Jane Doe",
      role: "Admin",
      status: "Active",
      project: null,
    });
    expect(account.project).toBeUndefined();
  });
});
