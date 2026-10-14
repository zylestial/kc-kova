import { describe, expect, it } from "vitest";
import { requestAccessError, toAccount, usernameToAuthEmail } from "@/lib/supabase/accounts";

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
