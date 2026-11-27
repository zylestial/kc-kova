import { describe, expect, it } from "vitest";
import { notificationTarget, type ScheduleLookup } from "@/lib/notification-target";

const schedule = { id: "s1", date: "2026-10-20", kind: "COMPANY" as const };
const find: ScheduleLookup = (id) => (id === schedule.id ? schedule : undefined);

describe("notificationTarget", () => {
  it("opens the request a requester's notification names", () => {
    expect(notificationTarget({ type: "REQUEST_SCHEDULED", relatedRequestId: "r1" }, find, "Requester")).toBe("/requests?open=r1");
    expect(notificationTarget({ type: "REQUEST_MOVED" }, find, "Requester")).toBe("/requests");
  });

  it("opens a scheduled Company trip on My Trips, where its requester records it", () => {
    expect(notificationTarget({ type: "REQUEST_SCHEDULED", relatedScheduleId: "s1" }, find, "Requester")).toBe("/my-trips?open=s1");
    expect(notificationTarget({ type: "REQUEST_SCHEDULED", relatedScheduleId: "daily" }, find, "Requester")).toBe("/requests");
  });

  it("opens a returned Daily schedule on Scheduling, and a returned Company trip on My requests", () => {
    expect(notificationTarget({ type: "SCHEDULE_RETURNED", relatedScheduleId: "daily" }, (id) => ({ id, date: "2026-10-20", kind: "DAILY" }), "Scheduler")).toBe(
      "/scheduling?date=2026-10-20&type=DAILY&trip=daily",
    );
    expect(notificationTarget({ type: "SCHEDULE_RETURNED", relatedScheduleId: "gone" }, find, "Scheduler")).toBe("/scheduling");
    expect(notificationTarget({ type: "SCHEDULE_RETURNED", relatedScheduleId: "s1" }, find, "Scheduler")).toBe("/requests");
    // The requester can't see an unapproved trip, so it isn't found.
    expect(notificationTarget({ type: "SCHEDULE_RETURNED", relatedScheduleId: "gone" }, find, "Requester")).toBe("/requests");
  });

  it("sends a stop report to Scheduling for a Scheduler and Finished Trips for an Admin", () => {
    expect(notificationTarget({ type: "STOP_REPORTED", relatedScheduleId: "s1" }, find, "Scheduler")).toBe("/schedules?open=s1");
    expect(notificationTarget({ type: "STOP_REPORTED", relatedScheduleId: "s1" }, find, "Admin")).toBe("/finished?open=s1");
  });

  it("opens a Company trip on My Trips and a Driver's Daily trip on My Schedule", () => {
    expect(notificationTarget({ type: "TRIP_CHANGED", relatedScheduleId: "s1" }, find, "Driver")).toBe("/my-trips?open=s1");
    expect(notificationTarget({ type: "TRIP_CHANGED", relatedScheduleId: "s1" }, find, "Requester")).toBe("/my-trips?open=s1");
    expect(notificationTarget({ type: "TRIP_CHANGED", relatedScheduleId: "daily" }, find, "Driver")).toBe("/my-schedule?open=daily");
    expect(notificationTarget({ type: "TRIP_PUBLISHED", relatedScheduleId: "s1" }, find, "Requester")).toBe("/my-trips?open=s1");
    expect(notificationTarget({ type: "TRIP_PUBLISHED", relatedScheduleId: "daily" }, find, "Driver")).toBe("/my-schedule?open=daily");
  });
});
