import { describe, expect, it } from "vitest";
import { canFinishTrip, validateDriverSubmission, type Booking, type VehicleRecord } from "@/lib/kova-api";

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "b1",
    date: "2020-01-01",
    plate: "ABC-123",
    start: 8,
    end: 12,
    driver: "Driver One",
    driverId: "d1",
    project: "Site A",
    requestedById: "r1",
    requestedBy: "Requester One",
    destination: "Warehouse",
    purpose: "Delivery",
    notes: "",
    createdBy: "Requester One",
    createdAt: "2020-01-01T00:00:00Z",
    status: "SCHEDULED",
    ...overrides,
  };
}

function makeRecord(overrides: Partial<VehicleRecord> = {}): VehicleRecord {
  return {
    id: "rec1",
    date: "2020-01-01",
    plate: "ABC-123",
    vehicle: "Van 1",
    driver: "Driver One",
    status: "Scheduled",
    bookingId: "b1",
    start: "100",
    end: "150",
    legs: [{ origin: "ANONANG", destination: "Warehouse" }, { origin: "Warehouse", destination: "ANONANG" }],
    ...overrides,
  };
}

describe("canFinishTrip", () => {
  it("is true once the scheduled end time is in the past", () => {
    expect(canFinishTrip(makeBooking(), new Date("2020-01-01T13:00:00"))).toBe(true);
  });

  it("is false before the scheduled end time", () => {
    expect(canFinishTrip(makeBooking(), new Date("2020-01-01T01:00:00"))).toBe(false);
  });

  it("is false for a cancelled booking", () => {
    expect(canFinishTrip(makeBooking({ status: "CANCELLED" }), new Date("2020-01-01T13:00:00"))).toBe(false);
  });
});

describe("validateDriverSubmission", () => {
  it("passes for a valid, finishable, ANONANG round trip by the assigned driver", () => {
    expect(() => validateDriverSubmission(makeRecord(), makeBooking(), "d1")).not.toThrow();
  });

  it("rejects a driver who isn't assigned to the booking", () => {
    expect(() => validateDriverSubmission(makeRecord(), makeBooking(), "someone-else")).toThrow("not available for submission");
  });

  it("rejects a record that doesn't link back to the booking", () => {
    expect(() => validateDriverSubmission(makeRecord({ bookingId: "different-booking" }), makeBooking(), "d1")).toThrow("not available for submission");
  });

  it("rejects a negative starting odometer", () => {
    expect(() => validateDriverSubmission(makeRecord({ start: "-1" }), makeBooking(), "d1")).toThrow("starting odometer");
  });

  it("rejects an ending odometer lower than the starting one", () => {
    expect(() => validateDriverSubmission(makeRecord({ start: "100", end: "50" }), makeBooking(), "d1")).toThrow("ending odometer");
  });

  it("rejects a trip that doesn't start and end at ANONANG", () => {
    expect(() => validateDriverSubmission(makeRecord({ legs: [{ origin: "Site A", destination: "Warehouse" }] }), makeBooking(), "d1")).toThrow("ANONANG");
  });

  it("rejects a trip with no legs at all", () => {
    expect(() => validateDriverSubmission(makeRecord({ legs: [] }), makeBooking(), "d1")).toThrow("ANONANG");
  });
});
