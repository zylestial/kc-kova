import { describe, expect, it } from "vitest";
import { parseStopReportInput } from "@/lib/stop-report-input";

const legId = "6f1c2c1e-6a4e-4f7a-9c55-6d1f0a1b2c3d";

describe("parseStopReportInput", () => {
  it("keeps the stop, the kind, a trimmed note, skip and the position", () => {
    expect(
      parseStopReportInput({ legId, kind: "ROAD_BLOCKED", note: "  Flooded  ", skip: true, location: { lat: 16.1, lng: 120.4, accuracyM: 12 } }),
    ).toEqual({ legId, kind: "ROAD_BLOCKED", note: "Flooded", skip: true, location: { lat: 16.1, lng: 120.4, accuracyM: 12 } });
  });

  it("defaults the note, skip and position", () => {
    expect(parseStopReportInput({ legId, kind: "VEHICLE_PROBLEM" })).toEqual({ legId, kind: "VEHICLE_PROBLEM", note: "", skip: false, location: null });
  });

  it("keeps which requests at the stop, and refuses an empty or bad list", () => {
    expect(parseStopReportInput({ legId, kind: "NOT_AVAILABLE", requestIds: [legId] })?.requestIds).toEqual([legId]);
    expect(parseStopReportInput({ legId, kind: "NOT_AVAILABLE", requestIds: [] })).toBeNull();
    expect(parseStopReportInput({ legId, kind: "NOT_AVAILABLE", requestIds: ["x"] })).toBeNull();
  });

  it("rejects an unknown kind or a bad stop", () => {
    expect(parseStopReportInput({ legId, kind: "LOST" })).toBeNull();
    expect(parseStopReportInput({ legId: "x", kind: "OTHER" })).toBeNull();
  });
});
