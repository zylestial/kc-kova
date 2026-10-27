import { describe, expect, it } from "vitest";
import type { ProblemReport, Schedule, TransportRequest } from "@/lib/kova-api";
import { answerText, missedLegs, openStopReports, stopChoices, stopReportLabel, stopReportStatus, waitsForAnswer } from "@/lib/stop-reports";

const report = (patch: Partial<ProblemReport>): ProblemReport => ({
  id: "p",
  scheduleId: "s",
  revisionId: "r",
  driverId: "d",
  note: "",
  createdAt: "",
  status: "OPEN",
  handlingNote: "",
  kind: "OTHER",
  missed: false,
  ...patch,
});

describe("stop reports", () => {
  it("names a report, saying when the stop was missed", () => {
    expect(stopReportLabel(report({ kind: "NOT_AVAILABLE", missed: true }))).toBe("Missed: Not available");
    expect(stopReportLabel(report({ kind: "ROAD_BLOCKED" }))).toBe("Road blocked or bad weather");
  });

  it("lists only the missed stops, by leg", () => {
    const missed = missedLegs([report({ id: "a", legId: "l1", missed: true }), report({ id: "b", legId: "l2" }), report({ id: "c" })]);
    expect([...missed.keys()]).toEqual(["l1"]);
  });
});

const trip = (id: string, patch: Partial<Schedule> = {}): Schedule => ({
  id,
  date: "2026-10-16",
  kind: "DAILY",
  createdByAccountId: "",
  status: "ACTIVE",
  publishedRevisionId: "r-" + id,
  createdAt: "",
  updatedAt: "",
  revisions: [
    {
      id: "r-" + id,
      version: 1,
      status: "APPROVED",
      plate: "UAT-004",
      driverId: "d",
      driverName: "Dan",
      rowVersion: 1,
      createdAt: "",
      updatedAt: "",
      decisionComment: "",
      requestIds: ["q1"],
      legs: [
        { id: "l1", legNo: 1, origin: "ANONANG", destinationName: "Site Beta", plannedTimeOut: "08:00", plannedTimeIn: "09:00", contactName: "", contactNumber: "", isFinal: false, stops: ["rd1"] },
      ],
    },
  ],
  ...patch,
});
const waiting = { id: "q1", destinations: [{ id: "rd1" }] } as TransportRequest;

describe("open stop reports on Scheduling", () => {
  it("lists the day's open stop reports of one kind, oldest first, with the stop and its requests", () => {
    const problems = [
      report({ id: "b", scheduleId: "s1", legId: "l1", createdAt: "2026-10-16T02:00:00Z" }),
      report({ id: "a", scheduleId: "s1", legId: "l1", missed: true, kind: "NOT_AVAILABLE", createdAt: "2026-10-16T01:00:00Z" }),
      report({ id: "handled", scheduleId: "s1", legId: "l1", status: "HANDLED" }),
      report({ id: "whole trip", scheduleId: "s1" }),
      report({ id: "other day", scheduleId: "s2", legId: "l1" }),
      report({ id: "company", scheduleId: "s3", legId: "l1" }),
      report({ id: "yesterday", scheduleId: "s4", legId: "l1", createdAt: "2026-10-15T01:00:00Z" }),
    ];
    const schedules = [trip("s1"), trip("s2", { date: "2026-10-17" }), trip("s3", { kind: "COMPANY" }), trip("s4", { date: "2026-10-15" })];
    const open = openStopReports(problems, schedules, [waiting], "2026-10-16", "DAILY", "2026-10-16");
    // Today also shows one left from yesterday.
    expect(open.map((item) => item.report.id)).toEqual(["yesterday", "a", "b"]);
    expect(openStopReports(problems, schedules, [waiting], "2026-10-17", "DAILY", "2026-10-16").map((item) => item.report.id)).toEqual(["other day"]);
    expect(open[0]).toMatchObject({ plate: "UAT-004", place: "Site Beta", stops: [waiting] });
  });

  it("names just the requests a report for some of the stops is about", () => {
    const other = { id: "q2", destinations: [{ id: "rd2" }] } as TransportRequest;
    const shared = trip("s1");
    shared.revisions[0].legs[0].stops = ["rd1", "rd2"];
    const some = report({ id: "some", scheduleId: "s1", legId: "l1", kind: "NOT_AVAILABLE", requestIds: ["q2"], decision: "SKIP" });
    const [open] = openStopReports([some], [shared], [waiting, other], "2026-10-16", "DAILY", "2026-10-16");
    expect(open.stops).toEqual([other]);
    expect(stopReportLabel(some)).toBe("Missed: Not available");
    // Before the Scheduler says skip it, it isn't missed.
    expect(stopReportLabel({ ...some, decision: undefined })).toBe("Not available");
    expect(stopChoices(shared.revisions[0].legs[0], [waiting, other]).map((item) => item.requestId)).toEqual(["q1", "q2"]);
  });
});

describe("answers to stop reports (0068)", () => {
  it("holds the trip until answered, or until a route change is approved", () => {
    const base = report({ id: "a", scheduleId: "s1", legId: "l1", kind: "NOT_AVAILABLE" });
    expect(waitsForAnswer(base)).toBe(true);
    expect(waitsForAnswer({ ...base, decision: "CHANGE" })).toBe(true);
    expect(waitsForAnswer({ ...base, decision: "SKIP" })).toBe(false);
    expect(waitsForAnswer({ ...base, status: "HANDLED", decision: "WAIT" })).toBe(false);
    expect(waitsForAnswer({ ...base, kind: "NOT_REACHED" })).toBe(false);
    expect(waitsForAnswer({ ...base, legId: undefined })).toBe(false);
  });

  it("tells the Driver the answer", () => {
    expect(answerText({ decision: "SKIP", kind: "NOT_AVAILABLE" }, "Site Alpha")).toBe("Skip Site Alpha and go on to the next stop.");
    expect(answerText({ decision: "WAIT", kind: "VEHICLE_PROBLEM" }, "Site Alpha")).toBe("Go on once the vehicle is fixed.");
    expect(answerText({ kind: "OTHER" }, "Site Alpha")).toBe("Wait for the Scheduler's answer.");
  });
});

describe("stop reports on Finished Trips (0083)", () => {
  const base = report({ legId: "l1", kind: "NOT_AVAILABLE" });

  it("says where an open one stands on Scheduling", () => {
    expect(stopReportStatus(base)).toBe("Waiting for an answer on Scheduling. The trip is held until then.");
    expect(stopReportStatus({ ...base, decision: "CHANGE" })).toBe("Answered: change the route. Waiting for an Admin to approve the change.");
    expect(stopReportStatus({ ...base, missed: true, decision: "SKIP" })).toBe("Missed: waiting for the Scheduler to plan it again on Scheduling.");
    expect(stopReportStatus(report({ legId: "l1", kind: "NOT_REACHED", missed: true }))).toBe("Missed: waiting for the Scheduler to plan it again on Scheduling.");
  });

  it("says nothing once handled", () => {
    expect(stopReportStatus({ ...base, status: "HANDLED", decision: "WAIT" })).toBe("");
  });
});
