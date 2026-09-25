import { describe, expect, it } from "vitest";
import type { Schedule, TripCompletion } from "@/lib/kova-api";
import { LONG_TRIP_KM, lastEndReading, longTripWarning } from "@/lib/odometer";

const schedule = (id: string, revisionId: string, plate: string) =>
  ({ id, revisions: [{ id: revisionId, plate }] }) as unknown as Schedule;
const completion = (scheduleId: string, revisionId: string, endOdometer: number, submittedAt: string) =>
  ({ scheduleId, revisionId, endOdometer, submittedAt }) as unknown as TripCompletion;

describe("lastEndReading", () => {
  const schedules = [schedule("s1", "v1", "V1"), schedule("s2", "v2", "V1"), schedule("s3", "v3", "V2")];

  it("takes the ending reading of the vehicle's most recent completed trip", () => {
    const completions = [
      completion("s1", "v1", 1042, "2026-09-20T10:00:00Z"),
      completion("s2", "v2", 1130, "2026-09-22T10:00:00Z"),
      completion("s3", "v3", 9999, "2026-09-23T10:00:00Z"),
    ];
    expect(lastEndReading("V1", schedules, completions)).toBe(1130);
    expect(lastEndReading("V2", schedules, completions)).toBe(9999);
  });

  it("returns null for a vehicle with no completed trips", () => {
    expect(lastEndReading("V3", schedules, [completion("s1", "v1", 1042, "2026-09-20T10:00:00Z")])).toBeNull();
    expect(lastEndReading("V1", schedules, [])).toBeNull();
  });

  it("ignores a completion whose schedule isn't loaded", () => {
    expect(lastEndReading("V1", [], [completion("s1", "v1", 1042, "2026-09-20T10:00:00Z")])).toBeNull();
  });
});

describe("longTripWarning", () => {
  it("warns only above the limit", () => {
    expect(longTripWarning(LONG_TRIP_KM)).toBe("");
    expect(longTripWarning(42)).toBe("");
    expect(longTripWarning(LONG_TRIP_KM + 1)).toMatch(/501 km.*very long trip/);
  });
});
