import type { ProblemReport, Schedule, ScheduleRevision, TransportRequest, TripCompletion } from "@/lib/kova-api";
import { publishedRevision, scheduleState, tripWindow, currentRevision } from "@/lib/trip-record";

/** How far the trip record has got: submitted by the Driver, or marked Done by an Admin. */
export type FinishState = "SUBMITTED" | "DONE" | null;

/**
 * The trip record's state for a schedule. Admin and the Driver read it from
 * the completion itself. A Scheduler can't read completions, but each
 * request's progress mirrors the completion of the schedule carrying it
 * (request_progress_of: COMPLETED once submitted, DONE once marked Done),
 * so that stands in. Cancelled requests on the route don't count.
 */
export function finishState(
  schedule: Schedule,
  completions: TripCompletion[],
  requestsById: Map<string, TransportRequest>,
): FinishState {
  const completion = completions.find((item) => item.scheduleId === schedule.id);
  if (completion) return completion.status === "DONE" ? "DONE" : "SUBMITTED";
  const progress = (publishedRevision(schedule)?.requestIds ?? [])
    .map((id) => requestsById.get(id)?.progress)
    .filter((value) => value && value !== "CANCELLED");
  if (progress.length && progress.every((value) => value === "DONE")) return "DONE";
  if (progress.some((value) => value === "COMPLETED" || value === "DONE")) return "SUBMITTED";
  return null;
}

/** A finished trip as a Scheduler sees it: no odometer, which only the completion holds. */
export type ScheduledFinishedTrip = {
  schedule: Schedule;
  revision: ScheduleRevision;
  state: "SUBMITTED" | "DONE";
  problems: ProblemReport[];
};

/** Every trip the Driver has submitted, from request progress, newest trip first. */
export function buildScheduledFinishedTrips(
  schedules: Schedule[],
  completions: TripCompletion[],
  requests: TransportRequest[],
  problems: ProblemReport[],
): ScheduledFinishedTrip[] {
  const requestsById = new Map(requests.map((request) => [request.id, request]));
  return schedules
    .flatMap((schedule) => {
      const state = finishState(schedule, completions, requestsById);
      const revision = publishedRevision(schedule);
      if (!state || !revision || schedule.status !== "ACTIVE") return [];
      return [{ schedule, revision, state, problems: problems.filter((item) => item.scheduleId === schedule.id) }];
    })
    .sort((a, b) => b.schedule.date.localeCompare(a.schedule.date));
}

/** Still being planned or waiting on an Admin: draft, returned or submitted for approval. */
export const isPendingSchedule = (schedule: Schedule) =>
  ["DRAFT", "RETURNED", "SUBMITTED"].includes(scheduleState(schedule));

/**
 * The Schedules list order: by date, and within a date the schedules still
 * pending first, then the rest, each by start time.
 */
export function compareSchedules(a: Schedule, b: Schedule): number {
  const start = (schedule: Schedule) => tripWindow(currentRevision(schedule)?.legs ?? [])?.start ?? "";
  return (
    a.date.localeCompare(b.date) ||
    Number(!isPendingSchedule(a)) - Number(!isPendingSchedule(b)) ||
    start(a).localeCompare(start(b))
  );
}
