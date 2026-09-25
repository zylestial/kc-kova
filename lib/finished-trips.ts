import type { ProblemReport, Schedule, ScheduleRevision, TripCompletion } from "@/lib/kova-api";

/** A schedule that has a submitted completion, with everything the screens show. */
export type FinishedTrip = {
  schedule: Schedule;
  revision: ScheduleRevision;
  completion: TripCompletion;
  problems: ProblemReport[];
};

/**
 * Joins schedules with their completion and problem reports, newest trip
 * first. Uses the version the completion was pinned to, falling back to the
 * published one. Bootstrap only sends what the caller may see (a Driver's
 * own, everything for Admin), so no role filtering happens here.
 */
export function buildFinishedTrips(
  schedules: Schedule[],
  completions: TripCompletion[],
  problems: ProblemReport[],
): FinishedTrip[] {
  const trips = schedules.flatMap((schedule) => {
    const completion = completions.find((item) => item.scheduleId === schedule.id);
    if (!completion) return [];
    const revision =
      schedule.revisions.find((item) => item.id === completion.revisionId) ??
      schedule.revisions.find((item) => item.id === schedule.publishedRevisionId);
    if (!revision) return [];
    return [{ schedule, revision, completion, problems: problems.filter((item) => item.scheduleId === schedule.id) }];
  });
  return trips.sort(
    (a, b) => b.schedule.date.localeCompare(a.schedule.date) || b.completion.submittedAt.localeCompare(a.completion.submittedAt),
  );
}

/** True while any problem report on the trip is still waiting for an Admin. */
export const hasOpenProblem = (trip: FinishedTrip) => trip.problems.some((item) => item.status === "OPEN");
