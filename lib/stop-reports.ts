import type { ProblemReport, Schedule, ScheduleLeg, StopDecision, StopReportKind, TransportRequest } from "@/lib/kova-api";
import { publishedRevision } from "@/lib/trip-record";

/**
 * Stop reports (0061): what can happen at a stop, in the order the report
 * sheet offers them. Every report holds the trip until a Scheduler or Admin
 * answers (0068); the database decides (report_stop, answer_stop_report),
 * this is what the screens say.
 */
export const STOP_REPORT_CHOICES: Array<{ kind: StopReportKind; label: string; hint: string }> = [
  { kind: "NOT_AVAILABLE", label: "Not available", hint: "Nobody or nothing there to pick up or drop off." },
  { kind: "WRONG_ADDRESS", label: "Wrong address or closed", hint: "Can't find it, can't get in, or it's closed." },
  { kind: "ROAD_BLOCKED", label: "Road blocked or bad weather", hint: "Flood, accident, road closed." },
  { kind: "VEHICLE_PROBLEM", label: "Vehicle problem", hint: "Breakdown, flat tire." },
  { kind: "OTHER", label: "Something else", hint: "Anything else the Scheduler should know." },
];

/** The Scheduler's answers (0068), in the order the banner offers them. */
export const STOP_ANSWERS: Array<{ decision: StopDecision; label: string }> = [
  { decision: "SKIP", label: "Skip it, go to next" },
  { decision: "WAIT", label: "Wait there" },
  { decision: "END", label: "End the trip" },
  { decision: "CHANGE", label: "Change the route" },
];

/** The trip is held for this report: not answered yet, or waiting on the route change it was answered with. */
export const waitsForAnswer = (report: Pick<ProblemReport, "legId" | "status" | "kind" | "decision">) =>
  !!report.legId && report.status === "OPEN" && report.kind !== "NOT_REACHED" && (!report.decision || report.decision === "CHANGE");

/** What a held trip says instead of its next button: waiting for an answer, or for the route change. */
export function holdText(problems: ProblemReport[]): string {
  return problems.some((item) => waitsForAnswer(item) && item.decision === "CHANGE")
    ? "Your route is being changed. Wait until it shows here."
    : "Reported. Wait for the Scheduler's answer before going on.";
}

/** The trip's latest answered stop report, to show the Driver what to do. */
export function latestAnswer(problems: ProblemReport[]): ProblemReport | undefined {
  return problems
    .filter((item) => item.legId && item.decidedAt && item.decision !== "CHANGE")
    .sort((a, b) => b.decidedAt!.localeCompare(a.decidedAt!))[0];
}

/** What the Driver is told the answer was, as on their trip. */
export function answerText(report: Pick<ProblemReport, "decision" | "kind">, place: string): string {
  switch (report.decision) {
    case "SKIP":
      return `Skip ${place} and go on to the next stop.`;
    case "WAIT":
      return report.kind === "VEHICLE_PROBLEM" ? "Go on once the vehicle is fixed." : `Stay at ${place} and go on when it's ready.`;
    case "END":
      return "End the trip: tap End trip now and head back.";
    case "CHANGE":
      return "Your route is being changed. Wait until it shows here.";
    default:
      return "Wait for the Scheduler's answer.";
  }
}

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

/** The Scheduler plans its requests again: the whole stop missed, or some of the requests there once answered Skip (0067, 0068). */
export const plansAgain = (report: Pick<ProblemReport, "missed" | "requestIds" | "decision">) =>
  report.missed || (!!report.requestIds?.length && report.decision === "SKIP");

/**
 * Where an open stop report stands, for Finished Trips. It closes with its
 * answer on Scheduling, never with Mark handled (0083); "" once handled.
 */
export function stopReportStatus(report: Pick<ProblemReport, "status" | "decision" | "missed" | "requestIds">): string {
  if (report.status === "HANDLED") return "";
  if (plansAgain(report)) return "Missed: waiting for the Scheduler to plan it again on Scheduling.";
  if (!report.decision) return "Waiting for an answer on Scheduling. The trip is held until then.";
  if (report.decision === "CHANGE") return "Answered: change the route. Waiting for an Admin to approve the change.";
  return "Open on Scheduling.";
}

/** How a report reads on the trip, e.g. "Missed: Not available". */
export function stopReportLabel(report: Pick<ProblemReport, "kind" | "missed" | "requestIds" | "decision">): string {
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
