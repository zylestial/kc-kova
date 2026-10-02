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

/**
 * A trip on the Admin's Finished Trips screen. Besides every finished trip,
 * it includes trips the Driver reported a problem on but hasn't submitted
 * yet (problem reports don't wait for the trip to end), with no completion,
 * so the Admin can still handle those problems.
 */
export type AdminTrip = Omit<FinishedTrip, "completion"> & { completion: TripCompletion | null };

/** Finished trips plus unsubmitted trips with problem reports, newest trip first. */
export function buildAdminTrips(
  schedules: Schedule[],
  completions: TripCompletion[],
  problems: ProblemReport[],
): AdminTrip[] {
  const finished: AdminTrip[] = buildFinishedTrips(schedules, completions, problems);
  const reported = schedules.flatMap((schedule) => {
    if (completions.some((item) => item.scheduleId === schedule.id)) return [];
    const own = problems.filter((item) => item.scheduleId === schedule.id);
    if (!own.length) return [];
    const revision =
      schedule.revisions.find((item) => item.id === own[0].revisionId) ??
      schedule.revisions.find((item) => item.id === schedule.publishedRevisionId);
    if (!revision) return [];
    return [{ schedule, revision, completion: null, problems: own }];
  });
  const latest = (trip: AdminTrip) =>
    trip.completion?.submittedAt ?? trip.problems.map((item) => item.createdAt).sort().at(-1) ?? "";
  return [...finished, ...reported].sort(
    (a, b) => b.schedule.date.localeCompare(a.schedule.date) || latest(b).localeCompare(latest(a)),
  );
}

/** True while any problem report on the trip is still waiting for an Admin. */
export const hasOpenProblem = (trip: { problems: ProblemReport[] }) => trip.problems.some((item) => item.status === "OPEN");

/**
 * The trips "Mark all clean trips done" would close: submitted, still open
 * for review, and with no problem report waiting for an Admin. A trip with
 * no completion (problem reported before submitting) is never included.
 */
export const cleanTrips = <T extends { completion: { status: string } | null; problems: ProblemReport[] }>(trips: T[]) =>
  trips.filter((trip) => trip.completion?.status === "SUBMITTED" && !hasOpenProblem(trip));
