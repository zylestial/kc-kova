import { describe, expect, it } from "vitest";
import { homeCounts, type HomeData } from "@/lib/home-counts";
import type { Account, Schedule, ScheduleRevision, TransportRequest } from "@/lib/kova-api";

// 2026-09-25 12:00 in Asia/Manila.
const NOW = new Date("2026-09-25T12:00:00+08:00");

const account = (role: Account["role"], id = "u1"): Account => ({ id, name: role, username: role, role, status: "Active" });
const empty: HomeData = { requests: [], schedules: [], cancellations: [], completions: [], problems: [] };

const request = (over: Partial<TransportRequest>): TransportRequest =>
  ({ id: "r", ownerAccountId: "u1", date: "2026-10-05", status: "ACTIVE", progress: "NOT_YET_SCHEDULED", ...over }) as TransportRequest;

const revision = (over: Partial<ScheduleRevision>): ScheduleRevision =>
  ({ id: "v1", status: "APPROVED", driverId: "d1", legs: [{ plannedTimeIn: "15:58" }], ...over }) as ScheduleRevision;

const schedule = (over: Partial<Schedule> & { revisions: ScheduleRevision[] }): Schedule =>
  ({ id: "s", date: "2026-09-25", status: "ACTIVE", publishedRevisionId: "v1", ...over }) as Schedule;

describe("homeCounts", () => {
  it("counts a Requester's open and unscheduled requests, ignoring others' and finished ones", () => {
    const data = {
      ...empty,
      requests: [
        request({ id: "a" }),
        request({ id: "b", progress: "APPROVED" }),
        request({ id: "c", progress: "DONE" }),
        request({ id: "d", status: "CANCELLED" }),
        request({ id: "e", ownerAccountId: "other" }),
      ],
    };
    expect(homeCounts(account("Requester"), data, NOW)["my-requests"]).toBe("2 open · 1 not yet scheduled");
    expect(homeCounts(account("Requester"), empty, NOW)["my-requests"]).toBe("No open requests");
  });

  it("counts a Driver's own requests too", () => {
    const data = { ...empty, requests: [request({ id: "a", ownerAccountId: "d1" }), request({ id: "b" })] };
    expect(homeCounts(account("Driver", "d1"), data, NOW)["my-requests"]).toBe("1 open · 1 not yet scheduled");
  });

  it("tells a Requester how many requests were sent back, and keeps them out of the Scheduler's count", () => {
    const data = { ...empty, requests: [request({ id: "a" }), request({ id: "b", progress: "SENT_BACK" })] };
    expect(homeCounts(account("Requester"), data, NOW)["my-requests"]).toBe("2 open · 1 not yet scheduled · 1 sent back");
    expect(homeCounts(account("Scheduler"), data, NOW)["create-schedule"]).toBe("1 request waiting to be scheduled");
  });

  it("counts requests waiting for a Scheduler, skipping past dates and scheduled ones", () => {
    const data = {
      ...empty,
      requests: [request({ id: "a" }), request({ id: "b", date: "2026-09-20" }), request({ id: "c", progress: "SCHEDULING" })],
    };
    expect(homeCounts(account("Scheduler"), data, NOW)["create-schedule"]).toBe("1 request waiting to be scheduled");
    expect(homeCounts(account("Scheduler"), empty, NOW)["create-schedule"]).toBe("No requests waiting");
  });

  it("counts a Scheduler's drafts and returned schedules to finish", () => {
    const data = {
      ...empty,
      schedules: [
        schedule({ id: "1", revisions: [revision({ id: "v1" }), revision({ id: "v2", status: "DRAFT" })] }),
        schedule({ id: "2", revisions: [revision({ id: "v3", status: "RETURNED" })] }),
        schedule({ id: "3", revisions: [revision({ id: "v4" })] }),
      ],
    };
    expect(homeCounts(account("Scheduler"), data, NOW)["schedules"]).toBe("2 to finish · 1 returned by Admin");
    expect(homeCounts(account("Scheduler"), empty, NOW)["schedules"]).toBe("Nothing to finish");
  });

  it("counts an Admin's schedules to approve, cancellation requests, trips to close and open problems", () => {
    const data = {
      ...empty,
      schedules: [schedule({ revisions: [revision({ status: "SUBMITTED" })] })],
      cancellations: [{ status: "PENDING" }, { status: "PENDING" }, { status: "DECLINED" }],
      completions: [{ status: "SUBMITTED" }, { status: "DONE" }],
      problems: [{ status: "OPEN" }, { status: "HANDLED" }],
    } as unknown as HomeData;
    const counts = homeCounts(account("Admin"), data, NOW);
    expect(counts["schedules"]).toBe("1 to approve · 2 cancellation requests");
    expect(counts["finished"]).toBe("1 to close · 1 open problem");
    expect(homeCounts(account("Admin"), empty, NOW)["schedules"]).toBe("Nothing waiting");
  });

  it("tells a Driver what is ready to complete and when the next trip is", () => {
    const own = (over: Partial<Schedule>) => schedule({ revisions: [revision({ driverId: "d1" })], ...over });
    const data = {
      ...empty,
      schedules: [
        own({ id: "past", date: "2026-09-24" }),
        own({ id: "later", date: "2026-09-26" }),
        own({ id: "done", date: "2026-09-23" }),
        schedule({ id: "theirs", date: "2026-09-25", revisions: [revision({ driverId: "d2" })] }),
      ],
      completions: [{ scheduleId: "done" }],
    } as unknown as HomeData;
    expect(homeCounts(account("Driver", "d1"), data, NOW)["my-schedule"]).toBe("1 ready to complete · Next trip tomorrow");
    expect(homeCounts(account("Driver", "d1"), empty, NOW)["my-schedule"]).toBe("No upcoming trips");
  });

  it("does not show a trip as ready to complete before its last Time In", () => {
    const data = { ...empty, schedules: [schedule({ revisions: [revision({})] })] };
    expect(homeCounts(account("Driver", "d1"), data, NOW)["my-schedule"]).toBe("Next trip today");
  });

  it("shows a trip ended at ANONANG as ready to complete before its last Time In", () => {
    const today = schedule({ revisions: [revision({})] });
    const data = {
      ...empty,
      schedules: [today],
      attendance: [{ scheduleId: today.id, start: { at: "x" }, end: { at: "y" } }],
    } as unknown as HomeData;
    expect(homeCounts(account("Driver", "d1"), data, NOW)["my-schedule"]).toBe("1 ready to complete");
  });
});
