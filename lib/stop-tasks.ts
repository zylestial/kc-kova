import type { ProblemReport, StopTask, StopTap } from "@/lib/kova-api";
import { waitsForAnswer, type JobFlag } from "@/lib/stop-reports";
import type { StopInfo } from "@/lib/trip-record";

/**
 * Tasks at a stop (0088): between Arrived and Leaving, each request there is
 * Done or reported Not yet done. The database refuses Leaving until each has
 * an answer; this is what the screens show.
 */

/** A request's Done at a stop, if it has one. */
export const taskDone = (tasks: StopTask[], legId: string, requestId: string) =>
  tasks.find((task) => task.legId === legId && task.requestId === requestId);

/**
 * The stop asks about its tasks once the Driver has Arrived, unless they
 * Arrived before tasks existed (before_tasks), when it goes on as it used to.
 */
export function asksTasks(taps: Array<Pick<StopTap, "legId" | "kind" | "beforeTasks">>, legId: string) {
  const arrived = taps.find((tap) => tap.legId === legId && tap.kind === "ARRIVE");
  return !!arrived && !arrived.beforeTasks;
}

/** How many tasks at a stop still need Done or Not yet done. */
export function tasksOpen(stops: Pick<StopInfo, "requestId">[], legId: string, tasks: StopTask[], flags: Map<string, JobFlag>) {
  return stops.filter((stop) => !taskDone(tasks, legId, stop.requestId) && !flags.has(stop.requestId)).length;
}

/** A report for the whole stop is waiting, so it answers for every task there until the Scheduler does. */
export const wholeStopWaiting = (problems: ProblemReport[], legId: string) =>
  problems.some((report) => report.legId === legId && waitsForAnswer(report) && !report.requestIds?.length);
