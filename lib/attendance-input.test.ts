import { describe, expect, it } from "vitest";
import { parseAttendanceInput, parseStopTapInput } from "@/lib/attendance-input";

describe("parseAttendanceInput", () => {
  it("accepts a tap with a position", () => {
    expect(parseAttendanceInput({ kind: "START", location: { lat: 16.103769, lng: 120.436222, accuracyM: 12 } })).toEqual({
      kind: "START",
      location: { lat: 16.103769, lng: 120.436222, accuracyM: 12 },
    });
  });

  it("accepts a tap without a position, and treats a missing accuracy as unknown", () => {
    expect(parseAttendanceInput({ kind: "END" })).toEqual({ kind: "END", location: null });
    expect(parseAttendanceInput({ kind: "END", location: null })).toEqual({ kind: "END", location: null });
    expect(parseAttendanceInput({ kind: "END", location: { lat: 1, lng: 2 } })?.location?.accuracyM).toBeNull();
  });

  it("rejects an unknown kind", () => {
    expect(parseAttendanceInput({ kind: "PAUSE" })).toBeNull();
    expect(parseAttendanceInput({})).toBeNull();
  });

  it("rejects a position out of range or half given", () => {
    expect(parseAttendanceInput({ kind: "START", location: { lat: 95, lng: 120 } })).toBeNull();
    expect(parseAttendanceInput({ kind: "START", location: { lat: 16, lng: 190 } })).toBeNull();
    expect(parseAttendanceInput({ kind: "START", location: { lat: 16 } })).toBeNull();
    expect(parseAttendanceInput({ kind: "START", location: { lat: "16", lng: "120" } })).toBeNull();
  });
});

describe("parseStopTapInput", () => {
  const legId = "7f1d8f2a-0000-4000-8000-000000000001";

  it("accepts Arrived and Leaving, with or without a position", () => {
    expect(parseStopTapInput({ legId, kind: "ARRIVE", location: { lat: 16.1, lng: 120.4, accuracyM: 8 } })).toEqual({
      legId,
      kind: "ARRIVE",
      location: { lat: 16.1, lng: 120.4, accuracyM: 8 },
    });
    expect(parseStopTapInput({ legId, kind: "LEAVE" })).toEqual({ legId, kind: "LEAVE", location: null });
  });

  it("rejects a missing or malformed leg, and Start/End", () => {
    expect(parseStopTapInput({ kind: "ARRIVE" })).toBeNull();
    expect(parseStopTapInput({ legId: "leg-1", kind: "ARRIVE" })).toBeNull();
    expect(parseStopTapInput({ legId, kind: "START" })).toBeNull();
  });
});
