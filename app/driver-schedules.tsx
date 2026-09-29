"use client";
import { useAutoClear } from "@/lib/use-auto-clear";
import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getCompletions,
  getProblems,
  getRequests,
  getSchedules,
  reportProblem,
  submitCompletion,
  type ProblemReport,
  type Schedule,
  type ScheduleRevision,
  type TripCompletion,
} from "@/lib/kova-api";
import { stopsFor } from "@/lib/trip-record";
import { hasTripEnded, manilaToday } from "@/lib/timezone";
import { lastEndReading, longTripWarning } from "@/lib/odometer";
import { completionLabel } from "@/lib/status-text";
import TripRecordView from "./trip-record-view";

const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

type Trip = {
  schedule: Schedule;
  revision: ScheduleRevision;
  completion?: TripCompletion;
  problems: ProblemReport[];
  ended: boolean;
  /** When Complete trip unlocks, e.g. "3:58 PM", or "Sep 26, 3:58 PM" on a later day. */
  availableAt: string;
};

function availableAtLabel(date: string, timeIn: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(timeIn);
  if (!match) return "the last planned Time In";
  const hours = Number(match[1]);
  const time = `${hours % 12 || 12}:${match[2]} ${hours < 12 ? "AM" : "PM"}`;
  return date === manilaToday() ? time : `${dateLabel(date)}, ${time}`;
}

function loadTrips(driverId: string | null): Trip[] {
  const completions = getCompletions();
  const problems = getProblems();
  return getSchedules()
    .flatMap((schedule) => {
      if (schedule.status !== "ACTIVE") return [];
      const revision = schedule.revisions.find((item) => item.id === schedule.publishedRevisionId);
      // null driverId means Admin viewing as Driver: show every vehicle's
      // trips, since Admin has no driver_id of their own to filter by.
      if (!revision || (driverId !== null && revision.driverId !== driverId)) return [];
      const lastIn = revision.legs[revision.legs.length - 1]?.plannedTimeIn ?? "";
      return [
        {
          schedule,
          revision,
          completion: completions.find((item) => item.scheduleId === schedule.id),
          problems: problems.filter((item) => item.scheduleId === schedule.id),
          ended: hasTripEnded(schedule.date, lastIn),
          availableAt: availableAtLabel(schedule.date, lastIn),
        },
      ];
    })
    .sort((a, b) => a.schedule.date.localeCompare(b.schedule.date));
}

/**
 * The Driver's published schedules. Each opens a read-only Trip Record with
 * Complete trip (one odometer pair, once the trip has ended) and Report a
 * problem. The database enforces who and when; this only shapes the screen.
 */
export default function DriverSchedules({ driverId }: { driverId: string | null }) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [requests, setRequests] = useState(getRequests());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "complete" | "problem">("view");
  const [completeStep, setCompleteStep] = useState<"odometer" | "final">("odometer");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [fullTank, setFullTank] = useState(false);
  const [fleetCardUsed, setFleetCardUsed] = useState(false);
  const [gasReceiptAttached, setGasReceiptAttached] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useAutoClear(notice, setNotice);

  useEffect(() => {
    function refresh() {
      setTrips(loadTrips(driverId));
      setRequests(getRequests());
    }
    refresh();
    window.addEventListener("kova-data-update", refresh);
    return () => window.removeEventListener("kova-data-update", refresh);
  }, [driverId]);

  const selected = trips.find((trip) => trip.schedule.id === selectedId);
  const stopsById = new Map(stopsFor(requests).map((stop) => [stop.id, stop]));

  function close() {
    if (busy) return;
    setSelectedId(null);
    setMode("view");
    setCompleteStep("odometer");
    setStart("");
    setEnd("");
    setFullTank(false);
    setFleetCardUsed(false);
    setGasReceiptAttached(false);
    setNote("");
    setError("");
  }

  const lastReading = selected ? lastEndReading(selected.revision.plate, getSchedules(), getCompletions()) : null;
  const startNumber = start.trim() === "" ? NaN : Number(start);
  const endNumber = end.trim() === "" ? NaN : Number(end);
  const odometerError =
    !Number.isInteger(startNumber) || !Number.isInteger(endNumber) || startNumber < 0
      ? "Enter whole-number readings."
      : endNumber < startNumber
        ? "The ending reading can't be lower than the start."
        : "";

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "complete") {
        await submitCompletion(selected.schedule.id, startNumber, endNumber, { fullTank, fleetCardUsed, gasReceiptAttached });
        setNotice(`Trip on ${dateLabel(selected.schedule.date)} submitted.`);
      } else {
        await reportProblem(selected.schedule.id, note.trim());
        setNotice(`Problem reported for ${dateLabel(selected.schedule.date)}.`);
      }
      setBusy(false);
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  const statusOf = (trip: Trip) =>
    trip.completion ? [completionLabel[trip.completion.status], "scheduled"] : trip.ended ? ["Ready to complete", "pending"] : ["Upcoming", "pending"];

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">DRIVER</div>
          <h1>
            My Schedule<span className="title-dot">.</span>
          </h1>
          <p>Approved trips assigned to you. Complete each one after it ends.</p>
        </div>
      </div>
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      <section className="schedule-panel">
        <div className="panel-toolbar">
          <div>
            <CalendarDays size={20} />
            <h2>Your trips</h2>
            <span className="count">{trips.length}</span>
          </div>
        </div>
        {trips.length ? (
          <div className="schedule-table admin-trip-table">
            <table>
              <thead>
                <tr>
                  {["DATE", "VEHICLE", "ROUTE", "STATUS", ""].map((title) => (
                    <th key={title}>{title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trips.map((trip) => {
                  const [label, pill] = statusOf(trip);
                  return (
                    <tr key={trip.schedule.id} onClick={() => { setSelectedId(trip.schedule.id); setNotice(""); }}>
                      <td>{dateLabel(trip.schedule.date)}</td>
                      <td>{trip.revision.plate}</td>
                      <td>{trip.revision.legs.map((leg) => leg.destinationName).join(" → ")}</td>
                      <td>
                        <span className={"status-pill " + pill}>{label}</span>
                        {trip.problems.length > 0 && <small>Problem reported</small>}
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedId(trip.schedule.id);
                            setNotice("");
                          }}
                        >
                          Open
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="empty-icon">
              <CalendarDays size={30} />
            </div>
            <h3>No trips assigned</h3>
            <p>Approved schedules with you as Driver will appear here.</p>
          </div>
        )}
      </section>

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {mode === "complete" ? "Complete this trip" : mode === "problem" ? "Report a problem" : "Trip Record"}
            </DialogTitle>
            <DialogDescription>
              {selected && `${dateLabel(selected.schedule.date)} — ${selected.revision.plate}`}
            </DialogDescription>
          </DialogHeader>
          {selected && mode === "view" && (
            <>
              <TripRecordView legs={selected.revision.legs} stopsById={stopsById} />
              {selected.completion && (
                <p className="helper">
                  Submitted: {selected.completion.startOdometer} → {selected.completion.endOdometer} (
                  {selected.completion.distance} km).
                </p>
              )}
              {selected.problems.map((item) => (
                <p className="helper" key={item.id}>
                  Problem reported: {item.note}
                </p>
              ))}
              {!selected.completion && !selected.ended && (
                <p className="helper">Complete trip is available after {selected.availableAt}.</p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setMode("problem")}>
                  Report a problem
                </Button>
                {!selected.completion && (
                  <Button className="primary" disabled={!selected.ended} onClick={() => {
                      setMode("complete");
                      setCompleteStep("odometer");
                      if (!start && lastReading !== null) setStart(String(lastReading));
                    }}
                  >
                    Complete trip
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
          {selected && mode === "complete" && completeStep === "odometer" && (
            <>
              <label className="field">
                <span>Starting odometer (km) *</span>
                <Input
                  inputMode="numeric"
                  placeholder="e.g. 45210"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
                {lastReading !== null && start === String(lastReading) && (
                  <small className="field-hint">
                    Filled in from this vehicle&apos;s last trip. Change it if the dashboard shows something different.
                  </small>
                )}
              </label>
              <label className="field">
                <span>Ending odometer (km) *</span>
                <Input
                  inputMode="numeric"
                  placeholder="e.g. 45252"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </label>
              {!odometerError && (
                <p className="helper" role="status">
                  <b>{(endNumber - startNumber).toLocaleString("en-US")} km</b> driven, from {startNumber.toLocaleString("en-US")} to{" "}
                  {endNumber.toLocaleString("en-US")}. Check this is right.
                </p>
              )}
              {!odometerError && longTripWarning(endNumber - startNumber) && (
                <p className="notice" role="alert">
                  {longTripWarning(endNumber - startNumber)}
                </p>
              )}
            </>
          )}
          {selected && mode === "complete" && completeStep === "final" && (
            <>
              <div className="field">
                <span>Final return</span>
                <div className="person-projects">
                  <label>
                    <Checkbox checked={fullTank} onCheckedChange={(v) => setFullTank(v === true)} />
                    Vehicle returned with a full tank
                  </label>
                  <label>
                    <Checkbox checked={fleetCardUsed} onCheckedChange={(v) => setFleetCardUsed(v === true)} />
                    Fleet card used
                  </label>
                  <label>
                    <Checkbox checked={gasReceiptAttached} onCheckedChange={(v) => setGasReceiptAttached(v === true)} />
                    Gas receipt submitted
                  </label>
                </div>
              </div>
              <p className="helper">
                Submitting can&apos;t be undone. It locks the trip for you; an Admin reviews it.
              </p>
            </>
          )}
          {selected && mode === "problem" && (
            <label className="field">
              <span>What went wrong *</span>
              <Textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
            </label>
          )}
          {error && (
            <p className="modal-error" role="alert">
              {error}
            </p>
          )}
          {selected && mode !== "view" && (
            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (mode === "complete" && completeStep === "final") {
                    setCompleteStep("odometer");
                  } else {
                    setMode("view");
                  }
                  setError("");
                }}
              >
                Back
              </Button>
              {mode === "complete" && completeStep === "odometer" ? (
                <Button className="primary" disabled={!!odometerError} onClick={() => setCompleteStep("final")}>
                  Next
                </Button>
              ) : (
                <Button
                  className="primary"
                  disabled={busy || (mode === "problem" && !note.trim())}
                  onClick={submit}
                >
                  {busy ? "Working…" : mode === "complete" ? "Submit trip" : "Send report"}
                </Button>
              )}
            </DialogFooter>
          )}
          {mode === "complete" && completeStep === "odometer" && odometerError && (start || end) && (
            <p className="helper">{odometerError}</p>
          )}
          {mode === "complete" && completeStep === "odometer" && odometerError && !start && !end && (
            <p className="helper">Enter the starting and ending readings to continue.</p>
          )}
          {mode === "problem" && !note.trim() && <p className="helper">Describe what went wrong to send the report.</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
