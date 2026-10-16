import { describe, expect, it } from "vitest";
import type { Schedule } from "@/lib/kova-api";
import { scheduleState, tripWindow } from "@/lib/trip-record";

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
