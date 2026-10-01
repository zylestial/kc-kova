"use client";
import { useAutoClear } from "@/lib/use-auto-clear";
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  correctCompletion,
  getCompletions,
  getProblems,
  getRequests,
  getSchedules,
  handleProblem,
  markCompletionDone,
  type Schedule,
} from "@/lib/kova-api";
import { buildAdminTrips, hasOpenProblem, type AdminTrip } from "@/lib/finished-trips";
import { stopsFor } from "@/lib/trip-record";
import FinishedTripPrint from "./finished-trip-print";
import { completionLabel, completionMeaning } from "@/lib/status-text";
import TripRecordView from "./trip-record-view";

const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

type Mode = "view" | "correct" | "done" | "handle";

const notSubmitted = "Not submitted yet";

/**
 * Admin Finished Trips: every submitted completion, plus unsubmitted trips
 * with a problem report (only handling applies to those), newest first. An Admin
 * can correct the odometers until the trip is marked Done, mark it Done
 * (which locks it), handle the Driver's problem reports and print the form.
 * Postgres decides what is allowed; this only shapes the screen.
 */
export default function AdminFinishedTrips({ initialOpenId }: { initialOpenId?: string } = {}) {
  const [trips, setTrips] = useState<AdminTrip[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [requests, setRequests] = useState(getRequests());
  const [date, setDate] = useState("");
  const [driver, setDriver] = useState("all");
  const [vehicle, setVehicle] = useState("all");
  const [status, setStatus] = useState("all");
  const [problems, setProblems] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(() => initialOpenId ?? null);
  const [mode, setMode] = useState<Mode>("view");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [problemId, setProblemId] = useState<string | null>(null);
  const [handlingNote, setHandlingNote] = useState("");
  const [followUp, setFollowUp] = useState("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useAutoClear(notice, setNotice);

  useEffect(() => {
    function refresh() {
      const all = getSchedules();
      setSchedules(all);
      setTrips(buildAdminTrips(all, getCompletions(), getProblems()));
      setRequests(getRequests());
    }
    refresh();
    window.addEventListener("kova-data-update", refresh);
    return () => window.removeEventListener("kova-data-update", refresh);
  }, []);

  const drivers = [...new Set(trips.map((trip) => trip.revision.driverName))].sort();
  const vehicles = [...new Set(trips.map((trip) => trip.revision.plate))].sort();
  const visible = trips.filter(
    (trip) =>
      (!date || trip.schedule.date === date) &&
      (driver === "all" || trip.revision.driverName === driver) &&
      (vehicle === "all" || trip.revision.plate === vehicle) &&
      (status === "all" || status === (trip.completion?.status ?? "UNSUBMITTED")) &&
      (problems === "all" || (problems === "open" ? hasOpenProblem(trip) : !hasOpenProblem(trip))),
  );

  const selected = trips.find((trip) => trip.schedule.id === selectedId);
  const stopsById = new Map(stopsFor(requests).map((stop) => [stop.id, stop]));
  const isDone = selected?.completion?.status === "DONE";
  // Any other published, active schedule can follow up on a problem.
  const followUps = schedules
    .filter((item) => item.status === "ACTIVE" && item.publishedRevisionId && item.id !== selectedId)
    .sort((a, b) => b.date.localeCompare(a.date));

  function close() {
    if (busy) return;
    setSelectedId(null);
    reset();
  }
  function reset() {
    setMode("view");
    setStart("");
    setEnd("");
    setProblemId(null);
    setHandlingNote("");
    setFollowUp("none");
    setError("");
  }

  const startNumber = start.trim() === "" ? NaN : Number(start);
  const endNumber = end.trim() === "" ? NaN : Number(end);
  const odometerError =
    !Number.isInteger(startNumber) || !Number.isInteger(endNumber) || startNumber < 0
      ? "Enter whole-number readings."
      : endNumber < startNumber
        ? "The ending reading can't be lower than the start."
        : "";

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      setNotice(message);
      setBusy(false);
      reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  function submit() {
    if (!selected) return;
    const id = selected.schedule.id;
    const label = dateLabel(selected.schedule.date);
    if (mode === "correct") return run(() => correctCompletion(id, startNumber, endNumber), `Odometers corrected for ${label}.`);
    if (mode === "done") return run(() => markCompletionDone(id), `Trip on ${label} marked as done.`);
    if (mode === "handle" && problemId) {
      return run(
        () => handleProblem(problemId, handlingNote.trim(), followUp === "none" ? undefined : followUp),
        `Problem on ${label} marked as handled.`,
      );
    }
  }

  const disabled =
    busy || (mode === "correct" && !!odometerError) || (mode === "handle" && !handlingNote.trim());

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ADMIN</div>
          <h1>
            Finished Trips<span className="title-dot">.</span>
          </h1>
          <p>Driver-submitted trips. Review, correct, handle problems, then mark each as done.</p>
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
            <CheckCircle2 size={20} />
            <h2>Submitted trips</h2>
            <span className="count">{visible.length}</span>
          </div>
        </div>
        <div className="admin-trip-filters">
          <label className="field">
            <span>Date</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Driver</span>
            <Select value={driver} onValueChange={setDriver}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Drivers</SelectItem>
                {drivers.map((name) => (
                  <SelectItem value={name} key={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="field">
            <span>Vehicle</span>
            <Select value={vehicle} onValueChange={setVehicle}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Vehicles</SelectItem>
                {vehicles.map((plate) => (
                  <SelectItem value={plate} key={plate}>
                    {plate}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="field">
            <span>Status</span>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="SUBMITTED">{completionLabel.SUBMITTED}</SelectItem>
                <SelectItem value="DONE">{completionLabel.DONE}</SelectItem>
                <SelectItem value="UNSUBMITTED">{notSubmitted}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="field">
            <span>Problems</span>
            <Select value={problems} onValueChange={setProblems}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="open">Has open problem</SelectItem>
                <SelectItem value="none">No open problem</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
        {visible.length ? (
          <div className="schedule-table admin-trip-table">
            <table>
              <thead>
                <tr>
                  {["DATE", "PLATE NUMBER", "DRIVER", "ROUTE", "DISTANCE", "STATUS", ""].map((title, i) => (
                    <th key={i}>{title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((trip) => (
                  <tr key={trip.schedule.id} onClick={() => { setSelectedId(trip.schedule.id); setNotice(""); }}>
                    <td>{dateLabel(trip.schedule.date)}</td>
                    <td>{trip.revision.plate}</td>
                    <td>{trip.revision.driverName}</td>
                    <td>{trip.revision.legs.map((leg) => leg.destinationName).join(" → ")}</td>
                    <td>{trip.completion ? `${trip.completion.distance} km` : "—"}</td>
                    <td>
                      <span className={"badge " + (trip.completion?.status === "DONE" ? "complete" : "")}>
                        {trip.completion ? completionLabel[trip.completion.status] : notSubmitted}
                      </span>
                      {hasOpenProblem(trip) && <small>Open problem</small>}
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
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="empty-icon">
              <CheckCircle2 size={30} />
            </div>
            <h3>{trips.length ? "No matching finished trips" : "No finished trips yet"}</h3>
            <p>{trips.length ? "Try another filter." : "When a Driver submits a completed trip, it will appear here for you to review."}</p>
          </div>
        )}
      </section>

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {mode === "correct"
                ? "Correct odometers"
                : mode === "done"
                  ? "Mark as done"
                  : mode === "handle"
                    ? "Mark problem as handled"
                    : "Finished trip"}
            </DialogTitle>
            <DialogDescription className="dialog-context">
              {selected && `${dateLabel(selected.schedule.date)} — ${selected.revision.plate} — ${selected.revision.driverName}`}
            </DialogDescription>
          </DialogHeader>
          {selected && mode === "view" && (
            <>
              <TripRecordView legs={selected.revision.legs} stopsById={stopsById} />
              {selected.completion ? (
                <>
                  <p className="helper">
                    Odometer: {selected.completion.startOdometer} → {selected.completion.endOdometer} ({selected.completion.distance} km) ·{" "}
                    {completionLabel[selected.completion.status]}
                  </p>
                  <p className="helper">{completionMeaning[selected.completion.status]}</p>
                </>
              ) : (
                <p className="helper">
                  The Driver reported a problem but hasn&apos;t submitted this trip yet. You can handle the problem now; the
                  odometers can be reviewed once it&apos;s submitted.
                </p>
              )}
              {selected.problems.map((item) => (
                <div className="helper" key={item.id}>
                  <strong>{item.status === "OPEN" ? "Open problem" : "Handled problem"}:</strong> {item.note}
                  {item.status === "HANDLED" && <div>Handled: {item.handlingNote}</div>}
                  {item.status === "OPEN" && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setProblemId(item.id);
                        setMode("handle");
                      }}
                    >
                      Mark handled
                    </Button>
                  )}
                </div>
              ))}
              {isDone && <p className="helper">This trip is done and locked.</p>}
              {selected.completion && (
                <DialogFooter>
                  <Button variant="outline" onClick={() => window.print()}>
                    Print
                  </Button>
                  <Button
                    variant="outline"
                    disabled={isDone}
                    onClick={() => {
                      setStart(String(selected.completion!.startOdometer));
                      setEnd(String(selected.completion!.endOdometer));
                      setMode("correct");
                    }}
                  >
                    Correct odometers
                  </Button>
                  <Button className="primary" disabled={isDone} onClick={() => setMode("done")}>
                    Mark as done
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
          {selected && mode === "correct" && (
            <>
              <label className="field">
                <span>Starting odometer (km) *</span>
                <Input inputMode="numeric" value={start} onChange={(event) => setStart(event.target.value)} />
              </label>
              <label className="field">
                <span>Ending odometer (km) *</span>
                <Input inputMode="numeric" value={end} onChange={(event) => setEnd(event.target.value)} />
              </label>
              {odometerError && <p className="helper">{odometerError}</p>}
            </>
          )}
          {selected && mode === "done" && (
            <p className="helper">
              Marking this trip as done locks it for everyone. Odometers can&apos;t be corrected afterwards.
            </p>
          )}
          {selected && mode === "handle" && (
            <>
              <label className="field">
                <span>How was it handled? *</span>
                <Textarea value={handlingNote} maxLength={500} onChange={(event) => setHandlingNote(event.target.value)} />
              </label>
              <label className="field">
                <span>Follow-up schedule (optional)</span>
                <Select value={followUp} onValueChange={setFollowUp}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {followUps.map((item) => {
                      const revision = item.revisions.find((rev) => rev.id === item.publishedRevisionId);
                      return (
                        <SelectItem value={item.id} key={item.id}>
                          {dateLabel(item.date)} — {revision?.plate}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </label>
            </>
          )}
          {error && (
            <p className="modal-error" role="alert">
              {error}
            </p>
          )}
          {selected && mode !== "view" && (
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={reset}>
                Back
              </Button>
              <Button className="primary" disabled={disabled} onClick={submit}>
                {busy ? "Working…" : mode === "correct" ? "Save correction" : mode === "done" ? "Mark as done" : "Mark handled"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      {selected?.completion && (
        <FinishedTripPrint trip={{ ...selected, completion: selected.completion }} stopsById={stopsById} requests={requests} />
      )}
    </>
  );
}
