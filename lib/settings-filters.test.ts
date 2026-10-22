import { describe, expect, it } from "vitest";
import type { Account, Vehicle } from "@/lib/kova-api";
import { VEHICLE_VIEWS, accountFiltersSet, accountMatches, noAccountFilters, vehicleNeedsDriver } from "@/lib/settings-filters";

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

describe("vehicle views", () => {
  const drivers = new Set(["d1"]);
  const view = (id: string) => VEHICLE_VIEWS.find((v) => v.id === id)!;

  it("splits vehicles by what they're used for", () => {
    expect(view("company").test(vehicle({ companyTrips: true }), drivers)).toBe(true);
    expect(view("daily").test(vehicle({ companyTrips: true }), drivers)).toBe(false);
    expect(view("no-odometer").test(vehicle({ hasOdometer: false }), drivers)).toBe(true);
    expect(view("inactive").test(vehicle({ status: "Inactive" }), drivers)).toBe(true);
  });

  it("flags an active Daily vehicle without an active Driver", () => {
    expect(vehicleNeedsDriver(vehicle(), drivers)).toBe(true);
    expect(vehicleNeedsDriver(vehicle({ assignedDriverId: "gone" }), drivers)).toBe(true);
    expect(vehicleNeedsDriver(vehicle({ assignedDriverId: "d1" }), drivers)).toBe(false);
    expect(vehicleNeedsDriver(vehicle({ companyTrips: true }), drivers)).toBe(false);
    expect(vehicleNeedsDriver(vehicle({ status: "Inactive" }), drivers)).toBe(false);
  });
});
