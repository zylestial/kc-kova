import { describe, expect, it } from "vitest";
import type { BootstrapData, ProblemReport, StopTask } from "@/lib/kova-api";
import { withSavedTaps, type SavedTap } from "@/lib/saved-taps";
import { parseStopTaskInput } from "@/lib/attendance-input";
import { asksTasks, requestDoneAt, taskDone, tasksOpen, wholeStopWaiting } from "@/lib/stop-tasks";

const done = (legId: string, requestId: string): StopTask => ({
  id: `${legId}-${requestId}`,
  scheduleId: "s",
  revisionId: "r",
  legId,
  requestId,
  at: "2026-11-05T01:00:00Z",
  recordedByAccountId: "d",
});

describe("tasks at a stop", () => {
  it("finds a Done by stop and request", () => {
    const tasks = [done("l1", "a")];
    expect(taskDone(tasks, "l1", "a")).toBe(tasks[0]);
    expect(taskDone(tasks, "l2", "a")).toBeUndefined();
  });

  it("says when a request was done, on whichever visit", () => {
    expect(requestDoneAt([done("l3", "a")], "a")).toBe("2026-11-05T01:00:00Z");
    expect(requestDoneAt([done("l3", "a")], "b")).toBeUndefined();
  });

  it("asks once the Driver has Arrived, unless they Arrived before tasks existed", () => {
    expect(asksTasks([], "l1")).toBe(false);
    expect(asksTasks([{ legId: "l1", kind: "ARRIVE" }], "l1")).toBe(true);
    expect(asksTasks([{ legId: "l1", kind: "ARRIVE", beforeTasks: true }], "l1")).toBe(false);
    expect(asksTasks([{ legId: "l1", kind: "LEAVE" }], "l1")).toBe(false);
  });

  it("counts what still needs an answer: not Done, reported or skipped", () => {
    const stops = [{ requestId: "a" }, { requestId: "b" }, { requestId: "c" }];
    expect(tasksOpen(stops, "l1", [], new Map())).toBe(3);
    expect(tasksOpen(stops, "l1", [done("l1", "a")], new Map())).toBe(2);
    expect(tasksOpen(stops, "l1", [done("l2", "a")], new Map())).toBe(3);
    expect(tasksOpen(stops, "l1", [done("l1", "a")], new Map([["b", "REPORTED"]]))).toBe(1);
    expect(tasksOpen(stops, "l1", [done("l1", "a")], new Map([["b", "REPORTED"], ["c", "SKIPPED"]]))).toBe(0);
  });

  it("knows when a report for the whole stop answers for every task", () => {
    const report = (patch: Partial<ProblemReport>) =>
      ({ legId: "l1", status: "OPEN", kind: "ROAD_BLOCKED", ...patch }) as ProblemReport;
    expect(wholeStopWaiting([report({})], "l1")).toBe(true);
    expect(wholeStopWaiting([report({})], "l2")).toBe(false);
    expect(wholeStopWaiting([report({ requestIds: ["a"] })], "l1")).toBe(false);
    expect(wholeStopWaiting([report({ decision: "WAIT" })], "l1")).toBe(false);
  });
});

describe("Done with no signal", () => {
  const data = {
    schedules: [{ id: "s", publishedRevisionId: "r" }],
    attendance: [],
    stopTaps: [],
    stopTasks: [],
    companyRuns: [],
  } as unknown as BootstrapData;
  const tap = (id: string, kind: "DONE" | "UNDO", requestId = "a"): SavedTap => ({
    id,
    accountId: "d",
    scheduleId: "s",
    path: "stop-tasks",
    body: { legId: "l1", requestId, kind, tappedAt: "2026-11-05T01:00:00Z" },
  });

  it("shows as done, marked as waiting", () => {
    const [task] = withSavedTaps(data, [tap("1", "DONE")], "d").stopTasks;
    expect(task).toMatchObject({ legId: "l1", requestId: "a", revisionId: "r", saved: true });
  });

  it("Undo takes it back, in order", () => {
    expect(withSavedTaps(data, [tap("1", "DONE"), tap("2", "UNDO")], "d").stopTasks).toEqual([]);
    expect(withSavedTaps(data, [tap("1", "DONE"), tap("2", "UNDO"), tap("3", "DONE")], "d").stopTasks).toHaveLength(1);
  });

  it("Undo also covers one KOVA already has, and a repeat keeps one", () => {
    const sent = { ...data, stopTasks: [done("l1", "a")] };
    expect(withSavedTaps(sent, [tap("1", "UNDO")], "d").stopTasks).toEqual([]);
    expect(withSavedTaps(sent, [tap("1", "DONE")], "d").stopTasks).toEqual(sent.stopTasks);
  });

  it("isn't another account's", () => {
    expect(withSavedTaps(data, [tap("1", "DONE")], "someone else").stopTasks).toEqual([]);
  });
});

describe("what Done sends", () => {
  const legId = "11111111-1111-4111-8111-111111111111";
  const requestId = "22222222-2222-4222-8222-222222222222";

  it("takes Done or Undo for one request", () => {
    expect(parseStopTaskInput({ legId, requestId, kind: "DONE" })).toEqual({ legId, requestId, kind: "DONE" });
    expect(parseStopTaskInput({ legId, requestId, kind: "UNDO", tappedAt: "2026-11-05T01:00:00Z" })).toMatchObject({ kind: "UNDO" });
  });

  it("refuses anything else", () => {
    expect(parseStopTaskInput({ legId, requestId, kind: "LEAVE" })).toBeNull();
    expect(parseStopTaskInput({ legId: "x", requestId, kind: "DONE" })).toBeNull();
    expect(parseStopTaskInput({ legId, kind: "DONE" })).toBeNull();
  });
});
