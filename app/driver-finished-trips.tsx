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
import { buildFinishedTrips } from "@/lib/finished-trips";
import { stopsFor } from "@/lib/trip-record";
import { completionLabel, completionMeaning } from "@/lib/status-text";
import { sortRows, type Sort } from "@/lib/table-sort";
import TripRecordView from "./trip-record-view";
import { SortableHead, SortSelect, type SortColumn } from "./sortable-head";
import { kmLabel, readingsLabel } from "@/lib/odometer";

const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

type SortKey = "date" | "plate" | "route" | "distance" | "status";
const columns: SortColumn<SortKey>[] = [
  { label: "DATE", key: "date" },
  { label: "PLATE NUMBER", key: "plate" },
  { label: "ROUTE", key: "route" },
  { label: "DISTANCE", key: "distance" },
  { label: "STATUS", key: "status" },
  { label: "" },
];

/**
 * The Driver's own submitted trips, read-only. Shows whether an Admin has
 * marked each one Done and what happened to any problem they reported.
 * Bootstrap only sends this Driver's completions and reports.
 */
export default function DriverFinishedTrips() {
  const { schedules, completions, problems, requests } = useKovaData();
  const trips = useMemo(() => buildFinishedTrips(schedules, completions, problems), [schedules, completions, problems]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort<SortKey>>(null);
  const visible = sortRows(trips, sort, {
    date: (trip) => trip.schedule.date,
    plate: (trip) => trip.revision.plate,
    route: (trip) => trip.revision.legs.map((leg) => leg.destinationName).join(" → "),
    distance: (trip) => trip.completion.distance ?? -1,
    status: (trip) => completionLabel[trip.completion.status],
  });

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
        {trips.length > 0 && (
          <div className="admin-trip-filters sort-only">
            <SortSelect columns={columns} sort={sort} onSort={setSort} />
          </div>
        )}
        {trips.length ? (
          <div className="schedule-table admin-trip-table">
            {/* On a phone each row is a short card, laid out by the c-* cell classes. */}
            <table data-compact="">
              <SortableHead columns={columns} sort={sort} onSort={setSort} />
              <tbody>
                {visible.map((trip) => (
                  <tr key={trip.schedule.id} onClick={() => setSelectedId(trip.schedule.id)}>
                    <td className="c-meta">{dateLabel(trip.schedule.date)}</td>
                    <td className="c-meta">{trip.revision.plate}</td>
                    <td className="c-title">{trip.revision.legs.map((leg) => leg.destinationName).join(" → ")}</td>
                    <td className="c-meta">{kmLabel(trip.completion.distance)}</td>
                    <td className="c-status">
                      <span className={"badge " + (trip.completion.status === "DONE" ? "complete" : "")}>
                        {completionLabel[trip.completion.status]}
                      </span>
                    </td>
                    <td className="c-hide">
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
                Odometer: {readingsLabel(selected.completion)} ·{" "}
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
