import { describe, expect, it } from "vitest";
import type { CompanyTripRun, Schedule, TripAttendance } from "@/lib/kova-api";
import { unendedTrip } from "@/lib/unended-trip";

const trip = (id: string, date: string, driverId = "rey", kind: Schedule["kind"] = "DAILY", status: Schedule["status"] = "ACTIVE") =>
  ({ id, date, kind, status, publishedRevisionId: `r${id}`, revisions: [{ id: `r${id}`, plate: `P-${id}`, driverId }] }) as unknown as Schedule;
const started = (scheduleId: string, ended = false) =>
  ({ scheduleId, start: { at: "2026-11-12T08:00:00Z" }, ...(ended ? { end: { at: "2026-11-12T12:00:00Z" } } : {}) }) as unknown as TripAttendance;
const run = (scheduleId: string, ended = false) =>
  ({ scheduleId, startAt: "2026-11-12T08:00:00Z", ...(ended ? { endAt: "2026-11-12T12:00:00Z" } : {}) }) as unknown as CompanyTripRun;

describe("unendedTrip", () => {
  it("finds a Daily trip started but never ended", () => {
    expect(unendedTrip([trip("old", "2026-11-12"), trip("now", "2026-11-16")], [started("old")], [], "rey", "now")).toEqual({
      scheduleId: "old",
      date: "2026-11-12",
      plate: "P-old",
      kind: "DAILY",
    });
  });

  it("finds a Company trip run with no End trip", () => {
    expect(unendedTrip([trip("co", "2026-11-14", "rey", "COMPANY"), trip("now", "2026-11-16")], [], [run("co")], "rey", "now")?.scheduleId).toBe("co");
  });

  it("ignores ended trips, the trip being started, other Drivers' and cancelled trips", () => {
    const schedules = [
      trip("ended", "2026-11-10"),
      trip("now", "2026-11-16"),
      trip("mario", "2026-11-11", "mario"),
      trip("cancelled", "2026-11-12", "rey", "DAILY", "CANCELLED"),
      trip("co", "2026-11-13", "rey", "COMPANY"),
    ];
    const attendance = [started("ended", true), started("now"), started("mario"), started("cancelled")];
    expect(unendedTrip(schedules, attendance, [run("co", true)], "rey", "now")).toBeNull();
  });

  it("names the oldest, and nothing for an Admin viewing as Driver", () => {
    const schedules = [trip("b", "2026-11-14"), trip("a", "2026-11-12"), trip("now", "2026-11-16")];
    const attendance = [started("a"), started("b")];
    expect(unendedTrip(schedules, attendance, [], "rey", "now")?.scheduleId).toBe("a");
    expect(unendedTrip(schedules, attendance, [], null, "now")).toBeNull();
  });
});
