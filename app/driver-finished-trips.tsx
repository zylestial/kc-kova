"use client";
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getCompletions, getProblems, getRequests, getSchedules } from "@/lib/kova-api";
import { buildFinishedTrips, type FinishedTrip } from "@/lib/finished-trips";
import { stopsFor } from "@/lib/trip-record";
import { completionLabel, completionMeaning } from "@/lib/status-text";
import TripRecordView from "./trip-record-view";

const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * The Driver's own submitted trips, read-only. Shows whether an Admin has
 * marked each one Done and what happened to any problem they reported.
 * Bootstrap only sends this Driver's completions and reports.
 */
export default function DriverFinishedTrips() {
  const [trips, setTrips] = useState<FinishedTrip[]>([]);
  const [requests, setRequests] = useState(getRequests());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    function refresh() {
      setTrips(buildFinishedTrips(getSchedules(), getCompletions(), getProblems()));
      setRequests(getRequests());
    }
    refresh();
    window.addEventListener("kova-data-update", refresh);
    return () => window.removeEventListener("kova-data-update", refresh);
  }, []);

  const selected = trips.find((trip) => trip.schedule.id === selectedId);
  const stopsById = new Map(stopsFor(requests).map((stop) => [stop.id, stop]));

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">DRIVER</div>
          <h1>
            Finished Trips<span className="title-dot">.</span>
          </h1>
          <p>Trips you have submitted. An Admin marks each one done after review.</p>
        </div>
      </div>
      <section className="schedule-panel">
        <div className="panel-toolbar">
          <div>
            <CheckCircle2 size={20} />
            <h2>Submitted trips</h2>
            <span className="count">{trips.length}</span>
          </div>
        </div>
        {trips.length ? (
          <div className="schedule-table admin-trip-table">
            <table>
              <thead>
                <tr>
                  {["DATE", "PLATE NUMBER", "ROUTE", "DISTANCE", "STATUS", ""].map((title, i) => (
                    <th key={i}>{title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trips.map((trip) => (
                  <tr key={trip.schedule.id} onClick={() => setSelectedId(trip.schedule.id)}>
                    <td>{dateLabel(trip.schedule.date)}</td>
                    <td>{trip.revision.plate}</td>
                    <td>{trip.revision.legs.map((leg) => leg.destinationName).join(" → ")}</td>
                    <td>{trip.completion.distance} km</td>
                    <td>
                      <span className={"badge " + (trip.completion.status === "DONE" ? "complete" : "")}>
                        {completionLabel[trip.completion.status]}
                      </span>
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedId(trip.schedule.id);
                        }}
                      >
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <h3>No finished trips yet</h3>
            <p>Trips you complete will appear here.</p>
          </div>
        )}
      </section>

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Finished trip</DialogTitle>
            <DialogDescription>{selected && `${dateLabel(selected.schedule.date)} — ${selected.revision.plate}`}</DialogDescription>
          </DialogHeader>
          {selected && (
            <>
              <TripRecordView legs={selected.revision.legs} stopsById={stopsById} />
              <p className="helper">
                Odometer: {selected.completion.startOdometer} → {selected.completion.endOdometer} ({selected.completion.distance} km) ·{" "}
                {completionLabel[selected.completion.status]}
              </p>
              <p className="helper">{completionMeaning[selected.completion.status]}</p>
              {selected.problems.map((item) => (
                <p className="helper" key={item.id}>
                  <strong>{item.status === "OPEN" ? "Problem reported" : "Problem handled"}:</strong> {item.note}
                  {item.status === "HANDLED" && item.handlingNote && ` — ${item.handlingNote}`}
                </p>
              ))}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
