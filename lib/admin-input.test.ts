import { describe, expect, it } from "vitest";
import {
  bookingOptionBody,
  inviteBody,
  parseEmailList,
  createAccountBody,
  createVehicleBody,
  passwordBody,
  updateAccountBody,
  updateVehicleBody,
} from "@/lib/admin-input";
import { parseWith } from "@/lib/validation";

describe("account bodies", () => {
  const account = { name: " Ana Cruz ", username: " ana ", role: "Driver", password: "drive2026" };

  it("trims names and defaults a new account to Active", () => {
    expect(parseWith(createAccountBody, account)).toEqual({
      name: "Ana Cruz",
      username: "ana",
      role: "Driver",
      status: "Active",
      password: "drive2026",
      position: "",
      driverType: "Truck",
      canRequestDaily: false,
      canRequestCompany: false,
    });
    expect(parseWith(createAccountBody, { ...account, status: "Retired" })?.status).toBe("Active");
  });

  it("keeps the Driver-only fields for Drivers only", () => {
    const driver = { ...account, driverType: "Company car", canRequestDaily: true, canRequestCompany: true, position: " Site Driver " };
    expect(parseWith(createAccountBody, driver)).toMatchObject({ driverType: "Company car", canRequestDaily: true, position: "Site Driver" });
    expect(parseWith(createAccountBody, { ...driver, role: "Requester" })).toMatchObject({
      driverType: null,
      canRequestDaily: false,
      canRequestCompany: true,
    });
  });

  it("rejects a blank name, an unknown role or a missing password", () => {
    expect(parseWith(createAccountBody, { ...account, name: "  " })).toBeNull();
    expect(parseWith(createAccountBody, { ...account, role: "Booker" })).toBeNull();
    expect(parseWith(createAccountBody, { ...account, password: "" })).toBeNull();
    expect(parseWith(createAccountBody, null)).toBeNull();
  });

  it("needs a known status when editing", () => {
    expect(parseWith(updateAccountBody, { ...account, status: "Inactive" })?.status).toBe("Inactive");
    expect(parseWith(updateAccountBody, account)).toBeNull();
  });

  it("reads any password string and treats a missing one as empty", () => {
    expect(passwordBody.parse({ password: "x" })).toEqual({ password: "x" });
    expect(passwordBody.parse(null)).toEqual({ password: "" });
  });
});

describe("vehicle bodies", () => {
  it("treats a blank driver as none", () => {
    expect(parseWith(createVehicleBody, { plate: " ABC 123 ", name: "Van", assignedDriverId: "" })).toEqual({
      plate: "ABC 123",
      name: "Van",
      status: "Active",
      assignedDriverId: null,
      companyTrips: false,
    });
  });

  it("reads 'Can be requested for company trips', off unless sent", () => {
    const body = { plate: "ABC 123", name: "Mirage", status: "Active" };
    expect(parseWith(updateVehicleBody, { ...body, companyTrips: true })?.companyTrips).toBe(true);
    expect(parseWith(updateVehicleBody, { ...body, companyTrips: "yes" })?.companyTrips).toBe(false);
  });

  it("needs a known status when editing", () => {
    expect(parseWith(updateVehicleBody, { plate: "ABC 123", name: "Van" })).toBeNull();
    expect(parseWith(updateVehicleBody, { plate: "ABC 123", name: "Van", status: "Inactive", assignedDriverId: "d1" })?.assignedDriverId).toBe("d1");
  });
});

describe("booking option body", () => {
  it("reads only a true isOtherStop", () => {
    expect(parseWith(bookingOptionBody, { name: "Shell", isOtherStop: true })).toEqual({ name: "Shell", status: "Active", isOtherStop: true, location: null });
    expect(parseWith(bookingOptionBody, { name: "Shell", location: { lat: 16.1, lng: 120.4 } })?.location).toEqual({ lat: 16.1, lng: 120.4 });
    expect(parseWith(bookingOptionBody, { name: "Shell", location: { lat: 91, lng: 120.4 } })).toBeNull();
    expect(parseWith(bookingOptionBody, { name: "Shell", isOtherStop: "yes" })?.isOtherStop).toBe(false);
    expect(parseWith(bookingOptionBody, { name: "Shell" })?.isOtherStop).toBe(false);
    expect(parseWith(bookingOptionBody, { name: " " })).toBeNull();
  });
});

describe("invites", () => {
  it("splits a pasted list, lowercases it and drops repeats", () => {
    expect(parseEmailList("Ana@Mail.com, ben@mail.com\n ana@mail.com;carl@mail.com  not-an-email")).toEqual({
      valid: ["ana@mail.com", "ben@mail.com", "carl@mail.com"],
      invalid: ["not-an-email"],
    });
  });

  it("turns off switches the role can't have", () => {
    const truck = parseWith(inviteBody, { emails: "a@b.co", role: "Driver", driverType: "Truck", canRequestDaily: true, canRequestCompany: true });
    expect(truck).toMatchObject({ driverType: "Truck", canRequestDaily: false, canRequestCompany: false });
    const scheduler = parseWith(inviteBody, { emails: "a@b.co", role: "Scheduler", canRequestCompany: true });
    expect(scheduler).toMatchObject({ driverType: null, canRequestCompany: false });
    const car = parseWith(inviteBody, { emails: "a@b.co", role: "Driver", driverType: "Company car", canRequestDaily: true });
    expect(car).toMatchObject({ canRequestDaily: true });
  });

  it("refuses an unknown role", () => {
    expect(parseWith(inviteBody, { emails: "a@b.co", role: "Booker" })).toBeNull();
  });
});
