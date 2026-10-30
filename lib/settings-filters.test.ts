import { describe, expect, it } from "vitest";
import type { Account, Vehicle } from "@/lib/kova-api";
import { ACCOUNT_VIEWS, VEHICLE_VIEWS, accessLabels, vehicleNeedsDriver } from "@/lib/settings-filters";

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
  tourSeen: true,
  ...over,
});
const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({ plate: "V1", name: "Vios", status: "Active", companyTrips: false, hasOdometer: true, ...over }) as Vehicle;

describe("account views", () => {
  const view = (id: string) => ACCOUNT_VIEWS.find((v) => v.id === id)!;

  it("groups people by account type", () => {
    expect(view("Requester").test(account())).toBe(true);
    expect(view("Driver").test(account())).toBe(false);
  });

  it("lists who can drive or request company trips", () => {
    expect(view("drive-company").test(account({ canDriveCompany: true }))).toBe(true);
    expect(view("drive-company").test(account({ role: "Driver", driverType: "Company car" }))).toBe(true);
    expect(view("drive-company").test(account({ role: "Driver", driverType: "Truck", canDriveCompany: true }))).toBe(false);
    expect(view("request-company").test(account({ canRequestCompany: true }))).toBe(true);
    expect(view("request-company").test(account({ role: "Admin" }))).toBe(true);
  });
});

describe("accessLabels", () => {
  it("says what an account may do", () => {
    expect(accessLabels(account())).toEqual(["Daily requests"]);
    expect(accessLabels(account({ role: "Admin", canDriveCompany: true }))).toEqual(["Daily requests", "Company trip requests", "Drives company trips"]);
    expect(accessLabels(account({ role: "Driver", driverType: "Truck" }))).toEqual([]);
    expect(accessLabels(account({ status: "Inactive" }))).toEqual([]);
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
