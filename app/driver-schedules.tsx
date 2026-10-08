"use client";
import { useAutoClear } from "@/lib/use-auto-clear";
import { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { anyDate, inDateFilter, presetRange, type DateFilter } from "@/lib/date-range";
import { sortRows, type Sort } from "@/lib/table-sort";
import DateRangeFilter from "./date-range-filter";
import FilterFold from "./filter-fold";
import { SortableHead, SortSelect, type SortColumn } from "./sortable-head";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  recordAttendance,
  reportProblem,
  submitCompletion,
  type ProblemReport,
  type Schedule,
  type ScheduleRevision,
  type TripAttendance,
  type TripCompletion,
} from "@/lib/kova-api";
import { useKovaData } from "@/lib/use-kova-data";
import { stopsFor } from "@/lib/trip-record";
import { hasTripEnded, manilaToday } from "@/lib/timezone";
import { lastEndReading, longTripWarning } from "@/lib/odometer";
import { completionLabel } from "@/lib/status-text";
import { coordinatesLabel, tapPlaceLabel, tapTimeLabel } from "@/lib/attendance";
import { getPhoneLocation } from "@/lib/phone-location";
import TripRecordView from "./trip-record-view";

const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

type Trip = {
  schedule: Schedule;
  revision: ScheduleRevision;
  completion?: TripCompletion;
  /** The Start/End taps, once the Driver has started. */
  attendance?: TripAttendance;
  problems: ProblemReport[];
  ended: boolean;
  /** The trip's date has come, so Start trip is open. */
  startable: boolean;
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

function buildTrips(
  schedules: Schedule[],
  completions: TripCompletion[],
  attendance: TripAttendance[],
  problems: ProblemReport[],
  driverId: string | null,
): Trip[] {
  const today = manilaToday();
  return schedules
    .flatMap((schedule) => {
      if (schedule.status !== "ACTIVE") return [];
      const revision = schedule.revisions.find((item) => item.id === schedule.publishedRevisionId);
      // null driverId means Admin viewing as Driver: show every vehicle's
      // trips, since Admin has no driver_id of their own to filter by.
      if (!revision || (driverId !== null && revision.driverId !== driverId)) return [];
      const completion = completions.find((item) => item.scheduleId === schedule.id);
      // Once an Admin marks it Done the trip lives on Finished Trips only.
      if (completion?.status === "DONE") return [];
      const lastIn = revision.legs[revision.legs.length - 1]?.plannedTimeIn ?? "";
      return [
        {
          schedule,
          revision,
          completion,
          attendance: attendance.find((item) => item.scheduleId === schedule.id),
          problems: problems.filter((item) => item.scheduleId === schedule.id),
          ended: hasTripEnded(schedule.date, lastIn),
          startable: schedule.date <= today,
          availableAt: availableAtLabel(schedule.date, lastIn),
        },
      ];
    })
    // Trips still to complete first, then those waiting for review, each by date.
    .sort((a, b) => Number(!!a.completion) - Number(!!b.completion) || a.schedule.date.localeCompare(b.schedule.date));
}

/** Where a trip stands for its Driver, in the order a trip moves through them. */
const tripStatuses = ["UPCOMING", "READY_TO_START", "ON_THE_ROAD", "BACK_AT_BASE", "READY_TO_COMPLETE", "SUBMITTED"] as const;
type TripStatus = (typeof tripStatuses)[number];

const tripStatusPill: Record<TripStatus, [label: string, pill: string]> = {
  UPCOMING: ["Upcoming", "info"],
  READY_TO_START: ["Ready to start", "pending"],
  ON_THE_ROAD: ["On the road", "info"],
  BACK_AT_BASE: ["Back at base", "info"],
  READY_TO_COMPLETE: ["Ready to complete", "pending"],
  SUBMITTED: [completionLabel.SUBMITTED, "scheduled"],
};

function tripStatus(trip: Trip): TripStatus {
  if (trip.completion) return "SUBMITTED";
  if (trip.attendance?.end) return trip.ended ? "READY_TO_COMPLETE" : "BACK_AT_BASE";
  if (trip.attendance) return "ON_THE_ROAD";
  return trip.startable ? "READY_TO_START" : "UPCOMING";
}

const routeLabel = (trip: Trip) => trip.revision.legs.map((leg) => leg.destinationName).join(" → ");

type TripSortKey = "date" | "driver" | "vehicle" | "route" | "status";

/**
 * The Driver's published schedules. Each opens a read-only Trip Record with
 * Start trip and End trip (tapped at ANONANG; their attendance), then
 * Complete trip (one odometer pair, once the trip has ended) and Report a
 * problem. The database enforces who and when; this only shapes the screen.
 */
export default function DriverSchedules({ driverId, initialOpenId }: { driverId: string | null; initialOpenId?: string }) {
  const { schedules, completions, attendance, problems, requests, vehicles } = useKovaData();
  const trips = useMemo(
    () => buildTrips(schedules, completions, attendance, problems, driverId),
    [schedules, completions, attendance, problems, driverId],
  );
  const vehicleName = (plate: string) => vehicles.find((item) => item.plate === plate)?.name ?? plate;
  const [selectedId, setSelectedId] = useState<string | null>(() => initialOpenId ?? null);
  const [dates, setDates] = useState<DateFilter>(anyDate);
  const [vehicle, setVehicle] = useState("all");
  const [driver, setDriver] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<Sort<TripSortKey>>(null);
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

  const lastReading = selected ? lastEndReading(selected.revision.plate, schedules, completions) : null;
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

  // Start trip / End trip: one fresh position from the phone, then the tap.
  // A phone that won't share its position still records the time.
  async function tap(kind: "START" | "END") {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const location = await getPhoneLocation();
      await recordAttendance(selected.schedule.id, { kind, location });
      setNotice(
        `${kind === "START" ? "Trip started" : "Trip ended"}${location ? "" : " without your location. Allow location for this site next time"}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    }
    setBusy(false);
  }

  const today = manilaToday();
  const drivers = [...new Set(trips.map((trip) => trip.revision.driverName))].sort();
  const plates = [...new Set(trips.map((trip) => trip.revision.plate))].sort();
  const showDriver = driverId === null;
  const columns: SortColumn<TripSortKey>[] = [
    { label: "DATE", key: "date" },
    ...(showDriver ? [{ label: "DRIVER", key: "driver" as const }] : []),
    { label: "VEHICLE", key: "vehicle" },
    { label: "ROUTE", key: "route" },
    { label: "STATUS", key: "status" },
    { label: "" },
  ];
  const visible = sortRows(
    trips.filter(
      (trip) =>
        inDateFilter(trip.schedule.date, dates, today) &&
        (vehicle === "all" || trip.revision.plate === vehicle) &&
        (driver === "all" || trip.revision.driverName === driver) &&
        (status === "all" || tripStatus(trip) === status),
    ),
    sort,
    {
      date: (trip) => trip.schedule.date,
      driver: (trip) => trip.revision.driverName,
      vehicle: (trip) => trip.revision.plate,
      route: (trip) => routeLabel(trip),
      status: (trip) => tripStatuses.indexOf(tripStatus(trip)),
    },
  );

  const tripTable = (list: Trip[]) => (
    <div className="schedule-table admin-trip-table">
      <table>
        <SortableHead columns={columns} sort={sort} onSort={setSort} />
        <tbody>
          {list.map((trip) => {
            const [label, pill] = tripStatusPill[tripStatus(trip)];
            return (
              <tr key={trip.schedule.id} onClick={() => { setSelectedId(trip.schedule.id); setNotice(""); }}>
                <td>{dateLabel(trip.schedule.date)}</td>
                {showDriver && <td>{trip.revision.driverName}</td>}
                <td className="trip-vehicle">{vehicleName(trip.revision.plate)} · {trip.revision.plate}</td>
                <td>{routeLabel(trip)}</td>
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
  );

  // A Driver's own trips, by when they are; anything outside this month
  // (an unfinished trip from before, or one booked further ahead) is under
  // Other trips, so nothing is hidden.
  const week = presetRange("this-week", today);
  const month = presetRange("this-month", today);
  const inRange = (date: string, range: { from: string; to: string }) => date >= range.from && date <= range.to;
  const sections = [
    { title: "Today", list: visible.filter((trip) => trip.schedule.date === today) },
    { title: "This week", list: visible.filter((trip) => trip.schedule.date !== today && inRange(trip.schedule.date, week)) },
    {
      title: "This month",
      list: visible.filter((trip) => !inRange(trip.schedule.date, week) && inRange(trip.schedule.date, month)),
    },
    {
      title: "Other trips",
      list: visible.filter((trip) => !inRange(trip.schedule.date, week) && !inRange(trip.schedule.date, month)),
    },
  ];

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">DRIVER</div>
          <h1>
            My Schedule<span className="title-dot">.</span>
          </h1>
          <p>Approved trips assigned to you. Tap Start trip at ANONANG before you leave and End trip when you&apos;re back, then complete it.</p>
        </div>
      </div>
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      {/* A Driver with trips gets one card per group, so the groups stand apart. */}
      {!showDriver && trips.length > 0 ? (
        <div className="trip-sections">
          {sections.map(
            ({ title, list }, index) =>
              (list.length > 0 || title === "Today") && (
                <section className="schedule-panel" key={title}>
                  <div className="panel-toolbar">
                    <div>
                      <CalendarDays size={20} />
                      <h2>{title}</h2>
                      <span className="count">{list.length}</span>
                    </div>
                  </div>
                  {index === 0 && (
                    <div className="admin-trip-filters sort-only">
                      <SortSelect columns={columns} sort={sort} onSort={setSort} />
                    </div>
                  )}
                  {list.length ? tripTable(list) : <p className="helper trip-sections-empty">No trips today.</p>}
                </section>
              ),
          )}
        </div>
      ) : (
      <section className="schedule-panel">
        <div className="panel-toolbar">
          <div>
            <CalendarDays size={20} />
            <h2>Your trips</h2>
            <span className="count">{showDriver ? visible.length : trips.length}</span>
          </div>
        </div>
        {showDriver && trips.length > 0 && (
          <FilterFold active={(dates.preset !== "any" ? 1 : 0) + [driver, vehicle, status].filter((value) => value !== "all").length + (sort ? 1 : 0)}>
            <DateRangeFilter value={dates} onChange={setDates} />
            {showDriver && (
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
            )}
            <label className="field">
              <span>Vehicle</span>
              <Select value={vehicle} onValueChange={setVehicle}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Vehicles</SelectItem>
                  {plates.map((plate) => (
                    <SelectItem value={plate} key={plate}>
                      {vehicleName(plate)} · {plate}
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
                  {tripStatuses.map((value) => (
                    <SelectItem value={value} key={value}>
                      {tripStatusPill[value][0]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <SortSelect columns={columns} sort={sort} onSort={setSort} />
          </FilterFold>
        )}
        {showDriver ? (
          visible.length ? (
            tripTable(visible)
          ) : (
            <div className="empty">
              <div className="empty-icon">
                <CalendarDays size={30} />
              </div>
              <h3>{trips.length ? "No matching trips" : "No trips yet"}</h3>
              <p>{trips.length ? "Try another filter." : "Approved schedules appear here."}</p>
            </div>
          )
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
      )}

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {mode === "complete" ? "Complete this trip" : mode === "problem" ? "Report a problem" : "Trip Record"}
            </DialogTitle>
            <DialogDescription className="dialog-context">
              {selected && `${dateLabel(selected.schedule.date)} — ${selected.revision.plate}`}
            </DialogDescription>
          </DialogHeader>
          {selected && mode === "view" && (
            <>
              <TripRecordView legs={selected.revision.legs} stopsById={stopsById} />
              {selected.attendance && (
                <p className="helper tap-lines">
                  {(
                    [
                      ["Started", selected.attendance.start],
                      ["Ended", selected.attendance.end],
                    ] as const
                  ).map(
                    ([label, tap]) =>
                      tap && (
                        <span key={label}>
                          {label} {tapTimeLabel(tap.at)}, {tapPlaceLabel(tap)}.
                          {tap.location && <small>{coordinatesLabel(tap.location)}</small>}
                        </span>
                      ),
                  )}
                </p>
              )}
              {!selected.completion && !selected.attendance && (
                <p className="helper">
                  {selected.startable
                    ? "Tap Start trip at ANONANG before you leave. Your phone will ask to share your location; this is your attendance for the day."
                    : `Start trip opens on ${dateLabel(selected.schedule.date)}.`}
                </p>
              )}
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
              {busy && (
                <p className="helper" role="status">
                  Finding your location. This can take up to 10 seconds; stay where you are.
                </p>
              )}
              {!selected.completion && selected.attendance?.end && !selected.ended && (
                <p className="helper">Complete trip is available after {selected.availableAt}.</p>
              )}
              <DialogFooter>
                <Button variant="outline" disabled={busy} onClick={() => setMode("problem")}>
                  Report a problem
                </Button>
                {!selected.completion && !selected.attendance && (
                  <Button className="primary" disabled={busy || !selected.startable} onClick={() => tap("START")}>
                    {busy ? "Getting location…" : "Start trip"}
                  </Button>
                )}
                {!selected.completion && selected.attendance && !selected.attendance.end && (
                  <Button className="primary" disabled={busy} onClick={() => tap("END")}>
                    {busy ? "Getting location…" : "End trip"}
                  </Button>
                )}
                {!selected.completion && selected.attendance?.end && (
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
              <span className="planner-step">Step 1 of 2</span>
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
              <span className="planner-step">Step 2 of 2</span>
              <div className="field">
                <span>Final return</span>
                <div className="final-return-checks">
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
