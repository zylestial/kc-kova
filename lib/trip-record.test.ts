import { describe, expect, it } from "vitest";
import type { Schedule } from "@/lib/kova-api";
import { contactPhone, legStops, routeChangedAt, scheduleState, stopWhat, tripWindow, type StopInfo } from "@/lib/trip-record";

describe("a stop's requests", () => {
  const stop = (patch: Partial<StopInfo>): StopInfo => ({
    id: "s1",
    requestId: "r1",
    requester: "Grace",
    destinationName: "Site",
    destinationIsOther: false,
    purposeName: "Delivery",
    ...patch,
  });

  it("keeps the leg's order and leaves out stops it can't find", () => {
    const stopsById = new Map([
      ["s1", stop({ id: "s1" })],
      ["s2", stop({ id: "s2" })],
    ]);
    expect(legStops(["s2", "gone", "s1"], stopsById).map((item) => item.id)).toEqual(["s2", "s1"]);
  });

  it("says the Urgent reason, or the purpose", () => {
    expect(stopWhat(stop({}))).toBe("Delivery");
    expect(stopWhat(stop({ urgentReason: "Critical materials" }))).toBe("Critical materials");
  });

  it("finds the number in a contact", () => {
    expect(contactPhone("Mang Ben 0917 123 4567")).toBe("09171234567");
    expect(contactPhone("+63 917-123-4567 Ben")).toBe("+639171234567");
    expect(contactPhone("Foreman Edgar")).toBe("");
    expect(contactPhone("Block 3")).toBe("");
  });
});

describe("schedules", () => {
  const revision = (patch: object) => ({
    id: "rev",
    version: 1,
    status: "DRAFT" as const,
    plate: "V1",
    driverId: "drv1",
    driverName: "Dan",
    rowVersion: 1,
    createdAt: "",
    updatedAt: "",
    decisionComment: "",
    requestIds: [],
    legs: [
      { id: "l1", legNo: 1, origin: "ANONANG", destinationName: "City Hall", plannedTimeOut: "08:00", plannedTimeIn: "09:00", contactName: "", contactNumber: "", isFinal: false, stops: [] },
      { id: "l2", legNo: 2, origin: "City Hall", destinationName: "ANONANG", plannedTimeOut: "09:30", plannedTimeIn: "10:30", contactName: "", contactNumber: "", isFinal: true, stops: [] },
    ],
    ...patch,
  });
  const schedule = (patch: Partial<Schedule>): Schedule => ({
    id: "s1",
    date: "2026-10-05",
    kind: "DAILY",
    createdByAccountId: "sched",
    status: "ACTIVE",
    createdAt: "",
    updatedAt: "",
    revisions: [revision({})],
    ...patch,
  });

  it("derives the state shown for a schedule", () => {
    expect(scheduleState(schedule({}))).toBe("DRAFT");
    expect(scheduleState(schedule({ revisions: [revision({ status: "APPROVED" })], publishedRevisionId: "rev" }))).toBe("APPROVED");
    expect(scheduleState(schedule({ status: "CANCELLED" }))).toBe("CANCELLED");
  });

  it("measures the window from first Time Out to last Time In", () => {
    expect(tripWindow(revision({}).legs)).toEqual({ start: "08:00", end: "10:30" });
    expect(tripWindow([])).toBeNull();
  });
});

describe("routeChangedAt", () => {
  it("is when the route was saved after the trip started, if it was", () => {
    expect(routeChangedAt({ updatedAt: "2026-10-16T02:30:00Z" }, "2026-10-16T01:00:00Z")).toBe("2026-10-16T02:30:00Z");
    expect(routeChangedAt({ updatedAt: "2026-10-15T09:00:00Z" }, "2026-10-16T01:00:00Z")).toBeUndefined();
    expect(routeChangedAt({ updatedAt: "2026-10-16T02:30:00Z" }, undefined)).toBeUndefined();
  });
});
