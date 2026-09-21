"use client";
import { useEffect, useState } from "react";
import { CalendarDays, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  canFinishTrip,
  getDriverTrips,
  getRecordForBooking,
  getVehicles,
  type Booking,
  type VehicleRecord,
} from "@/lib/kova-api";

const hour = (h: number) =>
  `${String(h % 12 || 12)}:00 ${h < 12 ? "AM" : "PM"}`;
const tripTime = (b: Booking) => `${hour(b.start)} – ${hour(b.end)}`;
const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export default function DriverTrips({
  driverId,
  finished,
  onOpenRecord,
}: {
  driverId: string;
  finished: boolean;
  onOpenRecord: (booking: Booking) => void;
}) {
  const [trips, setTrips] = useState<Booking[]>([]);
  const [records, setRecords] = useState<Record<string, VehicleRecord>>({});
  const [vehicleNames, setVehicleNames] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Booking | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clock, setClock] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    function refresh() {
      setTrips(getDriverTrips(driverId));
      setRecords(
        Object.fromEntries(
          getDriverTrips(driverId).flatMap((b) => {
            const r = getRecordForBooking(b);
            return r ? [[b.id, r]] : [];
          }),
        ),
      );
      setVehicleNames(
        Object.fromEntries(getVehicles().map((v) => [v.plate, v.name])),
      );
    }
    refresh();
    window.addEventListener("kova-data-update", refresh);
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => {
      window.removeEventListener("kova-data-update", refresh);
      window.clearInterval(timer);
    };
  }, [driverId]);
  const visible = trips
    .filter((b) => Boolean(records[b.id]?.submittedAt) === finished)
    .sort((a, b) => b.date.localeCompare(a.date) || a.start - b.start);
  const showHistoricalProject = visible.some((booking) => !!booking.project);
  function continueTrip() {
    if (
      !selected ||
      selected.driverId !== driverId ||
      !canFinishTrip(selected)
    ) {
      setError("Finish Trip is available after the scheduled end time.");
      setConfirming(false);
      return;
    }
    setConfirming(false);
    setSelected(null);
    onOpenRecord(selected);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">DRIVER</div>
          <h1>
            {finished ? "Finished Trips" : "My Schedule"}
            <span className="title-dot">.</span>
          </h1>
          <p>
            {finished
              ? "Your submitted and completed trips."
              : "Trips assigned to you."}
          </p>
        </div>
      </div>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <section className="schedule-panel">
        <div className="panel-toolbar">
          <div>
            <CalendarDays size={20} />
            <h2>{finished ? "Finished trips" : "Assigned trips"}</h2>
            <span className="count">{visible.length}</span>
          </div>
        </div>
        {visible.length ? (
          <div className="schedule-table driver-trip-table">
            <table>
              <thead>
                <tr>
                  {(finished
                    ? [
                        "DATE",
                        "VEHICLE",
                        "PLATE NUMBER",
                        "DESTINATION",
                        "STATUS",
                      ]
                    : [
                        "DATE",
                        "SCHEDULED TIME",
                        "VEHICLE",
                        "PLATE NUMBER",
                        ...(showHistoricalProject
                          ? ["PROJECT / DEPARTMENT"]
                          : []),
                        "REQUESTED BY",
                        "DESTINATION",
                        "PURPOSE",
                        "STATUS",
                      ]
                  ).map((t) => (
                    <th key={t}>{t}</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((b) => (
                  <tr
                    key={b.id}
                    onClick={
                      finished
                        ? () => onOpenRecord(b)
                        : () => {
                            setSelected(b);
                            setError("");
                          }
                    }
                  >
                    <td>{dateLabel(b.date)}</td>
                    {!finished && <td>{tripTime(b)}</td>}
                    <td>
                      {records[b.id]?.vehicle ||
                        vehicleNames[b.plate] ||
                        b.plate}
                    </td>
                    <td>{b.plate}</td>
                    {!finished && (
                      <>
                        {showHistoricalProject && <td>{b.project || "—"}</td>}
                        <td>{b.requestedBy}</td>
                      </>
                    )}
                    <td>{b.destination}</td>
                    {!finished && <td>{b.purpose}</td>}
                    <td>
                      <span className={"badge " + (finished ? "complete" : "")}>
                        {finished
                          ? records[b.id]?.status === "Completed"
                            ? "Completed"
                            : "Submitted for review"
                          : "Scheduled"}
                      </span>
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (finished) onOpenRecord(b);
                          else {
                            setSelected(b);
                            setError("");
                          }
                        }}
                      >
                        {finished ? "View record" : "Details"}
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
              <Truck size={30} />
            </div>
            <h3>
              {finished ? "No finished trips yet" : "No trips assigned yet"}
            </h3>
            <p>
              {finished
                ? "Your saved trip records will appear here."
                : "Your assigned schedule will appear here."}
            </p>
          </div>
        )}
      </section>
      <Dialog
        open={!!selected && !confirming}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="driver-trip-modal">
          <DialogHeader>
            <DialogTitle>Trip Details</DialogTitle>
            <DialogDescription>Scheduled trip information</DialogDescription>
          </DialogHeader>
          {selected && (
            <>
              <div className="driver-trip-details">
                {[
                  ["Date", dateLabel(selected.date)],
                  ["Scheduled Time", tripTime(selected)],
                  ["Vehicle", vehicleNames[selected.plate] || selected.plate],
                  ["Plate Number", selected.plate],
                  ...(selected.project
                    ? [["Project / Department", selected.project]]
                    : []),
                  ["Requested By", selected.requestedBy],
                  ["Destination", selected.destination],
                  ["Purpose", selected.purpose],
                  ["Status", "Scheduled"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelected(null)}>
                  Close
                </Button>
                <Button
                  className="primary"
                  disabled={
                    !canFinishTrip(selected, new Date(clock || Date.now()))
                  }
                  onClick={() => setConfirming(true)}
                >
                  Finish Trip
                </Button>
              </DialogFooter>
              {!canFinishTrip(selected, new Date(clock || Date.now())) && (
                <p className="driver-trip-help">
                  Available after the scheduled trip time has passed.
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finish Trip?</AlertDialogTitle>
            <AlertDialogDescription>
              Have you completed this trip?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelected(null)}>
              Not Yet
            </AlertDialogCancel>
            <AlertDialogAction onClick={continueTrip}>
              Yes, Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
