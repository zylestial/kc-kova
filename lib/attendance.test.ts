import { describe, expect, it } from "vitest";
import { buildAttendanceRows, coordinatesLabel, distanceLabel, tapFlags, tapPlaceLabel, tapTimeLabel } from "@/lib/attendance";
import type { AttendanceTap, Schedule, ScheduleRevision, TripAttendance } from "@/lib/kova-api";

const revision = (id: string, driverName = "Dan"): ScheduleRevision => ({
  id,
  version: 1,
  status: "APPROVED",
  plate: "V1",
  driverId: "d1",
  driverName,
  rowVersion: 1,
  createdAt: "",
  updatedAt: "",
  decisionComment: "",
  requestIds: [],
  legs: [],
});

const schedule = (id: string, date: string, driverName?: string, status: Schedule["status"] = "ACTIVE"): Schedule => ({
  id,
  date,
  kind: "DAILY",
  createdByAccountId: "s1",
  status,
  publishedRevisionId: "r-" + id,
  createdAt: "",
  updatedAt: "",
  revisions: [revision("r-" + id, driverName)],
});

// 08:05 in Manila on Oct 7.
const atBase: AttendanceTap = {
  at: "2026-10-07T00:05:00Z",
  recordedByAccountId: "d1",
  location: { lat: 16.103769, lng: 120.436222, accuracyM: 10, distanceM: 20, address: null },
};

const taps = (scheduleId: string, start: AttendanceTap, end?: AttendanceTap): TripAttendance => ({
  id: "a-" + scheduleId,
  scheduleId,
  revisionId: "r-" + scheduleId,
  driverId: "d1",
  start,
  end,
});

describe("tapFlags", () => {
  it("has no flags for a tap at base on the trip day", () => {
    expect(tapFlags(atBase, "2026-10-07")).toEqual([]);
  });

  it("flags a tap more than 150 m from ANONANG when the phone is sure of it", () => {
    const at = (distanceM: number, accuracyM: number | null) => ({ ...atBase, location: { ...atBase.location!, distanceM, accuracyM } });
    expect(tapFlags(at(151, null), "2026-10-07")).toEqual(["off-base"]);
    expect(tapFlags(at(150, null), "2026-10-07")).toEqual([]);
    expect(tapFlags(at(350, 20), "2026-10-07")).toEqual(["off-base"]);
  });

  it("gives a rough reading the benefit of its error margin, up to 250 m", () => {
    const at = (distanceM: number, accuracyM: number) => ({ ...atBase, location: { ...atBase.location!, distanceM, accuracyM } });
    expect(tapFlags(at(350, 250), "2026-10-07")).toEqual([]);
    expect(tapFlags(at(400, 2000), "2026-10-07")).toEqual([]);
    expect(tapFlags(at(401, 2000), "2026-10-07")).toEqual(["off-base"]);
  });

  it("flags a tap with no position", () => {
    expect(tapFlags({ ...atBase, location: null }, "2026-10-07")).toEqual(["no-location"]);
  });

  it("flags a tap on a later Manila day than the trip", () => {
    // 00:30 on Oct 8 in Manila, though still Oct 7 in UTC.
    expect(tapFlags({ ...atBase, at: "2026-10-07T16:30:00Z" }, "2026-10-07")).toEqual(["late"]);
  });
});

describe("distanceLabel", () => {
  it("shows metres under a kilometre and kilometres from there", () => {
    expect(distanceLabel(42.4)).toBe("42 m");
    expect(distanceLabel(1234)).toBe("1.2 km");
  });
});

describe("buildAttendanceRows", () => {
  const today = "2026-10-07";

  it("lists published active trips up to today, newest first, with their status", () => {
    const rows = buildAttendanceRows(
      [
        schedule("old", "2026-10-05"),
        schedule("today", "2026-10-07"),
        schedule("mid", "2026-10-06"),
        schedule("ahead", "2026-10-08"),
        schedule("cancelled", "2026-10-06", "Dan", "CANCELLED"),
      ],
      [taps("today", atBase), taps("mid", atBase, atBase)],
      today,
    );
    expect(rows.map((row) => [row.schedule.id, row.status])).toEqual([
      ["today", "STARTED"],
      ["mid", "COMPLETE"],
      ["old", "MISSING"],
    ]);
  });

  it("leaves out a schedule with no published version", () => {
    const draft = { ...schedule("draft", "2026-10-07"), publishedRevisionId: undefined };
    expect(buildAttendanceRows([draft], [], today)).toEqual([]);
  });

  it("merges both taps' flags without repeats", () => {
    const away = { ...atBase, location: { ...atBase.location!, distanceM: 900 } };
    const [row] = buildAttendanceRows([schedule("s", "2026-10-07")], [taps("s", away, { ...away, location: null })], today);
    expect(row.flags).toEqual(["off-base", "no-location"]);
  });

  it("takes a Company trip's Start and End trip, never flagged as away from ANONANG (0079)", () => {
    const company = { ...schedule("c", today), kind: "COMPANY" as const };
    const far = { ...atBase, location: { ...atBase.location!, distanceM: 0, address: "BDO Ortigas" } };
    const run = { id: "run", scheduleId: "c", revisionId: "r-c", startAt: far.at, startOdometer: 10, startTap: far, endTap: far };
    const [row] = buildAttendanceRows([company], [taps("c", atBase)], today, [run]);
    expect([row.status, row.flags, row.attendance?.id]).toEqual(["COMPLETE", [], "run"]);
    expect(tapPlaceLabel(far, true)).toBe("near BDO Ortigas");
    expect(buildAttendanceRows([company], [], today)[0].status).toBe("MISSING");
  });

  it("orders drivers by name within a day", () => {
    const rows = buildAttendanceRows([schedule("b", today, "Zed"), schedule("a", today, "Ana")], [], today);
    expect(rows.map((row) => row.revision.driverName)).toEqual(["Ana", "Zed"]);
  });
});

describe("tapTimeLabel and tapPlaceLabel", () => {
  it("shows the Manila time", () => {
    expect(tapTimeLabel("2026-10-07T00:05:00Z")).toBe("8:05 AM");
  });

  it("says where the tap was", () => {
    expect(tapPlaceLabel(atBase)).toBe("at ANONANG");
    expect(tapPlaceLabel({ ...atBase, location: { ...atBase.location!, distanceM: 1234 } })).toBe("1.2 km from ANONANG (±10 m)");
    expect(tapPlaceLabel({ ...atBase, location: { ...atBase.location!, distanceM: 1234, accuracyM: null } })).toBe("1.2 km from ANONANG");
    expect(tapPlaceLabel({ ...atBase, location: null })).toBe("no location");
  });
});

describe("coordinatesLabel", () => {
  it("shows the position to 6 decimals", () => {
    expect(coordinatesLabel({ lat: 16.1069131, lng: 120.436222 })).toBe("16.106913, 120.436222");
  });
});
