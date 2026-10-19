import { describe, expect, it } from "vitest";
import { notificationTarget, type ScheduleLookup } from "@/lib/notification-target";

const schedule = { id: "s1", date: "2026-10-20", kind: "COMPANY" as const };
const find: ScheduleLookup = (id) => (id === schedule.id ? schedule : undefined);

describe("notificationTarget", () => {
  it("opens the request a requester's notification names", () => {
    expect(notificationTarget({ type: "REQUEST_SCHEDULED", relatedRequestId: "r1" }, find, "Requester")).toBe("/requests?open=r1");
    expect(notificationTarget({ type: "REQUEST_MOVED" }, find, "Requester")).toBe("/requests");
  });

  it("opens a returned schedule on Scheduling, on its day and kind", () => {
    expect(notificationTarget({ type: "SCHEDULE_RETURNED", relatedScheduleId: "s1" }, find, "Scheduler")).toBe(
      "/scheduling?date=2026-10-20&type=COMPANY&trip=s1",
    );
    expect(notificationTarget({ type: "SCHEDULE_RETURNED", relatedScheduleId: "gone" }, find, "Scheduler")).toBe("/scheduling");
  });

  it("sends a stop report to Scheduling for a Scheduler and Finished Trips for an Admin", () => {
    expect(notificationTarget({ type: "STOP_REPORTED", relatedScheduleId: "s1" }, find, "Scheduler")).toBe(
      "/scheduling?date=2026-10-20&type=COMPANY&trip=s1",
    );
    expect(notificationTarget({ type: "STOP_REPORTED", relatedScheduleId: "s1" }, find, "Admin")).toBe("/finished?open=s1");
  });

  it("opens a changed trip on the Driver's schedule or the requester's trips", () => {
    expect(notificationTarget({ type: "TRIP_CHANGED", relatedScheduleId: "s1" }, find, "Driver")).toBe("/my-schedule?open=s1");
    expect(notificationTarget({ type: "TRIP_CHANGED", relatedScheduleId: "s1" }, find, "Requester")).toBe("/my-trips?open=s1");
  });
});
