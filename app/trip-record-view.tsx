"use client";
import type { StopInfo } from "@/lib/trip-record";

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
 * Read-only Trip Record: one row per leg, with every requestor and purpose
 * served at that stop. A shared stop lists each request on its own line.
 */
export default function TripRecordView({ legs, stopsById }: { legs: ViewLeg[]; stopsById: Map<string, StopInfo> }) {
  return (
    <div className="schedule-table trip-record-view">
      <table>
        <thead>
          <tr>
            {["LEG", "REQUESTOR", "PURPOSE / ACTIVITY", "ORIGIN", "TIME OUT", "DESTINATION", "TIME IN", "CONTACT"].map((title) => (
              <th key={title}>{title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {legs.map((leg, index) => {
            const served = leg.stops.map((id) => stopsById.get(id)).filter((stop): stop is StopInfo => !!stop);
            return (
              <tr key={index}>
                <td>{String(index + 1).padStart(2, "0")}</td>
                <td>{served.length ? served.map((stop) => <div key={stop.id}>{stop.requester}</div>) : "—"}</td>
                <td>
                  {served.length
                    ? [...new Set(served.map((stop) => stop.purposeName))].map((purpose) => <div key={purpose}>{purpose}</div>)
                    : "—"}
                </td>
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
  );
}
