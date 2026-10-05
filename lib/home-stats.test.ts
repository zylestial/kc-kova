import { describe, expect, it } from "vitest";
import { homeStats } from "@/lib/home-stats";
import type { HomeData } from "@/lib/home-counts";
import type { Schedule, ScheduleRevision, TransportRequest } from "@/lib/kova-api";

// 2026-09-25 12:00 in Asia/Manila.
const NOW = new Date("2026-09-25T12:00:00+08:00");

const empty: HomeData = { requests: [], schedules: [], cancellations: [], completions: [], problems: [] };

const request = (over: Partial<TransportRequest>): TransportRequest =>
  ({ id: "r", ownerAccountId: "u1", date: "2026-10-05", status: "ACTIVE", progress: "NOT_YET_SCHEDULED", ...over }) as TransportRequest;

const revision = (over: Partial<ScheduleRevision>): ScheduleRevision =>
  ({ id: "v1", status: "APPROVED", driverId: "d1", legs: [{ plannedTimeIn: "15:58" }], ...over }) as ScheduleRevision;

const schedule = (over: Partial<Schedule> & { revisions: ScheduleRevision[] }): Schedule =>
  ({ id: "s", date: "2026-09-25", status: "ACTIVE", publishedRevisionId: "v1", ...over }) as Schedule;

const values = (stats: { label: string; value: number }[]) => Object.fromEntries(stats.map((s) => [s.label, s.value]));

describe("homeStats", () => {
  it("splits a Requester's own open requests by progress", () => {
    const data = {
      ...empty,
      requests: [
        request({ id: "a" }),
        request({ id: "b", progress: "SENT_BACK" }),
        request({ id: "c", progress: "APPROVED" }),
        request({ id: "d", progress: "DONE" }),
        request({ id: "e", ownerAccountId: "other" }),
      ],
    };
    expect(values(homeStats("Requester", "u1", data, NOW))).toEqual({
      "Open requests": 3,
      "Not yet scheduled": 1,
      "Sent back": 1,
      Scheduled: 1,
    });
    expect(homeStats("Requester", "u1", data, NOW).map((stat) => stat.href)).toEqual([
      "/requests",
      "/requests?progress=NOT_YET_SCHEDULED",
      "/requests?progress=SENT_BACK",
      "/requests",
    ]);
  });

  it("counts a Scheduler's waiting requests, drafts, returns and today's trips", () => {
    const data = {
      ...empty,
      requests: [request({ id: "a" }), request({ id: "b", date: "2026-09-20" })],
      schedules: [
        schedule({ id: "1", revisions: [revision({ id: "v1" }), revision({ id: "v2", status: "DRAFT" })] }),
        schedule({ id: "2", revisions: [revision({ id: "v3", status: "RETURNED" })], publishedRevisionId: undefined }),
        schedule({ id: "3", date: "2026-09-26", revisions: [revision({})] }),
      ],
    } as unknown as HomeData;
    expect(values(homeStats("Scheduler", "u1", data, NOW))).toEqual({
      "Waiting to be scheduled": 1,
      "Drafts to finish": 1,
      "Returned by Admin": 1,
      "Trips today": 1,
    });
    expect(homeStats("Scheduler", "u1", data, NOW).map((stat) => stat.href)).toEqual([
      "/schedules/new",
      "/schedules?status=DRAFT",
      "/schedules?status=RETURNED",
      "/schedules?view=day",
    ]);
  });

  it("counts what is waiting on an Admin", () => {
    const data = {
      ...empty,
      schedules: [schedule({ revisions: [revision({ status: "SUBMITTED" })] })],
      cancellations: [{ status: "PENDING" }, { status: "DECLINED" }],
      completions: [{ status: "SUBMITTED" }, { status: "DONE" }],
      problems: [{ status: "OPEN" }, { status: "OPEN" }, { status: "HANDLED" }],
    } as unknown as HomeData;
    expect(values(homeStats("Admin", "u1", data, NOW))).toEqual({
      "Schedules to approve": 1,
      "Cancellation requests": 1,
      "Trips to close": 1,
      "Open problems": 2,
    });
    expect(homeStats("Admin", "u1", data, NOW).map((stat) => stat.href)).toEqual([
      "/schedules?status=SUBMITTED",
      "/schedules#cancellations",
      "/finished?status=SUBMITTED",
      "/finished?problems=open",
    ]);
  });

  it("counts a Driver's own trips, or every driver's when viewed by Admin", () => {
    const data = {
      ...empty,
      schedules: [
        schedule({ id: "today", revisions: [revision({})] }),
        schedule({ id: "past", date: "2026-09-24", revisions: [revision({})] }),
        schedule({ id: "later", date: "2026-09-27", revisions: [revision({})] }),
        schedule({ id: "done", date: "2026-09-23", revisions: [revision({})] }),
        schedule({ id: "theirs", revisions: [revision({ driverId: "d2" })] }),
      ],
      completions: [{ scheduleId: "done" }],
    } as unknown as HomeData;
    expect(values(homeStats("Driver", "d1", data, NOW))).toEqual({
      "Trips today": 1,
      "Upcoming trips": 1,
      "Ready to complete": 1,
    });
    expect(values(homeStats("Driver", "admin", data, NOW, null))["Trips today"]).toBe(2);
  });
});
