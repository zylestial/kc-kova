import { describe, expect, it } from "vitest";
import type { Schedule, TransportRequest } from "@/lib/kova-api";
import { poolOrder, scheduleState, tripWindow } from "@/lib/trip-record";

describe("Urgent requests", () => {
  const request = (patch: Partial<TransportRequest>) =>
    ({ id: "r", ownerName: "Juan", createdAt: "2026-10-01T00:00:00Z", requestType: "REGULAR", ...patch }) as TransportRequest;

  it("sorts the pool Urgent first, then by requester and creation time", () => {
    const pool = [
      request({ id: "a", ownerName: "Ana" }),
      request({ id: "z", ownerName: "Zed", requestType: "URGENT" }),
      request({ id: "b2", ownerName: "Ben", createdAt: "2026-10-02T00:00:00Z" }),
      request({ id: "b1", ownerName: "Ben" }),
    ];
    expect(pool.sort(poolOrder).map((item) => item.id)).toEqual(["z", "a", "b1", "b2"]);
  });

  it("puts fixed times before any time that day, and any day that week last", () => {
    const pool = [
      request({ id: "week", ownerName: "Ana", flexibility: "WEEK" }),
      request({ id: "day", ownerName: "Ana", flexibility: "DAY" }),
      request({ id: "fixed", ownerName: "Zed", flexibility: "FIXED" }),
      request({ id: "urgent", ownerName: "Zed", flexibility: "WEEK", requestType: "URGENT" }),
    ];
    expect(pool.sort(poolOrder).map((item) => item.id)).toEqual(["urgent", "fixed", "day", "week"]);
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
