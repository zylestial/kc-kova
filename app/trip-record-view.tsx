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
 * Read-only Trip Record: one route card per leg (.route-cards in
 * globals.css, at every screen size), with every requester, purpose and
 * note served at that stop. A shared stop lists each request on its own line.
 */
export default function TripRecordView({ legs, stopsById, tasks = [] }: { legs: ViewLeg[]; stopsById: Map<string, StopInfo>; tasks?: StopTask[] }) {
  return (
    <>
      <ol className="route-cards route-plan">
        {legs.map((leg, index) => {
          const served = legStops(leg.stops, stopsById);
          const contact = [leg.contactName, leg.contactNumber].filter(Boolean).join(" · ");
          return (
            <li key={index} className="route-card">
              <div className="route-card-head">
                <b>Leg {String(index + 1).padStart(2, "0")}</b>
                {served.map((stop) => (
                  <div key={stop.id}>
                    {stop.requester && <div className="trip-job-requester">{stop.requester}</div>}
                    <JobLines stop={stop} tasks={tasks} />
                  </div>
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
