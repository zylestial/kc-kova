import { describe, expect, it } from "vitest";
import type { Schedule, ScheduleRevision } from "@/lib/kova-api";
import { undoEntry, undoStep } from "@/lib/scheduling-undo";

const revision = (id: string, status: ScheduleRevision["status"], rowVersion = 1): ScheduleRevision => ({
  id,
  version: 1,
  status,
  plate: "V1",
  driverId: "d1",
  driverName: "Mario",
  rowVersion,
  createdAt: "",
  updatedAt: "",
  decisionComment: "",
  requestIds: ["a"],
  legs: [
    {
      id: "l1",
      legNo: 1,
      origin: "",
      destinationId: "wilcon",
      destinationName: "Wilcon",
      plannedTimeOut: "08:00",
      plannedTimeIn: "08:30",
      contactName: "Liza",
      contactNumber: "",
      isFinal: false,
      stops: ["rd-a"],
    },
    { id: "l2", legNo: 2, origin: "", destinationName: "ANONANG", plannedTimeOut: "09:00", plannedTimeIn: "09:30", contactName: "", contactNumber: "", isFinal: true, stops: [] },
  ],
});
const schedule = (revisions: ScheduleRevision[], patch: Partial<Schedule> = {}): Schedule => ({
  id: "s1",
  date: "2026-10-20",
  kind: "DAILY",
  createdByAccountId: "",
  status: "ACTIVE",
  createdAt: "",
  updatedAt: "",
  revisions,
  ...patch,
});

describe("undo", () => {
  it("saves the draft as it was", () => {
    const entry = undoEntry(schedule([revision("r1", "DRAFT")]), "DAILY");
    expect(entry.input?.legs.map((leg) => leg.destinationId)).toEqual(["wilcon", undefined]);
    expect(undoStep(entry, schedule([revision("r1", "DRAFT", 4)]))).toMatchObject({ action: "save", id: "s1", rowVersion: 4 });
  });

  it("discards a new trip, or the draft changes opened on an approved one", () => {
    expect(undoStep({ scheduleId: "s1", kind: "DAILY", input: null, submitted: false, moves: [] }, schedule([revision("r1", "DRAFT", 2)]))).toEqual({
      action: "discard",
      id: "s1",
      rowVersion: 2,
    });
    const approved = schedule([revision("r1", "APPROVED")], { publishedRevisionId: "r1" });
    const entry = undoEntry(approved, "DAILY");
    expect(entry.input).toBeNull();
    const withChanges = schedule([revision("r1", "APPROVED"), revision("r2", "DRAFT", 3)], { publishedRevisionId: "r1" });
    expect(undoStep(entry, withChanges)).toEqual({ action: "discard", id: "s1", rowVersion: 3 });
  });

  it("remembers a trip was waiting for the Admin", () => {
    expect(undoEntry(schedule([revision("r1", "SUBMITTED")]), "DAILY").submitted).toBe(true);
    expect(undoEntry(schedule([revision("r1", "DRAFT")]), "DAILY").submitted).toBe(false);
  });

  it("makes a discarded draft again, and reopens discarded changes", () => {
    const entry = undoEntry(schedule([revision("r1", "DRAFT")]), "COMPANY");
    expect(undoStep(entry, schedule([revision("r1", "DISCARDED")], { status: "CANCELLED" }))).toMatchObject({ action: "create", kind: "COMPANY" });
    expect(undoStep(entry, undefined)).toMatchObject({ action: "create" });
    const approved = schedule([revision("r1", "APPROVED")], { publishedRevisionId: "r1" });
    expect(undoStep(entry, approved)).toMatchObject({ action: "save", rowVersion: null });
  });
});
