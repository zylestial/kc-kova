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
import FormFilter, { formMatches, type FormFilterValue } from "./form-filter";
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
  recordStopTap,
  reportProblem,
  reportStop,
  submitCompletion,
  type StopReportKind,
  type ProblemReport,
  type ScheduleLeg,
  type Schedule,
  type ScheduleRevision,
  type CompanyTripRun,
  type StopTap,
  type TripAttendance,
  type TripCompletion,
} from "@/lib/kova-api";
import { useKovaData } from "@/lib/use-kova-data";
import { routeChangedAt, stopsFor } from "@/lib/trip-record";
import { manilaToday } from "@/lib/timezone";
import { lastEndReading, longTripWarning, readingsLabel } from "@/lib/odometer";
import { completionLabel } from "@/lib/status-text";
import { getPhoneLocation } from "@/lib/phone-location";
import { hhmmLabel, legTimes, manilaHhmm, tripSteps, type TimeSource } from "@/lib/stop-times";
import DriverTripSteps, { stepKey } from "./driver-trip-steps";
import SavedTapsBanner from "./saved-taps-banner";
import StopReportForm from "./stop-report-form";
import { answerText, holdText, latestAnswer, missedLegs, stopChoices, stopReportLabel } from "@/lib/stop-reports";

const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

type Trip = {
  schedule: Schedule;
  revision: ScheduleRevision;
  completion?: TripCompletion;
  /** The Start/End taps, once the Driver has started. */
  attendance?: TripAttendance;
  /** Arrived/Leaving taps at the stops in between. */
  stopTaps: StopTap[];
  /** A Company trip's Start/End trip, tapped by its requester (0055). */
  run?: CompanyTripRun;
  problems: ProblemReport[];
  /** The trip's date has come, so Start trip is open. */
  startable: boolean;
};

function buildTrips(
  schedules: Schedule[],
  completions: TripCompletion[],
  attendance: TripAttendance[],
  stopTaps: StopTap[],
  problems: ProblemReport[],
  driverId: string | null,
  companyRuns: CompanyTripRun[],
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
      return [
        {
          schedule,
          revision,
          completion,
          attendance: attendance.find((item) => item.scheduleId === schedule.id),
          stopTaps: stopTaps.filter((item) => item.scheduleId === schedule.id),
          run: companyRuns.find((item) => item.scheduleId === schedule.id),
          problems: problems.filter((item) => item.scheduleId === schedule.id),
          startable: schedule.date <= today,
        },
      ];
    })
    // Trips still to complete first, then those waiting for review, each by date.
    .sort((a, b) => Number(!!a.completion) - Number(!!b.completion) || a.schedule.date.localeCompare(b.schedule.date));
}

/** Where a trip stands for its Driver, in the order a trip moves through them. */
const tripStatuses = ["UPCOMING", "READY_TO_START", "ON_THE_ROAD", "READY_TO_COMPLETE", "SUBMITTED"] as const;
type TripStatus = (typeof tripStatuses)[number];

const tripStatusPill: Record<TripStatus, [label: string, pill: string]> = {
  UPCOMING: ["Upcoming", "info"],
  READY_TO_START: ["Ready to start", "pending"],
  ON_THE_ROAD: ["On the road", "info"],
  READY_TO_COMPLETE: ["Ready to complete", "pending"],
  SUBMITTED: [completionLabel.SUBMITTED, "scheduled"],
};

function tripStatus(trip: Trip): TripStatus {
  if (trip.completion) return "SUBMITTED";
  // End trip at ANONANG is the proof it ended; Complete trip opens then (0047).
  if (trip.attendance?.end) return "READY_TO_COMPLETE";
  if (trip.attendance || trip.run) return "ON_THE_ROAD";
  return trip.startable ? "READY_TO_START" : "UPCOMING";
}

const routeLabel = (trip: Trip) => trip.revision.legs.map((leg) => leg.destinationName).join(" → ");
/** When the Scheduler changed the route since the trip started (0060). */
const changedAt = (trip: Trip) => routeChangedAt(trip.revision, trip.attendance?.start.at ?? trip.run?.startAt);

type TripSortKey = "date" | "driver" | "vehicle" | "route" | "status";

/**
 * The Driver's published schedules. Each opens a read-only Trip Record with
 * Start trip and End trip (tapped at ANONANG; their attendance), then
 * Complete trip (one odometer pair, once End trip is tapped) and Report a
 * problem. The database enforces who and when; this only shapes the screen.
 */
export default function DriverSchedules({ driverId, initialOpenId }: { driverId: string | null; initialOpenId?: string }) {
  const { schedules, completions, attendance, stopTaps, problems, requests, vehicles, companyRuns } = useKovaData();
  const trips = useMemo(
    () => buildTrips(schedules, completions, attendance, stopTaps, problems, driverId, companyRuns),
    [schedules, completions, attendance, stopTaps, problems, driverId, companyRuns],
  );
  const vehicleName = (plate: string) => vehicles.find((item) => item.plate === plate)?.name ?? plate;
  const [selectedId, setSelectedId] = useState<string | null>(() => initialOpenId ?? null);
  const [dates, setDates] = useState<DateFilter>(anyDate);
  const [vehicle, setVehicle] = useState("all");
  const [driver, setDriver] = useState("all");
  const [status, setStatus] = useState("all");
  const [form, setForm] = useState<FormFilterValue>("all");
  const [sort, setSort] = useState<Sort<TripSortKey>>(null);
  const [mode, setMode] = useState<"view" | "complete" | "problem" | "stop">("view");
  /** The stop being reported (0061). */
  const [reportAt, setReportAt] = useState<{ legId: string; place: string } | null>(null);
  const [completeStep, setCompleteStep] = useState<"odometer" | "final">("odometer");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [fullTank, setFullTank] = useState(false);
  const [fleetCardUsed, setFleetCardUsed] = useState(false);
  const [gasReceiptAttached, setGasReceiptAttached] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  /** The step being saved (stepKey), so its button says so. */
  const [busyStop, setBusyStop] = useState<string | null>(null);
  /** The last tap had no position: the phone's location is off or blocked. */
  const [locationOff, setLocationOff] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useAutoClear(notice, setNotice);

  const selected = trips.find((trip) => trip.schedule.id === selectedId);
  const requesterNames = (trip: Trip) =>
    [...new Set(requests.filter((request) => trip.revision.requestIds.includes(request.id)).map((request) => request.ownerName))].join(", ") ||
    "the requester";
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
    setLocationOff(false);
    setReportAt(null);
  }

  // A problem at one stop (0061), with the phone's position when it shares one.
  async function sendStopReport(report: { kind: StopReportKind; note: string; requestIds?: string[] }) {
    if (!selected || !reportAt) return;
    setBusy(true);
    setError("");
    try {
      const location = await getPhoneLocation();
      await reportStop(selected.schedule.id, { legId: reportAt.legId, ...report, location });
      setNotice("Reported. The Scheduler has been told; wait for their answer.");
      setMode("view");
      setReportAt(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    }
    setBusy(false);
  }

  const lastReading = selected ? lastEndReading(selected.revision.plate, schedules, completions) : null;
  // A vehicle without an odometer (0078) skips the readings: Complete trip is just the final return.
  const hasOdometer = !selected || vehicles.find((vehicle) => vehicle.plate === selected.revision.plate)?.hasOdometer !== false;
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
        await submitCompletion(selected.schedule.id, hasOdometer ? startNumber : null, hasOdometer ? endNumber : null, {
          fullTank,
          fleetCardUsed,
          gasReceiptAttached,
        });
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

  // One step of the trip: a fresh position from the phone, then the tap
  // (Start/End trip, or Arrived/Leaving at a stop). A phone that won't share
  // its position still records the time; the Driver is asked to turn it on.
  // With no signal the tap is saved on the phone with this moment's time (0077).
  async function tapStep(source: TimeSource) {
    if (!selected) return;
    const tappedAt = new Date().toISOString();
    setBusy(true);
    setBusyStop(stepKey(source));
    setError("");
    try {
      const location = await getPhoneLocation();
      if (!("legId" in source)) {
        await recordAttendance(selected.schedule.id, { kind: source.kind, location }, tappedAt);
      } else {
        await recordStopTap(selected.schedule.id, { legId: source.legId, kind: source.kind, location }, tappedAt);
      }
      setLocationOff(!location);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    }
    setBusyStop(null);
    setBusy(false);
  }

  const today = manilaToday();
  const drivers = [...new Set(trips.map((trip) => trip.revision.driverName))].sort();
  const plates = [...new Set(trips.map((trip) => trip.revision.plate))].sort();
  const showDriver = driverId === null;
  // A Company car Driver with both kinds of trip gets the Form filter too.
  const bothForms = trips.some((trip) => trip.schedule.kind === "COMPANY") && trips.some((trip) => trip.schedule.kind === "DAILY");
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
        (status === "all" || tripStatus(trip) === status) &&
        formMatches(form, trip.schedule.kind),
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
  // Sort by only helps once some group has two trips to put in order.
  const sortable = sections.some(({ list }) => list.length > 1);

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
      <SavedTapsBanner />
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
                  {index === 0 &&
                    (bothForms ? (
                      <div className="admin-trip-filters">
                        <FormFilter value={form} onChange={setForm} />
                        {sortable && (
                          <div className="sort-only">
                            <SortSelect columns={columns} sort={sort} onSort={setSort} />
                          </div>
                        )}
                      </div>
                    ) : (
                      sortable && (
                        <div className="admin-trip-filters sort-only">
                          <SortSelect columns={columns} sort={sort} onSort={setSort} />
                        </div>
                      )
                    ))}
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
            <span className="count">{visible.length}</span>
          </div>
        </div>
        {showDriver && trips.length > 0 && (
          <FilterFold active={(dates.preset !== "any" ? 1 : 0) + [driver, vehicle, status, form].filter((value) => value !== "all").length + (sort ? 1 : 0)}>
            <DateRangeFilter value={dates} onChange={setDates} />
            <FormFilter value={form} onChange={setForm} />
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
              {mode === "complete" ? "Complete this trip" : mode === "problem" || mode === "stop" ? "Report a problem" : "Your trip"}
            </DialogTitle>
            <DialogDescription className="dialog-context">
              {selected && `${dateLabel(selected.schedule.date)} — ${selected.revision.plate}`}
            </DialogDescription>
          </DialogHeader>
          {selected && mode === "view" && selected.schedule.kind === "COMPANY" && (
            <>
              {/* A Company trip is recorded by its requester (0055), so the Driver only sees the route. */}
              <p className="notice info">
                Company trip for {requesterNames(selected)}. They tap Start trip, each stop and End trip on their phone, with the
                odometer, so there&apos;s nothing for you to tap.
              </p>
              <ol className="request-review-list">
                {selected.revision.legs.map((leg) => (
                  <li key={leg.id}>
                    {leg.origin} → <b>{leg.destinationName}</b> · {leg.plannedTimeOut}–{leg.plannedTimeIn}
                  </li>
                ))}
              </ol>
              <DialogFooter>
                <Button variant="outline" disabled={busy} onClick={() => setMode("problem")}>
                  Report a problem
                </Button>
              </DialogFooter>
            </>
          )}
          {selected && mode === "view" && changedAt(selected) && (
            <p className="notice" role="status">
              Route changed by the Scheduler at {hhmmLabel(manilaHhmm(changedAt(selected)!))}. Check your next stop.
            </p>
          )}
          {selected && mode === "view" && !selected.attendance?.end && !selected.schedule.pausedAt && (
            <AnswerNotice report={latestAnswer(selected.problems)} legs={selected.revision.legs} />
          )}
          {selected && mode === "view" && selected.schedule.kind !== "COMPANY" && (
            <>
              <SavedTapsBanner />
              <DriverTripSteps
                steps={tripSteps(legTimes(selected.revision.legs, selected.attendance, selected.stopTaps), new Set(missedLegs(selected.problems).keys()))}
                legs={selected.revision.legs}
                stopsById={stopsById}
                onTap={tapStep}
                busyKey={busyStop}
                missed={new Map([...missedLegs(selected.problems)].map(([legId, report]) => [legId, stopReportLabel(report)]))}
                onReport={(legId, place) => {
                  setReportAt({ legId, place });
                  setMode("stop");
                  setError("");
                }}
                held={selected.schedule.pausedAt ? holdText(selected.problems) : undefined}
                notYet={selected.startable ? undefined : `Start trip opens on ${dateLabel(selected.schedule.date)}.`}
              />
              {locationOff && (
                <p className="notice" role="alert">
                  Your location is off. Turn it on for this site, then keep going.
                </p>
              )}
              {!selected.completion && selected.attendance?.end && (
                <Button
                  className="primary trip-step-button"
                  onClick={() => {
                    setMode("complete");
                    setCompleteStep(hasOdometer ? "odometer" : "final");
                    if (hasOdometer && !start && lastReading !== null) setStart(String(lastReading));
                  }}
                >
                  Complete trip
                </Button>
              )}
              {selected.completion && (
                <p className="helper">Submitted: {readingsLabel(selected.completion)}.</p>
              )}
              {selected.problems.map((item) => (
                <p className="helper" key={item.id}>
                  {item.legId
                    ? `${stopReportLabel(item)} at ${selected.revision.legs.find((leg) => leg.id === item.legId)?.destinationName ?? "a stop"}`
                    : "Problem reported"}
                  {item.note && `: ${item.note}`}
                </p>
              ))}
              <DialogFooter>
                <Button variant="outline" disabled={busy} onClick={() => setMode("problem")}>
                  Report a problem
                </Button>
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
              {hasOdometer ? (
                <span className="planner-step">Step 2 of 2</span>
              ) : (
                <p className="helper">This vehicle has no odometer, so there are no readings to enter.</p>
              )}
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
          {selected && mode === "stop" && reportAt && (
            <StopReportForm
              place={reportAt.place}
              stops={stopChoices(selected.revision.legs.find((leg) => leg.id === reportAt.legId), requests)}
              busy={busy}
              onCancel={() => {
                setMode("view");
                setReportAt(null);
                setError("");
              }}
              onSend={sendStopReport}
            />
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
          {selected && mode !== "view" && mode !== "stop" && (
            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (mode === "complete" && completeStep === "final" && hasOdometer) {
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

/** The Scheduler's latest answer to a stop report (0068), so the Driver knows what to do next. */
function AnswerNotice({ report, legs }: { report?: ProblemReport; legs: ScheduleLeg[] }) {
  if (!report) return null;
  const place = legs.find((leg) => leg.id === report.legId)?.destinationName ?? "this stop";
  return (
    <p className="notice info" role="status">
      <b>Scheduler&apos;s answer at {hhmmLabel(manilaHhmm(report.decidedAt!))}:</b> {answerText(report, place)}
    </p>
  );
}
