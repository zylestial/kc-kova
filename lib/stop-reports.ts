import type { ProblemReport, Schedule, ScheduleLeg, StopReportKind, TransportRequest } from "@/lib/kova-api";
import { publishedRevision } from "@/lib/trip-record";

/**
 * Stop reports (0061): what can happen at a stop, in the order the report
 * sheet offers them, and what each does to the trip. The database decides
 * (report_stop); this is what the screens say.
 */
export const STOP_REPORT_CHOICES: Array<{ kind: StopReportKind; label: string; hint: string }> = [
  { kind: "NOT_AVAILABLE", label: "Not available", hint: "Nobody or nothing there to pick up or drop off. The stop is missed; go on to the next." },
  { kind: "WRONG_ADDRESS", label: "Wrong address or closed", hint: "Can't find it, can't get in, or it's closed. The stop is missed; go on to the next." },
  { kind: "ROAD_BLOCKED", label: "Road blocked or bad weather", hint: "Flood, accident, road closed. Skip this stop, or wait it out." },
  { kind: "VEHICLE_PROBLEM", label: "Vehicle problem", hint: "Breakdown, flat tire. The trip pauses until you tap Resume trip." },
  { kind: "OTHER", label: "Something else", hint: "Tell the Scheduler what happened. The trip goes on as planned." },
];

/**
 * The requests at a stop, for the report's "Which ones?" (0067): "52-A ·
 * Pick up · Cement". The Driver sees the stop number, purpose and details,
 * never the requester.
 */
export function stopChoices(leg: Pick<ScheduleLeg, "stops"> | undefined, requests: TransportRequest[]) {
  if (!leg) return [];
  return requests
    .filter((request) => request.destinations.some((item) => leg.stops.includes(item.id)))
    .map((request) => ({
      requestId: request.id,
      label: [
        request.group ? `${request.group.number}-${request.stopLetter}` : "",
        request.urgentReason?.name ?? request.destinations[0]?.purposeName,
        request.details,
      ]
        .filter(Boolean)
        .join(" · "),
    }));
}

/** The Scheduler plans its requests again: the whole stop missed, or some of the requests there (0067). */
export const plansAgain = (report: Pick<ProblemReport, "missed" | "requestIds">) => report.missed || !!report.requestIds?.length;

/** How a report reads on the trip, e.g. "Missed: Not available". */
export function stopReportLabel(report: Pick<ProblemReport, "kind" | "missed" | "requestIds">): string {
  const label =
    report.kind === "NOT_REACHED" ? "Not reached" : (STOP_REPORT_CHOICES.find((choice) => choice.kind === report.kind)?.label ?? "Problem");
  return plansAgain(report) ? `Missed: ${label}` : label;
}

/** The stops reported missed on a trip, by leg: they need no Arrived or Leaving. */
export function missedLegs(problems: ProblemReport[]): Map<string, ProblemReport> {
  return new Map(problems.filter((item) => item.missed && item.legId).map((item) => [item.legId!, item]));
}

/** An open stop report on Scheduling (0063): where, on which vehicle, and the requests still at that stop. */
export type OpenStopReport = {
  report: ProblemReport;
  schedule: Schedule;
  plate: string;
  place: string;
  stops: TransportRequest[];
};

/**
 * The open stop reports on a day's trips of one kind, oldest first: the
 * Scheduler handles each. Today also shows those left from earlier days,
 * since Scheduling starts at today.
 */
export function openStopReports(
  problems: ProblemReport[],
  schedules: Schedule[],
  requests: TransportRequest[],
  day: string,
  kind: Schedule["kind"],
  today: string,
): OpenStopReport[] {
  return problems
    .filter((report) => report.status === "OPEN" && report.legId)
    .flatMap((report) => {
      const schedule = schedules.find((item) => item.id === report.scheduleId);
      const revision = schedule && publishedRevision(schedule);
      const onDay = schedule?.date === day || (day === today && !!schedule && schedule.date < today);
      if (!schedule || !revision || schedule.status !== "ACTIVE" || !onDay || schedule.kind !== kind) return [];
      const leg = revision.legs.find((item) => item.id === report.legId);
      // A report for some of the requests there names just those.
      const stops = requests.filter(
        (request) =>
          request.destinations.some((item) => leg?.stops.includes(item.id)) && (!report.requestIds || report.requestIds.includes(request.id)),
      );
      return [{ report, schedule, plate: revision.plate, place: leg?.destinationName ?? "a stop", stops }];
    })
    .sort((a, b) => a.report.createdAt.localeCompare(b.report.createdAt));
}
