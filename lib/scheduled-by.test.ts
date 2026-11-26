import { describe, expect, it } from "vitest";
import type { Account, Schedule, ScheduleRevision } from "@/lib/kova-api";
import { cancelledBy, othersDraftQuestion, requestScheduledBy, scheduledBy } from "@/lib/scheduled-by";

describe("scheduled by", () => {
  const accounts = [
    { id: "s1", name: "Sam Cruz" },
    { id: "s2", name: "Lea Santos" },
  ] as Account[];
  const revision = (patch: Partial<ScheduleRevision>): ScheduleRevision => ({
    id: "rev",
    version: 1,
    status: "DRAFT",
    plate: "V1",
    driverId: "d1",
    driverName: "Dan",
    rowVersion: 1,
    createdByAccountId: "s1",
    createdAt: "",
    updatedAt: "",
    decisionComment: "",
    requestIds: ["r1"],
    legs: [],
    ...patch,
  });
  const schedule = (patch: Partial<Schedule>): Schedule => ({
    id: "sc",
    date: "2026-10-20",
    kind: "DAILY",
    createdByAccountId: "s1",
    status: "ACTIVE",
    createdAt: "",
    updatedAt: "",
    revisions: [revision({})],
    ...patch,
  });

  it("names the drafter of a draft, and the submitter once submitted", () => {
    expect(scheduledBy(revision({}), accounts)).toEqual({ label: "Drafted by", name: "Sam Cruz" });
    expect(scheduledBy(revision({ status: "RETURNED" }), accounts)?.label).toBe("Drafted by");
    expect(scheduledBy(revision({ status: "SUBMITTED", submittedByAccountId: "s2" }), accounts)).toEqual({
      label: "Scheduled by",
      name: "Lea Santos",
    });
    expect(scheduledBy(revision({ status: "APPROVED" }), accounts)).toEqual({ label: "Scheduled by", name: "Sam Cruz" });
  });

  it("is null without a revision or a known account", () => {
    expect(scheduledBy(undefined, accounts)).toBeNull();
    expect(scheduledBy(revision({ createdByAccountId: "gone" }), accounts)).toBeNull();
  });

  it("asks before changing a trip someone else is planning", () => {
    expect(othersDraftQuestion(schedule({}), "s2", accounts)).toBe("Sam Cruz is drafting this trip. Edit anyway?");
    expect(othersDraftQuestion(schedule({}), "s1", accounts)).toBeNull();
    expect(
      othersDraftQuestion(schedule({ revisions: [revision({ status: "SUBMITTED", submittedByAccountId: "s1" })] }), "s2", accounts),
    ).toBe("Sam Cruz scheduled this trip. Edit anyway?");
    // An approved trip with no draft changes has nothing open to step on.
    expect(othersDraftQuestion(schedule({ revisions: [revision({ status: "APPROVED" })], publishedRevisionId: "rev" }), "s2", accounts)).toBeNull();
  });

  it("finds who planned a request's live trip", () => {
    expect(requestScheduledBy("r1", [schedule({})], accounts)?.name).toBe("Sam Cruz");
    expect(requestScheduledBy("r2", [schedule({})], accounts)).toBeNull();
    expect(requestScheduledBy("r1", [schedule({ status: "CANCELLED" })], accounts)).toBeNull();
  });
});

describe("cancelled by", () => {
  const accounts = [{ id: "a1", name: "Liza Reyes" }];
  it("names the Admin and the Manila time", () => {
    const by = cancelledBy({ status: "CANCELLED", cancelledAt: "2026-11-26T07:40:00Z", cancelledByAccountId: "a1" }, accounts);
    expect(by).toEqual({ name: "Liza Reyes", at: "Nov 26, 2026, 3:40 PM" });
  });
  it("falls back when the account isn't known", () => {
    expect(cancelledBy({ status: "CANCELLED", cancelledByAccountId: "x" }, accounts)).toEqual({ name: "an Admin", at: "" });
  });
  it("is null for a trip that isn't cancelled", () => {
    expect(cancelledBy({ status: "ACTIVE" }, accounts)).toBeNull();
  });
});
