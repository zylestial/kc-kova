import { describe, expect, it } from "vitest";
import type { ProblemReport, Schedule, TransportRequest } from "@/lib/kova-api";
import { missedLegs, openStopReports, stopReportLabel } from "@/lib/stop-reports";

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
    ];
    const schedules = [trip("s1"), trip("s2", { date: "2026-10-17" }), trip("s3", { kind: "COMPANY" })];
    const open = openStopReports(problems, schedules, [waiting], "2026-10-16", "DAILY");
    expect(open.map((item) => item.report.id)).toEqual(["a", "b"]);
    expect(open[0]).toMatchObject({ plate: "UAT-004", place: "Site Beta", stops: [waiting] });
  });
});
