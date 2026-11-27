"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import { tapTimeLabel } from "@/lib/attendance";
import type { ProblemReport, StopTask } from "@/lib/kova-api";
import { stopReportLabel } from "@/lib/stop-reports";
import { requestDoneAt } from "@/lib/stop-tasks";
import { formTimeValue, hhmmLabel, type LegTimes } from "@/lib/stop-times";
import { legStops, stopWhat, type StopInfo } from "@/lib/trip-record";
import { TripReport } from "./trip-reports";

type ViewLeg = {
  id?: string;
  origin: string;
  destinationName: string;
  plannedTimeOut: string;
  plannedTimeIn: string;
  contactName: string;
  contactNumber: string;
  stops: string[];
};

/**
 * A request's purpose (bold), its details below, then when it was marked
 * Done (0088) as a small tag: three kinds of information, each on its own line.
 */
function JobLines({ stop, tasks }: { stop: StopInfo; tasks: StopTask[] }) {
  const done = requestDoneAt(tasks, stop.requestId);
  return (
    <div className="trip-job">
      <b>{stopWhat(stop)}</b>
      {stop.details && <span className="trip-job-details">{stop.details}</span>}
      {done && <span className="trip-job-done">Done {tapTimeLabel(done)}</span>}
    </div>
  );
}

/**
 * A leg's Time Out or Time In. On a finished trip the tapped time leads
 * (owner's call 2026-11-26) with the planned one beside it; otherwise the plan.
 */
function LegTime({ label, planned, actual }: { label: string; planned: string; actual: string | null | undefined }) {
  if (actual === undefined) return <span className="route-planned">{label} {planned || "—"}</span>;
  return (
    <span className="route-planned">
      {actual ? (
        <b className="route-tapped">
          {label} {hhmmLabel(actual)}
        </b>
      ) : (
        <span className="route-untapped">{label} not tapped</span>
      )}
      {planned && <small className="route-plan-time"> · planned {hhmmLabel(planned)}</small>}
    </span>
  );
}

/**
 * Read-only Trip Record: one route card per leg (.route-cards in
 * globals.css, at every screen size), with every requester, purpose and
 * note served at that stop. A shared stop lists each request on its own line.
 * A leg with a stop report gets a tag that opens the report in the card
 * (owner's call 2026-11-26); `openReportId` starts that one open.
 */
export default function TripRecordView({
  legs,
  stopsById,
  tasks = [],
  reports = [],
  openReportId,
  times,
}: {
  legs: ViewLeg[];
  stopsById: Map<string, StopInfo>;
  tasks?: StopTask[];
  reports?: ProblemReport[];
  openReportId?: string | null;
  /** A finished trip's actual times (useTripTimes); each leg then shows when it was tapped. */
  times?: LegTimes[];
}) {
  // undefined: no actual times given (a plan); null: given but not tapped.
  const actualOf = (leg: ViewLeg, side: "out" | "in") => {
    if (!times) return undefined;
    const found = times.find((item) => item.leg.id === leg.id);
    return found ? formTimeValue(side === "out" ? found.out : found.in) : null;
  };
  const [open, setOpen] = useState<Set<string>>(() => new Set(openReportId ? [openReportId] : []));
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <>
      <ol className="route-cards route-plan">
        {legs.map((leg, index) => {
          const served = legStops(leg.stops, stopsById);
          const contact = [leg.contactName, leg.contactNumber].filter(Boolean).join(" · ");
          const legReports = leg.id ? reports.filter((report) => report.legId === leg.id) : [];
          return (
            <li key={index} className="route-card">
              <div className="route-card-head">
                <b>Leg {String(index + 1).padStart(2, "0")}</b>
                {legReports.map((report) => (
                  <button
                    key={report.id}
                    type="button"
                    className={"leg-report-tag " + (report.status === "OPEN" ? "open" : "handled")}
                    aria-expanded={open.has(report.id)}
                    onClick={() => toggle(report.id)}
                  >
                    <TriangleAlert size={14} aria-hidden="true" />
                    {stopReportLabel(report)}
                    {open.has(report.id) ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                  </button>
                ))}
                {served.map((stop) => (
                  <div key={stop.id}>
                    {stop.requester && <div className="trip-job-requester">{stop.requester}</div>}
                    <JobLines stop={stop} tasks={tasks} />
                  </div>
                ))}
              </div>
              {legReports
                .filter((report) => open.has(report.id))
                .map((report) => (
                  <TripReport key={report.id} report={report} legs={legs} anchor={`leg-report-${report.id}`} />
                ))}
              <div className="route-stop route-from">
                <span className="route-place">{leg.origin}</span>
                <LegTime label="out" planned={leg.plannedTimeOut} actual={actualOf(leg, "out")} />
              </div>
              <div className="route-stop route-to">
                <span className="route-place">{leg.destinationName}</span>
                <LegTime label="in" planned={leg.plannedTimeIn} actual={actualOf(leg, "in")} />
              </div>
              {contact && <div className="route-contact">Contact: {contact}</div>}
            </li>
          );
        })}
      </ol>
    </>
  );
}
