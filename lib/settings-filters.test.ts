import { describe, expect, it } from "vitest";
import type { Account, Vehicle } from "@/lib/kova-api";
import { accountFiltersSet, accountMatches, noAccountFilters, noVehicleFilters, vehicleMatches } from "@/lib/settings-filters";

const account = (over: Partial<Account> = {}): Account => ({
  id: "a1",
  name: "Rhea Santos",
  username: "rhea",
  role: "Requester",
  status: "Active",
  position: "Clerk",
  canRequestDaily: false,
  canRequestCompany: false,
  canDriveCompany: false,
  ...over,
});
const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({ plate: "V1", name: "Vios", status: "Active", companyTrips: false, hasOdometer: true, ...over }) as Vehicle;

describe("accountMatches", () => {
  it("searches name, username and email", () => {
    expect(accountMatches(account(), { ...noAccountFilters, search: "SANTOS" })).toBe(true);
    expect(accountMatches(account(), { ...noAccountFilters, search: "@kc.ph" }, "rhea@kc.ph")).toBe(true);
    expect(accountMatches(account(), { ...noAccountFilters, search: "jun" })).toBe(false);
  });

  it("filters by type, status and who can drive or request company trips", () => {
    expect(accountMatches(account(), { ...noAccountFilters, role: "Driver" })).toBe(false);
    expect(accountMatches(account({ status: "Inactive" }), { ...noAccountFilters, status: "Active" })).toBe(false);
    const drive = { ...noAccountFilters, access: "drive-company" as const };
    expect(accountMatches(account({ canDriveCompany: true }), drive)).toBe(true);
    expect(accountMatches(account({ role: "Driver", driverType: "Company car" }), drive)).toBe(true);
    expect(accountMatches(account({ role: "Driver", driverType: "Truck" }), drive)).toBe(false);
    expect(accountMatches(account({ canRequestCompany: true }), { ...noAccountFilters, access: "request-company" })).toBe(true);
  });

  it("counts the filters set", () => {
    expect(accountFiltersSet({ ...noAccountFilters, search: " x ", role: "Admin" })).toBe(2);
  });
});

describe("vehicleMatches", () => {
  it("filters by status and company trips", () => {
    expect(vehicleMatches(vehicle(), { ...noVehicleFilters, companyTrips: "yes" })).toBe(false);
    expect(vehicleMatches(vehicle({ companyTrips: true }), { ...noVehicleFilters, companyTrips: "yes" })).toBe(true);
    expect(vehicleMatches(vehicle({ status: "Inactive" }), { ...noVehicleFilters, status: "Active" })).toBe(false);
  });
});
