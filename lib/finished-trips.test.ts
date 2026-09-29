import { describe, expect, it } from "vitest";
import { buildFinishedTrips, hasOpenProblem } from "@/lib/finished-trips";
import type { ProblemReport, Schedule, ScheduleRevision, TripCompletion } from "@/lib/kova-api";

const revision = (id: string): ScheduleRevision => ({
  id,
  version: 1,
  status: "APPROVED",
  plate: "V1",
  driverId: "d1",
  driverName: "Dan",
  rowVersion: 1,
  createdAt: "",
  updatedAt: "",
  decisionComment: "",
  requestIds: [],
  legs: [],
});

const schedule = (id: string, date: string, revisions: ScheduleRevision[], publishedRevisionId?: string): Schedule => ({
  id,
  date,
  createdByAccountId: "s1",
  status: "ACTIVE",
  publishedRevisionId,
  createdAt: "",
  updatedAt: "",
  revisions,
});

const completion = (scheduleId: string, revisionId: string, submittedAt: string): TripCompletion => ({
  id: "c-" + scheduleId,
  scheduleId,
  revisionId,
  driverId: "d1",
  startOdometer: 0,
  endOdometer: 10,
  distance: 10,
  submittedAt,
  status: "SUBMITTED",
  fullTank: null,
  fleetCardUsed: null,
  gasReceiptAttached: null,
});

const problem = (scheduleId: string, status: ProblemReport["status"]): ProblemReport => ({
  id: "p-" + scheduleId + status,
  scheduleId,
  revisionId: "r",
  driverId: "d1",
  note: "n",
  createdAt: "",
  status,
  handlingNote: "",
});

describe("buildFinishedTrips", () => {
  it("keeps only schedules with a completion, newest date first", () => {
    const schedules = [
      schedule("a", "2026-10-01", [revision("ra")], "ra"),
      schedule("b", "2026-10-03", [revision("rb")], "rb"),
      schedule("c", "2026-10-05", [revision("rc")], "rc"),
    ];
    const trips = buildFinishedTrips(schedules, [completion("a", "ra", "t1"), completion("b", "rb", "t2")], []);
    expect(trips.map((trip) => trip.schedule.id)).toEqual(["b", "a"]);
  });

  it("uses the version the completion was pinned to", () => {
    const schedules = [schedule("a", "2026-10-01", [revision("old"), revision("new")], "new")];
    const [trip] = buildFinishedTrips(schedules, [completion("a", "old", "t1")], []);
    expect(trip.revision.id).toBe("old");
  });

  it("falls back to the published version and skips a trip with no version", () => {
    const withPublished = schedule("a", "2026-10-01", [revision("new")], "new");
    const withNone = schedule("b", "2026-10-02", [], undefined);
    const trips = buildFinishedTrips(
      [withPublished, withNone],
      [completion("a", "gone", "t1"), completion("b", "gone", "t2")],
      [],
    );
    expect(trips).toHaveLength(1);
    expect(trips[0].revision.id).toBe("new");
  });

  it("orders trips on the same date by submission time, newest first", () => {
    const schedules = [schedule("a", "2026-10-01", [revision("ra")], "ra"), schedule("b", "2026-10-01", [revision("rb")], "rb")];
    const trips = buildFinishedTrips(schedules, [completion("a", "ra", "2026-10-01T10:00:00Z"), completion("b", "rb", "2026-10-01T11:00:00Z")], []);
    expect(trips.map((trip) => trip.schedule.id)).toEqual(["b", "a"]);
  });

  it("attaches each schedule's problem reports", () => {
    const schedules = [schedule("a", "2026-10-01", [revision("ra")], "ra")];
    const [trip] = buildFinishedTrips(schedules, [completion("a", "ra", "t1")], [problem("a", "OPEN"), problem("z", "OPEN")]);
    expect(trip.problems).toHaveLength(1);
  });
});

describe("hasOpenProblem", () => {
  it("is true only while a report is still OPEN", () => {
    const schedules = [schedule("a", "2026-10-01", [revision("ra")], "ra")];
    const [open] = buildFinishedTrips(schedules, [completion("a", "ra", "t1")], [problem("a", "HANDLED"), problem("a", "OPEN")]);
    const [handled] = buildFinishedTrips(schedules, [completion("a", "ra", "t1")], [problem("a", "HANDLED")]);
    expect(hasOpenProblem(open)).toBe(true);
    expect(hasOpenProblem(handled)).toBe(false);
  });
});
