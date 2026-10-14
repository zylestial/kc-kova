import { describe, expect, it } from "vitest";
import {
  bookingOptionBody,
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
    expect(parseWith(createAccountBody, account)).toEqual({ name: "Ana Cruz", username: "ana", role: "Driver", status: "Active", password: "drive2026" });
    expect(parseWith(createAccountBody, { ...account, status: "Retired" })?.status).toBe("Active");
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
      type: "Van",
      requestable: true,
    });
  });

  it("reads the type and request toggle, falling back to a requestable Van", () => {
    const body = { plate: "ABC 123", name: "Hauler", status: "Active" };
    expect(parseWith(updateVehicleBody, { ...body, type: "Truck", requestable: false })).toMatchObject({ type: "Truck", requestable: false });
    expect(parseWith(updateVehicleBody, { ...body, type: "Boat", requestable: "no" })).toMatchObject({ type: "Van", requestable: true });
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
