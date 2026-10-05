import { describe, expect, it } from "vitest";
import { buildScheduledFinishedTrips, compareSchedules, finishState } from "@/lib/trip-finish";
import type { ProblemReport, Schedule, ScheduleRevision, TransportRequest, TripCompletion } from "@/lib/kova-api";

const revision = (over: Partial<ScheduleRevision>): ScheduleRevision =>
  ({ id: "v1", status: "APPROVED", requestIds: ["r1"], legs: [{ plannedTimeOut: "08:00", plannedTimeIn: "10:00" }], ...over }) as ScheduleRevision;

const schedule = (over: Partial<Schedule> & { revisions?: ScheduleRevision[] }): Schedule =>
  ({ id: "s1", date: "2026-10-05", status: "ACTIVE", publishedRevisionId: "v1", revisions: [revision({})], ...over }) as Schedule;

const requests = (...items: [string, TransportRequest["progress"]][]) =>
  new Map(items.map(([id, progress]) => [id, { id, progress } as TransportRequest]));

describe("finishState", () => {
  it("reads the completion when the viewer has it", () => {
    const done = [{ scheduleId: "s1", status: "DONE" }] as TripCompletion[];
    const submitted = [{ scheduleId: "s1", status: "SUBMITTED" }] as TripCompletion[];
    expect(finishState(schedule({}), done, new Map())).toBe("DONE");
    expect(finishState(schedule({}), submitted, new Map())).toBe("SUBMITTED");
  });

  it("falls back to request progress for a Scheduler, ignoring cancelled requests", () => {
    const s = schedule({ revisions: [revision({ requestIds: ["r1", "r2"] })] });
    expect(finishState(s, [], requests(["r1", "DONE"], ["r2", "CANCELLED"]))).toBe("DONE");
    expect(finishState(s, [], requests(["r1", "COMPLETED"], ["r2", "COMPLETED"]))).toBe("SUBMITTED");
    expect(finishState(s, [], requests(["r1", "APPROVED"], ["r2", "APPROVED"]))).toBeNull();
    expect(finishState(s, [], requests(["r1", "CANCELLED"], ["r2", "CANCELLED"]))).toBeNull();
    expect(finishState(s, [], new Map())).toBeNull();
  });
});

describe("buildScheduledFinishedTrips", () => {
  it("lists submitted and done trips from request progress, newest first", () => {
    const list = [
      schedule({ id: "old", date: "2026-10-01", revisions: [revision({ requestIds: ["r1"] })] }),
      schedule({ id: "new", date: "2026-10-03", revisions: [revision({ requestIds: ["r2"] })] }),
      schedule({ id: "open", date: "2026-10-04", revisions: [revision({ requestIds: ["r3"] })] }),
      schedule({ id: "gone", date: "2026-10-02", status: "CANCELLED", revisions: [revision({ requestIds: ["r4"] })] }),
    ];
    const reqs = [
      { id: "r1", progress: "DONE" },
      { id: "r2", progress: "COMPLETED" },
      { id: "r3", progress: "APPROVED" },
      { id: "r4", progress: "DONE" },
    ] as TransportRequest[];
    const problems = [{ scheduleId: "new", status: "OPEN" }] as ProblemReport[];
    const trips = buildScheduledFinishedTrips(list, [], reqs, problems);
    expect(trips.map((trip) => [trip.schedule.id, trip.state, trip.problems.length])).toEqual([
      ["new", "SUBMITTED", 1],
      ["old", "DONE", 0],
    ]);
  });
});

describe("compareSchedules", () => {
  it("orders by date, then pending before approved, then by start time", () => {
    const approvedEarly = schedule({ id: "a", revisions: [revision({ legs: [{ plannedTimeOut: "07:00", plannedTimeIn: "08:00" }] as ScheduleRevision["legs"] })] });
    const pendingLate = schedule({
      id: "b",
      publishedRevisionId: undefined,
      revisions: [revision({ id: "v2", status: "SUBMITTED", legs: [{ plannedTimeOut: "15:00", plannedTimeIn: "16:00" }] as ScheduleRevision["legs"] })],
    });
    const draft = schedule({ id: "c", publishedRevisionId: undefined, revisions: [revision({ id: "v3", status: "DRAFT" })] });
    const tomorrow = schedule({ id: "d", date: "2026-10-06", publishedRevisionId: undefined, revisions: [revision({ id: "v4", status: "DRAFT" })] });
    const sorted = [tomorrow, approvedEarly, pendingLate, draft].sort(compareSchedules).map((s) => s.id);
    expect(sorted).toEqual(["c", "b", "a", "d"]);
  });
});
