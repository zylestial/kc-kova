"use client";
import { tapTimeLabel } from "@/lib/attendance";
import type { StopTask } from "@/lib/kova-api";
import { requestDoneAt } from "@/lib/stop-tasks";
import { legStops, stopWhat, type StopInfo } from "@/lib/trip-record";

type ViewLeg = {
  origin: string;
  destinationName: string;
  plannedTimeOut: string;
  plannedTimeIn: string;
  contactName: string;
  contactNumber: string;
  stops: string[];
};

/** A request's purpose and notes, on one line, with when it was marked Done (0088). */
const jobLine = (stop: StopInfo, tasks: StopTask[]) => {
  const done = requestDoneAt(tasks, stop.requestId);
  return [stopWhat(stop), stop.details, done && `Done ${tapTimeLabel(done)}`].filter(Boolean).join(" · ");
};

/**
 * Read-only Trip Record: one row per leg, with every requester, purpose and
 * note served at that stop. A shared stop lists each request on its own line.
 * Phones get one route card per leg instead (.route-cards in globals.css).
 */
export default function TripRecordView({ legs, stopsById, tasks = [] }: { legs: ViewLeg[]; stopsById: Map<string, StopInfo>; tasks?: StopTask[] }) {
  const jobText = (stop: StopInfo) => jobLine(stop, tasks);
  return (
    <>
      <div className="schedule-table trip-record-view">
        <table>
          <thead>
            <tr>
              {["LEG", "REQUESTER", "PURPOSE / ACTIVITY", "ORIGIN", "TIME OUT", "DESTINATION", "TIME IN", "CONTACT"].map((title) => (
                <th key={title}>{title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {legs.map((leg, index) => {
              const served = legStops(leg.stops, stopsById);
              return (
                <tr key={index}>
                  <td>{String(index + 1).padStart(2, "0")}</td>
                  <td>{served.length ? served.map((stop) => <div key={stop.id}>{stop.requester}</div>) : "—"}</td>
                  <td>{served.length ? served.map((stop) => <div key={stop.id}>{jobText(stop)}</div>) : "—"}</td>
                  <td>{leg.origin}</td>
                  <td>{leg.plannedTimeOut || "—"}</td>
                  <td>{leg.destinationName}</td>
                  <td>{leg.plannedTimeIn || "—"}</td>
                  <td>{[leg.contactName, leg.contactNumber].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ol className="route-cards route-plan">
        {legs.map((leg, index) => {
          const served = legStops(leg.stops, stopsById);
          const contact = [leg.contactName, leg.contactNumber].filter(Boolean).join(" · ");
          return (
            <li key={index} className="route-card">
              <div className="route-card-head">
                <b>Leg {String(index + 1).padStart(2, "0")}</b>
                {served.map((stop) => (
                  <div key={stop.id}>{[stop.requester, jobText(stop)].filter(Boolean).join(" · ")}</div>
                ))}
              </div>
              <div className="route-stop route-from">
                <span className="route-place">{leg.origin}</span>
                <span className="route-planned">out {leg.plannedTimeOut || "—"}</span>
              </div>
              <div className="route-stop route-to">
                <span className="route-place">{leg.destinationName}</span>
                <span className="route-planned">in {leg.plannedTimeIn || "—"}</span>
              </div>
              {contact && <div className="route-contact">Contact: {contact}</div>}
            </li>
          );
        })}
      </ol>
    </>
  );
}
