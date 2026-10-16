import type { ProblemReport, StopReportKind } from "@/lib/kova-api";

/**
 * Stop reports (0061): what can happen at a stop, in the order the report
 * sheet offers them, and what each does to the trip. The database decides
 * (report_stop); this is what the screens say.
 */
export const STOP_REPORT_CHOICES: Array<{ kind: StopReportKind; label: string; hint: string; needsNote: boolean }> = [
  { kind: "NOT_AVAILABLE", label: "Not available", hint: "Nobody or nothing there to pick up or drop off. The stop is missed; go on to the next.", needsNote: true },
  { kind: "WRONG_ADDRESS", label: "Wrong address or closed", hint: "Can't find it, can't get in, or it's closed. The stop is missed; go on to the next.", needsNote: true },
  { kind: "ROAD_BLOCKED", label: "Road blocked or bad weather", hint: "Flood, accident, road closed. Skip this stop, or wait it out.", needsNote: false },
  { kind: "VEHICLE_PROBLEM", label: "Vehicle problem", hint: "Breakdown, flat tire. The trip pauses until you tap Resume trip.", needsNote: false },
  { kind: "OTHER", label: "Something else", hint: "Tell the Scheduler what happened. The trip goes on as planned.", needsNote: true },
];

/** How a report reads on the trip, e.g. "Missed: Not available". */
export function stopReportLabel(report: Pick<ProblemReport, "kind" | "missed">): string {
  const label = STOP_REPORT_CHOICES.find((choice) => choice.kind === report.kind)?.label ?? "Problem";
  return report.missed ? `Missed: ${label}` : label;
}

/** The stops reported missed on a trip, by leg: they need no Arrived or Leaving. */
export function missedLegs(problems: ProblemReport[]): Map<string, ProblemReport> {
  return new Map(problems.filter((item) => item.missed && item.legId).map((item) => [item.legId!, item]));
}
