import { describe, expect, it } from "vitest";
import type { Account } from "@/lib/kova-api";
import { canRequestCompany, canRequestDaily, canRequestTransport } from "@/lib/request-access";

const account = (role: Account["role"], over: Partial<Account> = {}) => ({
  role,
  status: "Active" as const,
  driverType: role === "Driver" ? ("Truck" as const) : undefined,
  canRequestDaily: false,
  canRequestCompany: false,
  ...over,
});

describe("request access", () => {
  it("lets Requesters and Admins make Daily requests, but not Schedulers", () => {
    expect(canRequestDaily(account("Requester"))).toBe(true);
    expect(canRequestDaily(account("Admin"))).toBe(true);
    expect(canRequestDaily(account("Scheduler"))).toBe(false);
  });

  it("needs the switch for company trips", () => {
    expect(canRequestCompany(account("Requester"))).toBe(false);
    expect(canRequestCompany(account("Requester", { canRequestCompany: true }))).toBe(true);
    expect(canRequestCompany(account("Scheduler", { canRequestCompany: true }))).toBe(false);
  });

  it("lets every Admin request company trips, switch or not (0059)", () => {
    expect(canRequestCompany(account("Admin"))).toBe(true);
    expect(canRequestCompany(account("Admin", { status: "Inactive" }))).toBe(false);
  });

  it("lets a Driver ask only when allowed, and only a Company car driver", () => {
    expect(canRequestTransport(account("Driver"))).toBe(false);
    expect(canRequestDaily(account("Driver", { driverType: "Company car" }))).toBe(false);
    expect(canRequestDaily(account("Driver", { driverType: "Company car", canRequestDaily: true }))).toBe(true);
    expect(canRequestCompany(account("Driver", { driverType: "Company car", canRequestCompany: true }))).toBe(true);
    expect(canRequestTransport(account("Driver", { canRequestDaily: true, canRequestCompany: true }))).toBe(false);
  });

  it("refuses inactive accounts", () => {
    expect(canRequestTransport(account("Requester", { status: "Inactive", canRequestCompany: true }))).toBe(false);
  });
});
