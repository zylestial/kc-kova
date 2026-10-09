import { describe, expect, it } from "vitest";
import type { ScheduleLeg, StopTap, TripAttendance, TripTimeCorrection } from "@/lib/kova-api";
import { atStop, formTimeValue, legTimes, manilaHhmm, missingTimes, stopPlaceLabel, tripSteps, hhmmLabel } from "@/lib/stop-times";

const leg = (id: string, legNo: number, destinationName: string, isFinal = false): ScheduleLeg => ({
  id,
  legNo,
  origin: "",
  destinationName,
  plannedTimeOut: "08:00",
  plannedTimeIn: "09:00",
  contactName: "",
  contactNumber: "",
  isFinal,
  stops: [],
});
const legs = [leg("l1", 1, "City Hall"), leg("l2", 2, "Market"), leg("l3", 3, "ANONANG", true)];
const tapAt = { at: "2026-10-09T00:00:00Z", recordedByAccountId: "d1", location: null };
const started: TripAttendance = { id: "a1", scheduleId: "s1", revisionId: "r1", driverId: "d1", start: tapAt };
const stop = (kind: StopTap["kind"], legId: string): StopTap => ({
  id: `${kind}-${legId}`,
  scheduleId: "s1",
  revisionId: "r1",
  legId,
  driverId: "d1",
  kind,
  ...tapAt,
});

describe("legTimes", () => {
  it("takes Leg 1 out from Start, each arrival as that leg's in, each leaving as the next leg's out, and End as the final in", () => {
    const times = legTimes(legs, { ...started, end: tapAt }, [stop("ARRIVE", "l1"), stop("LEAVE", "l1")]);
    expect(times.map((item) => [item.out.source, item.in.source])).toEqual([
      [{ kind: "START" }, { kind: "ARRIVE", legId: "l1", place: "City Hall" }],
      [{ kind: "LEAVE", legId: "l1", place: "City Hall" }, { kind: "ARRIVE", legId: "l2", place: "Market" }],
      [{ kind: "LEAVE", legId: "l2", place: "Market" }, { kind: "END" }],
    ]);
    expect(times.map((item) => [!!item.out.tap, !!item.in.tap])).toEqual([
      [true, true],
      [true, false],
      [false, true],
    ]);
  });
});

describe("atStop and stopPlaceLabel", () => {
  it("allows for the phone's error margin, like taps at ANONANG", () => {
    expect(atStop({ lat: 0, lng: 0, accuracyM: 20, distanceM: 100, address: null })).toBe(true);
    expect(atStop({ lat: 0, lng: 0, accuracyM: 250, distanceM: 350, address: null })).toBe(true);
    expect(atStop({ lat: 0, lng: 0, accuracyM: 20, distanceM: 350, address: null })).toBe(false);
  });

  it("can't check a tap with no position, or a destination with none saved", () => {
    expect(atStop(null)).toBeNull();
    expect(atStop({ lat: 0, lng: 0, accuracyM: 5, distanceM: null, address: null })).toBeNull();
    expect(stopPlaceLabel(null, "Market")).toBe("no location");
    expect(stopPlaceLabel({ lat: 0, lng: 0, accuracyM: 5, distanceM: null, address: null }, "Market")).toBe("location not checked");
  });

  it("names the place", () => {
    expect(stopPlaceLabel({ lat: 0, lng: 0, accuracyM: 5, distanceM: 40, address: null }, "City Hall")).toBe("at City Hall");
    expect(stopPlaceLabel({ lat: 0, lng: 0, accuracyM: 20, distanceM: 1200, address: null }, "City Hall")).toBe("1.2 km from City Hall (±20 m)");
  });
});

describe("formTimeValue and missingTimes", () => {
  const correction = (legId: string, field: "OUT" | "IN", time: string): TripTimeCorrection => ({
    id: `${legId}-${field}`,
    scheduleId: "s1",
    revisionId: "r1",
    legId,
    field,
    time,
    correctedByAccountId: "a1",
    correctedAt: "2026-10-09T03:00:00Z",
  });

  it("writes a tap as Manila 24-hour time", () => {
    expect(manilaHhmm("2026-10-09T05:07:00Z")).toBe("13:07");
    expect(manilaHhmm("2026-10-08T16:30:00Z")).toBe("00:30");
  });

  it("counts every empty cell, and an Admin's entry fills one", () => {
    const startedAt0802 = { ...started, start: { ...tapAt, at: "2026-10-09T00:02:00Z" } };
    expect(missingTimes(legTimes(legs, startedAt0802, []))).toBe(5);
    const times = legTimes(legs, startedAt0802, [], [correction("l2", "OUT", "09:40")]);
    expect(missingTimes(times)).toBe(4);
    expect(formTimeValue(times[1].out)).toBe("09:40");
    expect(formTimeValue(times[0].out)).toBe("08:02");
  });

  it("prints an Admin's entry in place of the tap, and stores it against the leg's own cell", () => {
    const times = legTimes(legs, started, [stop("LEAVE", "l1")], [correction("l2", "OUT", "09:15")]);
    expect(times[1].out.cell).toEqual({ legId: "l2", field: "OUT" });
    expect(times[1].out.tap?.at).toBe(tapAt.at);
    expect(formTimeValue(times[1].out)).toBe("09:15");
  });
});

describe("tripSteps", () => {
  const states = (times: ReturnType<typeof legTimes>) => tripSteps(times).map((step) => `${step.time.source.kind}:${step.state}`);

  it("offers Start trip first, then one step at a time", () => {
    expect(states(legTimes(legs, undefined, []))).toEqual([
      "START:next", "ARRIVE:later", "LEAVE:later", "ARRIVE:later", "LEAVE:later", "END:later",
    ]);
    expect(states(legTimes(legs, started, [stop("ARRIVE", "l1")]))).toEqual([
      "START:done", "ARRIVE:done", "LEAVE:next", "ARRIVE:later", "LEAVE:later", "END:later",
    ]);
  });

  it("marks a passed step as skipped", () => {
    expect(states(legTimes(legs, started, [stop("LEAVE", "l1")]))).toEqual([
      "START:done", "ARRIVE:skipped", "LEAVE:done", "ARRIVE:next", "LEAVE:later", "END:later",
    ]);
  });

  it("has no next step once End trip is tapped", () => {
    expect(states(legTimes(legs, { ...started, end: tapAt }, [stop("ARRIVE", "l1")]))).toEqual([
      "START:done", "ARRIVE:done", "LEAVE:skipped", "ARRIVE:skipped", "LEAVE:skipped", "END:done",
    ]);
  });
});

describe("hhmmLabel", () => {
  it("reads a 24-hour time as 12-hour", () => {
    expect(hhmmLabel("13:07")).toBe("1:07 PM");
    expect(hhmmLabel("00:30")).toBe("12:30 AM");
    expect(hhmmLabel("")).toBe("");
  });
});
