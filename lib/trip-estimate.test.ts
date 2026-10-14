import { describe, expect, it } from "vitest";
import { BASE_PLACE, driveMinutes, estimateTimes, startTime, stayMinutes, UNKNOWN_DRIVE } from "@/lib/trip-estimate";

// About 3.3 km north of ANONANG: 4.6 km by road, 11 minutes at 25 km/h.
const north = { lat: 16.133769, lng: 120.436222 };

describe("drive and stay", () => {
  it("drives from saved locations in 5-minute steps, and guesses without one", () => {
    expect(driveMinutes(BASE_PLACE, north)).toBe(15);
    expect(driveMinutes(BASE_PLACE, BASE_PLACE)).toBe(0);
    expect(driveMinutes(BASE_PLACE, null)).toBe(UNKNOWN_DRIVE);
  });

  it("stays by purpose, longest plus 10 for each extra request", () => {
    expect(stayMinutes(["Pick up"])).toBe(30);
    expect(stayMinutes(["Delivery", "Pick up"])).toBe(55);
    expect(stayMinutes(["Site visit"])).toBe(90);
    expect(stayMinutes([])).toBe(0);
  });
});

describe("estimateTimes", () => {
  it("leaves when done at the last place and waits for a fixed time", () => {
    expect(
      estimateTimes(
        [
          { place: north, stay: 30 },
          { place: null, stay: 45, fixedTime: "10:00" },
          { place: BASE_PLACE, stay: 0 },
        ],
        "08:00",
      ),
    ).toEqual([
      { timeOut: "08:00", timeIn: "08:15" },
      { timeOut: "08:45", timeIn: "10:00" },
      { timeOut: "10:45", timeIn: "11:15" },
    ]);
  });

  it("keeps the times the Scheduler set, and later legs follow them", () => {
    const times = estimateTimes([{ place: north, stay: 30, timeIn: "09:00" }, { place: BASE_PLACE, stay: 0 }], "08:00");
    expect(times).toEqual([
      { timeOut: "08:00", timeIn: "09:00" },
      { timeOut: "09:30", timeIn: "09:45" },
    ]);
  });

  it("starts a new trip at 8 AM, or now on a later morning today", () => {
    expect(startTime(false, "13:02")).toBe("08:00");
    expect(startTime(true, "07:10")).toBe("08:00");
    expect(startTime(true, "13:02")).toBe("13:05");
  });
});
