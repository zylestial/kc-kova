import type { ProblemReport } from "@/lib/kova-api";
import { stopReportLabel, stopReportStatus } from "@/lib/stop-reports";

type Leg = { id?: string; destinationName: string };

/**
 * One stop report or trip problem as its own block (owner's call
 * 2026-11-26): what it was with an Open / Handled tag, then labelled Place,
 * Note, What was done or Status. `action` adds a button (Mark handled).
 */
export function TripReport({
  report,
  legs,
  action,
  anchor = `report-${report.id}`,
}: {
  report: ProblemReport;
  legs: Leg[];
  action?: React.ReactNode;
  /** The element id a link scrolls to; a leg card's copy uses its own. */
  anchor?: string;
}) {
  const place = report.legId ? (legs.find((leg) => leg.id === report.legId)?.destinationName ?? "A stop") : "";
  return (
    <div className="trip-report" id={anchor}>
      <div className="trip-report-head">
        <b>{report.legId ? stopReportLabel(report) : "Problem on the trip"}</b>
        <span className={"trip-report-tag " + (report.status === "OPEN" ? "open" : "handled")}>
          {report.status === "OPEN" ? "Open" : "Handled"}
        </span>
      </div>
      <dl>
        {place && (
          <>
            <dt>Place</dt>
            <dd>{place}</dd>
          </>
        )}
        {report.note && (
          <>
            <dt>Note</dt>
            <dd>{report.note}</dd>
          </>
        )}
        {report.status === "HANDLED" && report.handlingNote && (
          <>
            <dt>What was done</dt>
            <dd>{report.handlingNote}</dd>
          </>
        )}
        {/* A stop report closes with its answer on Scheduling, never on Finished Trips (0083). */}
        {report.status === "OPEN" && report.legId && (
          <>
            <dt>Status</dt>
            <dd>{stopReportStatus(report)}</dd>
          </>
        )}
      </dl>
      {action}
    </div>
  );
}

/** A trip's stop reports and problems under one heading; nothing when there are none. */
export default function TripReports({
  problems,
  legs,
  actionFor,
}: {
  problems: ProblemReport[];
  legs: Leg[];
  actionFor?: (report: ProblemReport) => React.ReactNode;
}) {
  if (!problems.length) return null;
  return (
    <>
      <h3 className="stop-times-heading">{problems.some((item) => !item.legId) ? "Reported problems" : "Stop reports"}</h3>
      {problems.map((item) => (
        <TripReport key={item.id} report={item} legs={legs} action={actionFor?.(item)} />
      ))}
    </>
  );
}
