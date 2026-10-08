"use client";
import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useKovaData } from "@/lib/use-kova-data";
import { buildScheduledFinishedTrips } from "@/lib/trip-finish";
import { stopsFor } from "@/lib/trip-record";
import { completionLabel, completionMeaning } from "@/lib/status-text";
import { hasOpenProblem } from "@/lib/finished-trips";
import { sortRows, type Sort } from "@/lib/table-sort";
import TripRecordView from "./trip-record-view";
import { SortableHead, SortSelect, type SortColumn } from "./sortable-head";

const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

type SortKey = "date" | "plate" | "driver" | "route" | "status";
const columns: SortColumn<SortKey>[] = [
  { label: "DATE", key: "date" },
  { label: "PLATE NUMBER", key: "plate" },
  { label: "DRIVER", key: "driver" },
  { label: "ROUTE", key: "route" },
  { label: "STATUS", key: "status" },
  { label: "" },
];
const routeOf = (trip: { revision: { legs: { destinationName: string }[] } }) =>
  trip.revision.legs.map((leg) => leg.destinationName).join(" → ");

/**
 * Finished trips for a Scheduler, read-only. A Scheduler can't read trip
 * completions, so the list comes from request progress and shows no
 * odometer; reviewing and marking Done stay with the Admin.
 */
export default function SchedulerFinishedTrips() {
  const { schedules, completions, requests, problems } = useKovaData();
  const trips = useMemo(
    () => buildScheduledFinishedTrips(schedules, completions, requests, problems),
    [schedules, completions, requests, problems],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort<SortKey>>(null);
  const visible = sortRows(trips, sort, {
    date: (trip) => trip.schedule.date,
    plate: (trip) => trip.revision.plate,
    driver: (trip) => trip.revision.driverName,
    route: routeOf,
    status: (trip) => completionLabel[trip.state],
  });

  const selected = trips.find((trip) => trip.schedule.id === selectedId);
  const stopsById = new Map(stopsFor(requests).map((stop) => [stop.id, stop]));

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SCHEDULER</div>
          <h1>
            Finished Trips<span className="title-dot">.</span>
          </h1>
          <p>Trips Drivers have submitted. They leave Schedules once an Admin marks them done.</p>
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
        {trips.length > 0 && (
          <div className="admin-trip-filters sort-only">
            <SortSelect columns={columns} sort={sort} onSort={setSort} />
          </div>
        )}
        {trips.length ? (
          <div className="schedule-table admin-trip-table">
            <table>
              <SortableHead columns={columns} sort={sort} onSort={setSort} />
              <tbody>
                {visible.map((trip) => (
                  <tr key={trip.schedule.id} onClick={() => setSelectedId(trip.schedule.id)}>
                    <td>{dateLabel(trip.schedule.date)}</td>
                    <td>{trip.revision.plate}</td>
                    <td>{trip.revision.driverName}</td>
                    <td>{routeOf(trip)}</td>
                    <td>
                      <span className={"badge " + (trip.state === "DONE" ? "complete" : "")}>{completionLabel[trip.state]}</span>
                      {hasOpenProblem(trip) && <small>Open problem</small>}
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
            <div className="empty-icon">
              <CheckCircle2 size={30} />
            </div>
            <h3>No finished trips yet</h3>
            <p>Trips appear here once a Driver submits them.</p>
          </div>
        )}
      </section>

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Finished trip</DialogTitle>
            <DialogDescription>
              {selected && `${dateLabel(selected.schedule.date)} — ${selected.revision.plate} · ${selected.revision.driverName}`}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <>
              <TripRecordView legs={selected.revision.legs} stopsById={stopsById} />
              <p className="helper">{completionMeaning[selected.state]}</p>
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
