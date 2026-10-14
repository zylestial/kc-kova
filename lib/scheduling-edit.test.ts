import { describe, expect, it } from "vitest";
import type { ScheduleLeg, TransportRequest } from "@/lib/kova-api";
import { legTimer } from "@/lib/scheduling-plan";
import { changeDestination, editInput, editLegs, moveLeg, removeLeg, setLegTimes } from "@/lib/scheduling-edit";

// No saved locations: every drive is 30 minutes; a Pick up stays 30.
const request = (id: string): TransportRequest =>
  ({
    id,
    requestType: "REGULAR",
    flexibility: "DAY",
    destinations: [{ id: "rd-" + id, destinationId: id, destinationName: id, purposeName: "Pick up" }],
  }) as TransportRequest;
const timer = legTimer({ requests: [request("a"), request("b"), request("c")], destinations: [] }, false);
const leg = (no: number, stop: string | null, out: string, inn: string): ScheduleLeg => ({
  id: "l" + no,
  legNo: no,
  origin: "",
  destinationId: stop ?? undefined,
  destinationName: stop ?? "ANONANG",
  plannedTimeOut: out,
  plannedTimeIn: inn,
  contactName: "",
  contactNumber: "",
  isFinal: !stop,
  stops: stop ? ["rd-" + stop] : [],
});
// a 8:00–8:30, b 9:00–9:30, back 10:00–10:30: all as estimated.
const estimated = [leg(1, "a", "08:00", "08:30"), leg(2, "b", "09:00", "09:30"), leg(3, null, "10:00", "10:30")];
const times = (legs: { timeOut: string; timeIn: string }[]) => legs.map((item) => `${item.timeOut}-${item.timeIn}`);

describe("editLegs", () => {
  it("counts a saved time that differs from its estimate as set", () => {
    expect(editLegs(estimated, timer, "08:00").map((item) => item.set)).toEqual([false, false, false]);
    const typed = [estimated[0], leg(2, "b", "09:00", "09:50"), leg(3, null, "10:20", "10:50")];
    expect(editLegs(typed, timer, "08:00").map((item) => item.set)).toEqual([false, true, false]);
  });

  it("estimates a draft saved without times", () => {
    const blank = estimated.map((item, index) => ({ ...item, plannedTimeOut: index === 0 ? "08:00" : "", plannedTimeIn: "" }));
    expect(times(editLegs(blank, timer, "08:00"))).toEqual(["08:00-08:30", "09:00-09:30", "10:00-10:30"]);
  });
});

describe("edits", () => {
  const legs = editLegs(estimated, timer, "08:00");

  it("keeps a typed time and moves the legs after it", () => {
    expect(times(setLegTimes(legs, 1, "09:10", "09:40", timer))).toEqual(["08:00-08:30", "09:10-09:40", "10:10-10:40"]);
  });

  it("reorders, keeping the return last", () => {
    const moved = moveLeg(legs, 1, 0, timer);
    expect(moved.map((item) => item.destinationName)).toEqual(["b", "a", "ANONANG"]);
    expect(times(moved)[0]).toBe("08:00-08:30");
    expect(moveLeg(legs, 1, 2, timer)).toBe(legs);
  });

  it("removes a leg and re-estimates the one after", () => {
    expect(times(removeLeg(legs, 0, timer))).toEqual(["08:00-08:30", "09:00-09:30"]);
  });

  it("changes a destination and saves every request on the legs", () => {
    const changed = changeDestination(legs, 1, { id: "c", name: "c", stops: ["rd-c"] }, timer);
    const input = editInput("2026-10-20", "V1", changed, (stopId) => stopId.slice(3));
    expect(input.requestIds).toEqual(["a", "c"]);
    expect(input.legs[1]).toMatchObject({ destinationId: "c", stops: ["rd-c"], plannedTimeOut: "09:00" });
    expect(input.legs[2]).toMatchObject({ destinationId: undefined, stops: [], isFinal: true });
  });
});
