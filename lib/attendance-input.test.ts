import { describe, expect, it } from "vitest";
import { parseAttendanceInput, parseCompanyRunInput, parseStopTapInput, parseTripTimeInput } from "@/lib/attendance-input";

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

describe("parseTripTimeInput", () => {
  const legId = "7f1d8f2a-0000-4000-8000-000000000001";

  it("accepts a 24-hour time, or null to clear", () => {
    expect(parseTripTimeInput({ legId, field: "OUT", time: "09:40" })).toEqual({ legId, field: "OUT", time: "09:40" });
    expect(parseTripTimeInput({ legId, field: "IN", time: null })).toEqual({ legId, field: "IN", time: null });
  });

  it("rejects other time shapes and fields", () => {
    expect(parseTripTimeInput({ legId, field: "OUT", time: "9:40" })).toBeNull();
    expect(parseTripTimeInput({ legId, field: "OUT", time: "24:00" })).toBeNull();
    expect(parseTripTimeInput({ legId, field: "OUT", time: "09:40 AM" })).toBeNull();
    expect(parseTripTimeInput({ legId, field: "LATER", time: "09:40" })).toBeNull();
  });
});

describe("parseCompanyRunInput", () => {
  it("accepts Start or End trip with a whole-number odometer", () => {
    expect(parseCompanyRunInput({ kind: "START", odometer: 48215 })).toEqual({ kind: "START", odometer: 48215, location: null });
  });

  it("rejects a missing, negative or fractional reading", () => {
    expect(parseCompanyRunInput({ kind: "END" })).toBeNull();
    expect(parseCompanyRunInput({ kind: "END", odometer: -1 })).toBeNull();
    expect(parseCompanyRunInput({ kind: "END", odometer: 12.5 })).toBeNull();
  });
});
