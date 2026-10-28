"use client";
import { useAutoClear } from "@/lib/use-auto-clear";
import { useMemo, useState } from "react";
import { CheckCircle2, Download } from "lucide-react";
import { downloadCsv, toCsv } from "@/lib/csv";
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
  handleProblem,
  markCompletionDone,
  markCompletionsDone,
  setTripTime,
  type ProblemReport,
} from "@/lib/kova-api";
import { useKovaData } from "@/lib/use-kova-data";
import { scheduledBy } from "@/lib/scheduled-by";
import { buildAdminTrips, cleanTrips, hasOpenProblem } from "@/lib/finished-trips";
import { stopsFor } from "@/lib/trip-record";
import FinishedTripPrint from "./finished-trip-print";
import CompanyTripPrint from "./company-trip-print";
import FormFilter, { formMatches, type FormFilterValue } from "./form-filter";
import { runAsAttendance } from "@/lib/company-trips";
import { completionLabel, completionMeaning } from "@/lib/status-text";
import OlderRecordsNotice from "./older-records-notice";
import TripRecordView from "./trip-record-view";
import StopTimesTable from "./stop-times-table";
import { formTimeValue, legTimes, missingTimes, placeResolver, type FormTime } from "@/lib/stop-times";
import { missedLegs, stopReportLabel, stopReportStatus } from "@/lib/stop-reports";
import DateRangeFilter from "./date-range-filter";
import FilterFold from "./filter-fold";
import { SortableHead, SortSelect, type SortColumn } from "./sortable-head";
import { sortRows, type Sort } from "@/lib/table-sort";
import { anyDate, inDateFilter, type DateFilter } from "@/lib/date-range";
import { manilaToday } from "@/lib/timezone";
import { kmLabel, readingsLabel } from "@/lib/odometer";

const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

type Mode = "view" | "correct" | "done" | "handle" | "time";

const notSubmitted = "Not submitted yet";

type TripFilters = {
  dates: DateFilter;
  driver: string;
  vehicle: string;
  form: FormFilterValue;
  status: string;
  problems: string;
};
const noFilters: TripFilters = { dates: anyDate, driver: "all", vehicle: "all", form: "all", status: "all", problems: "all" };

type SortKey = "date" | "plate" | "driver" | "route" | "distance" | "status";
const columns: SortColumn<SortKey>[] = [
  { label: "DATE", key: "date" },
  { label: "PLATE NUMBER", key: "plate" },
  { label: "DRIVER", key: "driver" },
  { label: "ROUTE", key: "route" },
  { label: "DISTANCE", key: "distance" },
  { label: "STATUS", key: "status" },
  { label: "" },
];

/**
 * Admin Finished Trips: every submitted completion, plus unsubmitted trips
 * with a problem report (only handling applies to those), newest first. An Admin
 * can correct the odometers until the trip is marked Done, mark it Done
 * (which locks it), handle the Driver's problem reports and print the form.
 * Finance sees the same screen read-only (`readOnly`): view and print.
 * Postgres decides what is allowed; this only shapes the screen.
 */
// The Status and Problems filter values a link may start on.
export const finishedStatusFilters = ["SUBMITTED", "DONE", "UNSUBMITTED"];
export const finishedProblemFilters = ["open", "none"];

export default function AdminFinishedTrips({
  initialOpenId,
  initialStatus,
  initialProblems,
  readOnly = false,
}: {
  initialOpenId?: string;
  /** Finance: no corrections, Done or problem handling; Print stays. */
  readOnly?: boolean;
  /** One of `finishedStatusFilters`, e.g. from a Dashboard tile. */
  initialStatus?: string;
  /** One of `finishedProblemFilters`, e.g. from a Dashboard tile. */
  initialProblems?: string;
} = {}) {
  const { schedules, completions, problems: problemReports, requests, attendance, stopTaps, timeCorrections, accounts, options, companyRuns } =
    useKovaData();
  const trips = useMemo(() => buildAdminTrips(schedules, completions, problemReports), [schedules, completions, problemReports]);
  const [filters, setFilters] = useState<TripFilters>(() => ({
    ...noFilters,
    status: initialStatus ?? "all",
    problems: initialProblems ?? "all",
  }));
  /** The Download CSV dialog's own filters, starting from the screen's; null while it's closed. */
  const [exportFilters, setExportFilters] = useState<TripFilters | null>(null);
  const [sort, setSort] = useState<Sort<SortKey>>(null);
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
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkError, setBulkError] = useState("");
  /** The Time Out / Time In being filled in or changed, and its "HH:MM". */
  const [editTime, setEditTime] = useState<FormTime | null>(null);
  const [timeValue, setTimeValue] = useState("");
  useAutoClear(notice, setNotice);

  const nameOf = (id: string) => accounts.find((item) => item.id === id)?.name ?? "someone";
  /** Each leg's printed Time Out / Time In for a trip, from taps and Admin entries. */
  // A Company trip's Start/End trip are its requester's (0055), and it ends at its last stop.
  const timesFor = (trip: { schedule: { id: string; kind: string }; revision: { legs: Parameters<typeof legTimes>[0] } }) =>
    legTimes(
      trip.revision.legs,
      trip.schedule.kind === "COMPANY"
        ? runAsAttendance(companyRuns.find((item) => item.scheduleId === trip.schedule.id))
        : attendance.find((item) => item.scheduleId === trip.schedule.id),
      stopTaps.filter((item) => item.scheduleId === trip.schedule.id),
      timeCorrections.filter((item) => item.scheduleId === trip.schedule.id),
      placeResolver(options.destinations),
      trip.schedule.kind === "COMPANY",
    );

  const drivers = [...new Set(trips.map((trip) => trip.revision.driverName))].sort();
  const vehicles = [...new Set(trips.map((trip) => trip.revision.plate))].sort();
  const today = manilaToday();
  /** The trips a set of filters lets through, in the screen's sort order. */
  const filtered = (f: TripFilters) =>
    sortRows(
      trips.filter(
        (trip) =>
          inDateFilter(trip.schedule.date, f.dates, today) &&
          (f.driver === "all" || trip.revision.driverName === f.driver) &&
          (f.vehicle === "all" || trip.revision.plate === f.vehicle) &&
          formMatches(f.form, trip.schedule.kind) &&
          (f.status === "all" || f.status === (trip.completion?.status ?? "UNSUBMITTED")) &&
          (f.problems === "all" || (f.problems === "open" ? hasOpenProblem(trip) : !hasOpenProblem(trip))),
      ),
      sort,
      {
        date: (trip) => trip.schedule.date,
        plate: (trip) => trip.revision.plate,
        driver: (trip) => trip.revision.driverName,
        route: (trip) => trip.revision.legs.map((leg) => leg.destinationName).join(" → "),
        // Unsubmitted trips have no distance yet; they sort before any submitted one.
        distance: (trip) => trip.completion?.distance ?? -1,
        status: (trip) => (trip.completion ? completionLabel[trip.completion.status] : notSubmitted),
      },
    );
  const visible = filtered(filters);
  const exportRows = exportFilters ? filtered(exportFilters) : [];

  /** The filter fields, for the screen and for the Download CSV dialog. */
  const filterFields = (f: TripFilters, set: (next: TripFilters) => void) => (
    <>
      <DateRangeFilter value={f.dates} onChange={(dates) => set({ ...f, dates })} />
      <FormFilter value={f.form} onChange={(form) => set({ ...f, form })} />
      <label className="field">
        <span>Driver</span>
        <Select value={f.driver} onValueChange={(driver) => set({ ...f, driver })}>
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
        <Select value={f.vehicle} onValueChange={(vehicle) => set({ ...f, vehicle })}>
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
        <Select value={f.status} onValueChange={(status) => set({ ...f, status })}>
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
        <Select value={f.problems} onValueChange={(problems) => set({ ...f, problems })}>
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
    </>
  );

  // Empty Time Out / Time In cells; a stop reported missed (0061) needs none.
  const missingFor = (trip: Parameters<typeof timesFor>[0] & { problems: ProblemReport[] }) =>
    missingTimes(timesFor(trip), new Set(missedLegs(trip.problems).keys()));

  // "Mark all clean trips done" only ever touches what the filters show, and
  // skips trips still missing a Time Out or Time In (Done would refuse them).
  const clean = cleanTrips(visible).filter((trip) => missingFor(trip) === 0);

  const selected = trips.find((trip) => trip.schedule.id === selectedId);
  const selectedBy = selected ? scheduledBy(selected.revision, accounts) : null;
  const selectedTimes = selected ? timesFor(selected) : [];
  const selectedMissing = selected ? missingFor(selected) : 0;
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
    setEditTime(null);
    setTimeValue("");
    setError("");
  }

  function openTimeEditor(time: FormTime) {
    setEditTime(time);
    setTimeValue(formTimeValue(time) ?? "");
    setError("");
    setMode("time");
  }

  /** The dialog's trips, in the screen's order, with the form's first Time Out and last Time In. */
  function downloadTrips() {
    const projectsOf = (ids: string[]) =>
      [...new Set(requests.filter((item) => ids.includes(item.id)).map((item) => item.projectName).filter(Boolean))].join("; ");
    const rows = exportRows.map((trip) => {
      const times = timesFor(trip);
      const last = times.at(-1);
      const completion = trip.completion;
      return [
        trip.schedule.date,
        trip.schedule.kind === "COMPANY" ? "Company" : "Daily",
        trip.revision.plate,
        trip.revision.driverName,
        projectsOf(trip.revision.requestIds),
        trip.revision.legs.map((leg) => leg.destinationName).join(" → "),
        times[0] ? formTimeValue(times[0].out) : null,
        last ? formTimeValue(last.in) : null,
        completion?.startOdometer,
        completion?.endOdometer,
        completion?.distance,
        completion?.fullTank,
        completion?.fleetCardUsed,
        completion?.gasReceiptAttached,
        completion ? completionLabel[completion.status] : notSubmitted,
      ];
    });
    const header = [
      "DATE", "FORM", "VEHICLE", "DRIVER", "PROJECT / SITE", "STOPS", "TIME OUT", "TIME IN",
      "START ODOMETER", "END ODOMETER", "DISTANCE (KM)", "FULL TANK", "FLEET CARD USED", "GAS RECEIPT ATTACHED", "STATUS",
    ];
    downloadCsv(`kova-finished-trips-${today}.csv`, toCsv(header, rows));
    setExportFilters(null);
  }

  async function markCleanDone() {
    setBusy(true);
    setBulkError("");
    const { done, failed } = await markCompletionsDone(clean.map((trip) => trip.schedule.id));
    setBusy(false);
    if (failed.length) {
      setBulkError(
        `${done.length} marked done, ${failed.length} couldn't be: ${failed[0].message}${failed.length > 1 ? " (and others)" : ""}`,
      );
      return;
    }
    setBulkOpen(false);
    setNotice(`${done.length} ${done.length === 1 ? "trip" : "trips"} marked as done.`);
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
    if (mode === "time" && editTime) {
      return run(() => setTripTime(id, { ...editTime.cell, time: timeValue }), `${timeLabel(editTime)} saved for ${label}.`);
    }
    if (mode === "handle" && problemId) {
      return run(
        () => handleProblem(problemId, handlingNote.trim(), followUp === "none" ? undefined : followUp),
        `Problem on ${label} marked as handled.`,
      );
    }
  }

  const disabled =
    busy ||
    (mode === "correct" && !!odometerError) ||
    (mode === "handle" && !handlingNote.trim()) ||
    (mode === "time" && !/^\d{2}:\d{2}$/.test(timeValue));

  /** e.g. "Leg 2 Time Out (leaving Site Alpha)". */
  function timeLabel(time: FormTime) {
    const legNo = selectedTimes.find((item) => item.leg.id === time.cell.legId)?.leg.legNo;
    const what = { START: "Start trip", END: "End trip", ARRIVE: "arriving", LEAVE: "leaving" }[time.source.kind];
    const where = "place" in time.source ? ` ${time.source.place}` : "";
    return `Leg ${legNo} ${time.cell.field === "OUT" ? "Time Out" : "Time In"} (${what}${where})`;
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{readOnly ? "FINANCE" : "ADMIN"}</div>
          <h1>
            Finished Trips<span className="title-dot">.</span>
          </h1>
          <p>
            {readOnly
              ? "Driver-submitted trips with their odometers and times. Open one to print its form, fuel checks included."
              : "Driver-submitted trips. Review, correct, handle problems, then mark each as done."}
          </p>
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
          <div>
            <Button variant="outline" disabled={!trips.length} onClick={() => setExportFilters(filters)}>
              <Download size={16} /> Download CSV
            </Button>
            {!readOnly && (
              <Button
                className="primary"
                disabled={!clean.length}
                title="Submitted trips with no open problem and no missing time, among those shown below"
                onClick={() => {
                  setBulkError("");
                  setBulkOpen(true);
                }}
              >
                Mark {clean.length || "all"} clean {clean.length === 1 ? "trip" : "trips"} done
              </Button>
            )}
          </div>
        </div>
        <OlderRecordsNotice />
        <FilterFold
          active={
            (filters.dates.preset !== "any" ? 1 : 0) +
            [filters.driver, filters.vehicle, filters.form, filters.status, filters.problems].filter((value) => value !== "all").length +
            (sort ? 1 : 0)
          }
        >
          {filterFields(filters, setFilters)}
          <SortSelect columns={columns} sort={sort} onSort={setSort} />
        </FilterFold>
        {visible.length ? (
          <div className="schedule-table admin-trip-table">
            <table>
              <SortableHead columns={columns} sort={sort} onSort={setSort} />
              <tbody>
                {visible.map((trip) => (
                  <tr key={trip.schedule.id} onClick={() => { setSelectedId(trip.schedule.id); setNotice(""); }}>
                    <td>{dateLabel(trip.schedule.date)}</td>
                    <td>{trip.revision.plate}</td>
                    <td>{trip.revision.driverName}</td>
                    <td>{trip.revision.legs.map((leg) => leg.destinationName).join(" → ")}</td>
                    <td>{trip.completion ? kmLabel(trip.completion.distance) : "—"}</td>
                    <td>
                      <span className={"badge " + (trip.completion?.status === "DONE" ? "complete" : "")}>
                        {trip.completion ? completionLabel[trip.completion.status] : notSubmitted}
                      </span>
                      {hasOpenProblem(trip) && <small>Open problem</small>}
                      {trip.completion?.status === "SUBMITTED" && missingFor(trip) > 0 && (
                        <small>
                          {missingFor(trip)} {missingFor(trip) === 1 ? "time" : "times"} missing
                        </small>
                      )}
                    </td>
                    <td>
                      <Button
                        variant="outline" size="sm"
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

      <Dialog open={bulkOpen} onOpenChange={(open) => !busy && setBulkOpen(open)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Mark {clean.length} {clean.length === 1 ? "trip" : "trips"} as done?
            </DialogTitle>
            <DialogDescription>
              These trips are submitted, have no open problem and have every Time Out and Time In. Marking them done locks
              them for everyone, and odometers and times can&apos;t be corrected afterwards. Check the distances first.
            </DialogDescription>
          </DialogHeader>
          <div className="schedule-table">
            <table>
              <thead>
                <tr>
                  {["DATE", "PLATE NUMBER", "DRIVER", "DISTANCE"].map((title) => (
                    <th key={title}>{title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clean.map((trip) => (
                  <tr key={trip.schedule.id}>
                    <td>{dateLabel(trip.schedule.date)}</td>
                    <td>{trip.revision.plate}</td>
                    <td>{trip.revision.driverName}</td>
                    <td>{trip.completion ? kmLabel(trip.completion.distance) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bulkError && (
            <p className="modal-error" role="alert">
              {bulkError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setBulkOpen(false)}>
              Go back
            </Button>
            <Button className="primary" disabled={busy || !clean.length} onClick={() => void markCleanDone()}>
              {busy ? "Working…" : `Mark ${clean.length} done`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!exportFilters} onOpenChange={(open) => { if (!open) setExportFilters(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Download Finished Trips</DialogTitle>
            <DialogDescription>Starts from what the screen shows. Choose which trips to save, then download.</DialogDescription>
          </DialogHeader>
          {exportFilters && <div className="modal-fields">{filterFields(exportFilters, setExportFilters)}</div>}
          <DialogFooter>
            <span className="helper" role="status">
              {exportRows.length} {exportRows.length === 1 ? "trip" : "trips"}
            </span>
            <Button variant="outline" onClick={() => setExportFilters(null)}>
              Cancel
            </Button>
            <Button className="primary" disabled={!exportRows.length} onClick={downloadTrips}>
              <Download size={16} /> Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                    : mode === "time"
                      ? "Time Out / Time In"
                      : "Finished trip"}
            </DialogTitle>
            <DialogDescription className="dialog-context">
              {selected && `${dateLabel(selected.schedule.date)} — ${selected.revision.plate} — ${selected.revision.driverName}`}
              {selectedBy && ` — ${selectedBy.label} ${selectedBy.name}`}
            </DialogDescription>
          </DialogHeader>
          {selected && mode === "view" && (
            <>
              <TripRecordView legs={selected.revision.legs} stopsById={stopsById} />
              {selected.completion ? (
                <>
                  <p className="helper">
                    Odometer: {readingsLabel(selected.completion)} ·{" "}
                    {completionLabel[selected.completion.status]}
                  </p>
                  <p className="helper">{completionMeaning[selected.completion.status]}</p>
                  <h3 className="stop-times-heading">Actual times</h3>
                  <StopTimesTable
                    times={selectedTimes}
                    driverId={selected.revision.driverId}
                    nameOf={nameOf}
                    onEdit={isDone || readOnly ? undefined : openTimeEditor}
                  />
                  {!isDone && !readOnly && selectedMissing > 0 && (
                    <p className="helper" role="status">
                      {selectedMissing} {selectedMissing === 1 ? "time is" : "times are"} missing. Fill them in from the
                      Driver&apos;s logbook or a call before marking this trip done; they print on the form.
                    </p>
                  )}
                </>
              ) : (
                <p className="helper">
                  {readOnly
                    ? "The Driver reported a problem but hasn't submitted this trip yet; its odometers show once it's submitted."
                    : selected.problems.some((item) => !item.legId && item.status === "OPEN")
                      ? "The Driver reported a problem but hasn't submitted this trip yet. You can handle the problem now; the odometers can be reviewed once it's submitted."
                      : "The Driver reported a problem at a stop but hasn't submitted this trip yet. Stop reports are answered on Scheduling; the odometers can be reviewed once it's submitted."}
                </p>
              )}
              {selected.problems.map((item) => (
                <div className="helper" key={item.id}>
                  <strong>
                    {item.status === "OPEN" ? "Open" : "Handled"} {item.legId ? "stop report" : "problem"}:
                  </strong>{" "}
                  {item.legId &&
                    `${stopReportLabel(item)} at ${selected.revision.legs.find((leg) => leg.id === item.legId)?.destinationName ?? "a stop"}${item.note ? ": " : ""}`}
                  {item.note}
                  {item.status === "HANDLED" && <div>Handled: {item.handlingNote}</div>}
                  {/* A stop report closes with its answer on Scheduling, never here (0083). */}
                  {item.status === "OPEN" && item.legId && <div>{stopReportStatus(item)}</div>}
                  {item.status === "OPEN" && !item.legId && !readOnly && (
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
                  {!readOnly && (
                    <>
                      {/* A trip without readings (0078) has none to correct. */}
                      {selected.completion.startOdometer !== null && (
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
                      )}
                      <Button
                        className="primary"
                        disabled={isDone || selectedMissing > 0}
                        title={selectedMissing > 0 ? "Fill in every Time Out and Time In first" : undefined}
                        onClick={() => setMode("done")}
                      >
                        Mark as done
                      </Button>
                    </>
                  )}
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
              Marking this trip as done locks it for everyone. Odometers and times can&apos;t be corrected afterwards.
            </p>
          )}
          {selected && mode === "time" && editTime && (
            <>
              <p className="helper">
                {timeLabel(editTime)}.{" "}
                {editTime.tap
                  ? "The Driver's tap stays on record; your time prints on the form instead."
                  : "The Driver didn't tap this one. Enter the time it happened; it prints on the form."}
              </p>
              <label className="field">
                <span>Time *</span>
                <Input type="time" value={timeValue} onChange={(event) => setTimeValue(event.target.value)} />
              </label>
              {editTime.correction && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => setTripTime(selected.schedule.id, { ...editTime.cell, time: null }),
                      `${timeLabel(editTime)} cleared for ${dateLabel(selected.schedule.date)}.`,
                    )
                  }
                >
                  {editTime.tap ? "Use the Driver's tap instead" : "Clear this time"}
                </Button>
              )}
            </>
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
                {busy
                  ? "Working…"
                  : mode === "correct"
                    ? "Save correction"
                    : mode === "done"
                      ? "Mark as done"
                      : mode === "time"
                        ? "Save time"
                        : "Mark handled"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      {selected?.completion && selected.schedule.kind === "COMPANY" && (
        <CompanyTripPrint trip={{ ...selected, completion: selected.completion }} requests={requests} times={selectedTimes} />
      )}
      {selected?.completion && selected.schedule.kind !== "COMPANY" && (
        <FinishedTripPrint
          trip={{ ...selected, completion: selected.completion }}
          stopsById={stopsById}
          requests={requests}
          times={selectedTimes}
        />
      )}
    </>
  );
}
