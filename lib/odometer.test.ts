import { describe, expect, it } from "vitest";
import type { Schedule, TripCompletion } from "@/lib/kova-api";
import { LONG_TRIP_KM, NO_ODOMETER, kmLabel, lastEndReading, longTripWarning, readingsLabel } from "@/lib/odometer";

const schedule = (id: string, revisionId: string, plate: string) =>
  ({ id, revisions: [{ id: revisionId, plate }] }) as unknown as Schedule;
const completion = (scheduleId: string, revisionId: string, endOdometer: number | null, submittedAt: string) =>
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

  it("skips a trip made while the vehicle had no odometer", () => {
    const completions = [completion("s1", "v1", 1042, "2026-09-20T10:00:00Z"), completion("s2", "v2", null, "2026-09-22T10:00:00Z")];
    expect(lastEndReading("V1", schedules, completions)).toBe(1042);
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

describe("readings without an odometer (0078)", () => {
  it("says so in place of a reading or distance", () => {
    expect(kmLabel(1234)).toBe("1,234 km");
    expect(kmLabel(0)).toBe("0 km");
    expect(kmLabel(null)).toBe(NO_ODOMETER);
    expect(kmLabel(undefined)).toBe(NO_ODOMETER);
  });

  it("shows the pair, or says there is none", () => {
    expect(readingsLabel({ startOdometer: 48215, endOdometer: 48262, distance: 47 })).toBe("48215 → 48262 (47 km)");
    expect(readingsLabel({ startOdometer: null, endOdometer: null, distance: null })).toBe(NO_ODOMETER);
  });
});
