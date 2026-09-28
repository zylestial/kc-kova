"use client";
import { useAutoClear } from "@/lib/use-auto-clear";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, Flag, Plus, Save, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  createSchedule,
  discardScheduleDraft,
  getAccounts,
  getBookingOptions,
  getRequests,
  getSchedules,
  getVehicles,
  hydrateKovaData,
  saveScheduleDraft,
  submitSchedule,
  type Schedule,
} from "@/lib/kova-api";
import { addDays, manilaToday } from "@/lib/timezone";
import { tripSignature, useUnsavedChanges } from "@/lib/unsaved-changes";
import {
  BASE,
  MAX_LEGS,
  addLeg,
  canAddFinal,
  canAddLeg,
  candidatesForLeg,
  commitmentsOn,
  conflictsWith,
  finalLeg,
  initialLegs,
  keepStops,
  legGroupKey,
  legHasContent,
  legOrigins,
  legsFromRevision,
  moveLeg,
  currentRevision,
  openRevision,
  pickLegDestination,
  poolDestinationChoices,
  reflowFinalLegTimeOut,
  removeLeg,
  scheduleState,
  scheduleStateLabel,
  scheduleStatePill,
  servedRequestIds,
  setLegTimeIn,
  stopsFor,
  toScheduleInput,
  legWarnings,
  tripChecklist,
  tripProblems,
  tripWindow,
  type LegDraft,
} from "@/lib/trip-record";
import TripRecordView from "./trip-record-view";

const dateLabel = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Date(value + "T12:00:00").toLocaleDateString("en-US", options);
const fullDate = (value: string) =>
  dateLabel(value, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

const readData = () => ({
  requests: getRequests(),
  schedules: getSchedules(),
  vehicles: getVehicles(),
  accounts: getAccounts(),
  options: getBookingOptions(),
});

function useKovaData() {
  const [data, setData] = useState(readData);
  useEffect(() => {
    const refresh = () => setData(readData());
    window.addEventListener("kova-data-update", refresh);
    return () => window.removeEventListener("kova-data-update", refresh);
  }, []);
  return data;
}

/**
 * Create schedule (and continue a draft): choose a day, pick requests from
 * the pool, assign a vehicle (its Driver follows), then build the Trip
 * Record leg by leg. Saving a draft reserves the time and locks the
 * requests; every rule is rechecked by save_schedule_draft.
 */
export default function SchedulePlanner({
  scheduleId,
  onDone,
}: {
  /**
   * An existing schedule whose DRAFT/RETURNED version is being continued, or
   * an approved one (no open version) to propose a revision of.
   */
  scheduleId?: string;
  /** Called after submit or discard, with a notice and the planned date. */
  onDone: (notice: string, date: string) => void;
}) {
  const { requests, schedules, vehicles, accounts, options } = useKovaData();
  const today = manilaToday();

  // The schedule and version this editor was opened on. Saves are checked
  // against that rowVersion so a stale tab can't overwrite a newer change.
  // rowVersion is null while proposing a revision that isn't saved yet.
  const [editing, setEditing] = useState<{ id: string; rowVersion: number | null } | null>(() => {
    const schedule = scheduleId ? getSchedules().find((item) => item.id === scheduleId) : undefined;
    if (!schedule) return null;
    const open = openRevision(schedule);
    return { id: schedule.id, rowVersion: open ? open.rowVersion : null };
  });
  const opened = useMemo(() => {
    const schedule = scheduleId ? getSchedules().find((item) => item.id === scheduleId) : undefined;
    return schedule ? { schedule, revision: currentRevision(schedule) } : null;
  }, [scheduleId]);

  const [step, setStep] = useState(opened ? 2 : 1);
  const [anchor, setAnchor] = useState(opened?.schedule.date ?? today);
  const [date, setDate] = useState(opened?.schedule.date ?? today);
  // A request cancelled since this version was published (an Admin confirmed
  // its cancellation) is dropped, with its stops, so the new version can be
  // saved. Its route and times are left for the Scheduler to adjust.
  const droppedIds = useMemo(() => {
    const cancelled = new Set(getRequests().filter((request) => request.status === "CANCELLED").map((request) => request.id));
    return (opened?.revision?.requestIds ?? []).filter((id) => cancelled.has(id));
  }, [opened]);
  const [plate, setPlate] = useState(opened?.revision?.plate ?? "");
  const [legs, setLegs] = useState<LegDraft[]>(() =>
    opened?.revision
      ? keepStops(
          legsFromRevision(opened.revision),
          new Set(
            stopsFor(getRequests().filter((request) => !droppedIds.includes(request.id))).map((stop) => stop.id),
          ),
        )
      : initialLegs(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useAutoClear(notice, setNotice);
  const [confirm, setConfirm] = useState<"submit" | "discard" | null>(null);
  // The leg waiting for the Scheduler to confirm its removal.
  const [removingLeg, setRemovingLeg] = useState<number | null>(null);

  const current: Schedule | undefined = editing ? schedules.find((item) => item.id === editing.id) : undefined;
  const returnedComment = current && openRevision(current)?.status === "RETURNED" ? openRevision(current)?.decisionComment : "";

  // Every ACTIVE request for the day, served or not, used to work out what
  // this schedule currently serves (a request is "in" once one of its stops
  // is on a leg — there is no separate manual selection any more).
  const dayRequests = requests.filter((request) => request.date === date && request.status === "ACTIVE");
  const requestIds = servedRequestIds(legs, stopsFor(dayRequests));
  // What was last saved (or opened), to tell whether there is unsaved work.
  const [savedSignature, setSavedSignature] = useState(() => tripSignature(plate, requestIds, legs));
  useUnsavedChanges("schedule-planner", step === 2 && tripSignature(plate, requestIds, legs) !== savedSignature);

  // Requests for the day that are free to plan, plus any this schedule holds.
  const pool = dayRequests
    .filter((request) => request.progress === "NOT_YET_SCHEDULED" || requestIds.includes(request.id))
    .sort((a, b) => a.ownerName.localeCompare(b.ownerName) || a.createdAt.localeCompare(b.createdAt));
  const heldElsewhere = dayRequests.filter(
    (request) => request.progress !== "NOT_YET_SCHEDULED" && !requestIds.includes(request.id),
  ).length;
  const poolStops = stopsFor(pool);
  const servedStopIds = new Set(legs.flatMap((leg) => leg.stops));
  const stopsById = new Map(stopsFor(requests).map((stop) => [stop.id, stop]));
  // Destinations an Admin flagged for a non-request stop, e.g. a fuel or
  // errand leg. The Trip Record's destination pickers never mix the two:
  // request-linked legs come only from the pool; other-stop legs only from
  // this set.
  const otherStopDestinationIds = new Set(
    options.destinations.filter((option) => option.isOtherStop).map((option) => option.id),
  );
  // Active other-stop destinations, plus any an existing other-stop leg uses
  // (it may have been made Inactive, or un-flagged, after being chosen).
  const otherStopChoices = [
    ...options.destinations.filter((option) => option.status === "Active" && option.isOtherStop),
    ...legs
      .filter((leg) => !leg.isFinal && !leg.stops.length && leg.destinationId && !otherStopDestinationIds.has(leg.destinationId))
      .map((leg) => ({ id: leg.destinationId, name: destinationName(leg.destinationId) })),
  ].filter((option, index, all) => all.findIndex((other) => other.id === option.id) === index);
  const poolChoices = poolDestinationChoices(poolStops, legs);

  function destinationName(id: string) {
    return options.destinations.find((option) => option.id === id)?.name ?? stopsById.get(id)?.destinationName ?? "";
  }
  function legDestinationName(leg: LegDraft) {
    if (leg.isFinal) return BASE;
    if (leg.destinationOther) return leg.destinationOther;
    return destinationName(leg.destinationId);
  }
  const origins = legOrigins(legs, legDestinationName);

  const driverFor = (vehiclePlate: string) => {
    const vehicle = vehicles.find((item) => item.plate === vehiclePlate);
    const driver = accounts.find((account) => account.id === vehicle?.assignedDriverId);
    return driver && driver.role === "Driver" && driver.status === "Active" ? driver : undefined;
  };
  const driver = driverFor(plate);
  const commitments = commitmentsOn(date, schedules, editing?.id);
  const tripTime = tripWindow(legs);
  const clashes = plate && driver ? conflictsWith(tripTime, plate, driver.id, commitments) : [];
  const problems = tripProblems({ plate, requestIds, legs, stops: poolStops, otherStopDestinationIds });
  if (plate && !driver) problems.save.unshift("This vehicle has no active Driver assigned.");
  const checklist = tripChecklist({ plate, hasDriver: !!driver, requestIds, legs, stops: poolStops, otherStopDestinationIds });
  const warnings = legWarnings(legs, poolStops, otherStopDestinationIds);
  const ready = problems.save.length === 0 && problems.submit.length === 0;

  const days = Array.from({ length: 14 }, (_, index) => addDays(anchor, index));
  const months = [...new Set([days[0], days.at(-1)!].map((day) => dateLabel(day, { month: "long", year: "numeric" })))];
  const openCount = (day: string) =>
    requests.filter((request) => request.date === day && request.status === "ACTIVE" && request.progress === "NOT_YET_SCHEDULED").length;

  function pickDate(day: string) {
    setDate(day);
    setLegs(initialLegs());
    setError("");
  }

  // Structural changes (add, remove, reorder a leg) also re-check the final
  // leg's Time Out, since inserting or removing a leg can leave it stale.
  const applyLegs = (next: LegDraft[]) => setLegs(reflowFinalLegTimeOut(next));

  function changeLeg(index: number, patch: Partial<LegDraft>) {
    setLegs(legs.map((leg, position) => (position === index ? { ...leg, ...patch } : leg)));
  }

  // The override: every stop starts ticked when its leg is built, so this
  // only ever un-attaches one (or re-attaches one that was split out).
  function toggleStop(index: number, stopId: string, checked: boolean) {
    const leg = legs[index];
    changeLeg(index, { stops: checked ? [...leg.stops, stopId] : leg.stops.filter((item) => item !== stopId) });
  }

  // Saves the draft (creating the schedule on first save) and returns the
  // open version's rowVersion for a follow-up submit.
  async function saveDraft() {
    const input = toScheduleInput(date, plate, requestIds, legs);
    const saved = editing
      ? await saveScheduleDraft(editing.id, editing.rowVersion, input)
      : await createSchedule(input);
    const open = openRevision(saved);
    if (!open) throw Error("The draft was saved, but couldn't be reloaded. Open it again from Schedules.");
    setEditing({ id: saved.id, rowVersion: open.rowVersion });
    return { id: saved.id, rowVersion: open.rowVersion };
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (caught) {
      setError((caught as Error).message);
      // Show the current state (e.g. a request someone else just took).
      await hydrateKovaData().catch(() => undefined);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const save = () =>
    run(async () => {
      await saveDraft();
      setSavedSignature(tripSignature(plate, requestIds, legs));
      setNotice("Draft saved. Its time is reserved and its requests are locked until you submit or discard it.");
    });
  const submit = () =>
    run(async () => {
      const saved = await saveDraft();
      await submitSchedule(saved.id, saved.rowVersion);
      onDone("Schedule submitted. An Admin will review and approve it.", date);
    });
  const discard = () =>
    run(async () => {
      if (!editing) return;
      if (editing.rowVersion === null) {
        onDone("Nothing was saved. The approved schedule stays in force.", date);
        return;
      }
      await discardScheduleDraft(editing.id, editing.rowVersion);
      onDone("Draft discarded. Its requests are back to Not yet scheduled.", date);
    });

  const reviewLegs = legs.map((leg, index) => ({
    origin: origins[index],
    destinationName: leg.isFinal ? BASE : legDestinationName(leg) || "—",
    plannedTimeOut: leg.plannedTimeOut,
    plannedTimeIn: leg.plannedTimeIn,
    contactName: leg.contactName,
    contactNumber: leg.contactNumber,
    stops: leg.stops,
  }));

  return (
    <div className="booking-flow schedule-planner">
      <div className="booking-steps">
        <span className={step === 1 ? "current" : ""}>
          1 <b>Choose day</b>
        </span>
        <i />
        <span className={step === 2 ? "current" : ""}>
          2 <b>Requests, vehicle and Trip Record</b>
        </span>
        <i />
        <span className={confirm === "submit" ? "current" : ""}>
          3 <b>Submit</b>
        </span>
      </div>
      {step > 1 && !editing && (
        <Button variant="ghost" onClick={() => setStep(1)} className="booking-back">
          <ArrowLeft size={16} /> Back
        </Button>
      )}
      <div className="booking-heading">
        <div>
          <h1>{step === 1 ? "Which day are you planning?" : editing ? (editing.rowVersion === null ? "Propose a revision" : "Edit schedule") : "Plan a schedule"}</h1>
          <p>
            {step === 1
              ? "Each day shows how many requests are still waiting to be scheduled."
              : "Choose the requests to plan, pick a vehicle, then build the route. A leg is one drive from one place to the next, and the trip starts and ends at ANONANG (the base). Saving a draft reserves the time."}
          </p>
        </div>
        {step > 1 && (
          <b>
            {dateLabel(date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
            {current && <> · <span className={"status-pill " + scheduleStatePill[scheduleState(current)]}>{scheduleStateLabel[scheduleState(current)]}</span></>}
          </b>
        )}
      </div>

      {step === 1 && (
        <>
          <div className="request-month" aria-live="polite">
            {months.join(" – ")}
          </div>
          <div className="date-strip-wrap">
            <Button variant="outline" size="icon" aria-label="Previous dates" onClick={() => setAnchor(addDays(anchor, -7))}>
              <ChevronLeft size={18} />
            </Button>
            <div className="date-strip">
              {days.map((day) => {
                const count = openCount(day);
                return (
                  <button
                    key={day}
                    className={"date-card " + (date === day ? "selected" : "")}
                    onClick={() => pickDate(day)}
                    aria-pressed={date === day}
                    aria-label={`${fullDate(day)}, ${count} waiting`}
                  >
                    <span>{dateLabel(day, { weekday: "short" })}</span>
                    <b>{dateLabel(day, { day: "numeric" })}</b>
                    <small>{count ? `${count} waiting` : "none"}</small>
                  </button>
                );
              })}
            </div>
            <Button variant="outline" size="icon" aria-label="Next dates" onClick={() => setAnchor(addDays(anchor, 7))}>
              <ChevronRight size={18} />
            </Button>
          </div>
          <div className="date-other">
            <label>
              Jump to date{" "}
              <Input
                type="date"
                value={date}
                onChange={(event) => {
                  if (!event.target.value) return;
                  setAnchor(event.target.value);
                  pickDate(event.target.value);
                }}
              />
            </label>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          {droppedIds.length > 0 && (
            <div className="notice" role="status">
              {droppedIds.length === 1 ? "A request in this schedule was cancelled" : "Requests in this schedule were cancelled"} and{" "}
              {droppedIds.length === 1 ? "was" : "were"} removed. Check the route and times before you save.
            </div>
          )}
          {returnedComment && (
            <div className="notice" role="status">
              <b>Returned by Admin:</b> {returnedComment}
            </div>
          )}
          <div className="planner-columns">
            <section className="editor-panel">
              <div className="section-heading">
                <div>
                  <span className="planner-step">Step 1</span>
                  <h2>Request pool</h2>
                  <p>
                    Requests for {dateLabel(date, { month: "short", day: "numeric" })}, grouped by who asked. A
                    destination is ticked off once it&apos;s on the route below — use &quot;Add stop&quot; there, not here.
                    {heldElsewhere > 0 && ` ${heldElsewhere} more ${heldElsewhere === 1 ? "is" : "are"} already in another schedule.`}
                  </p>
                </div>
              </div>
              {pool.length ? (
                <ul className="planner-pool">
                  {pool.map((request) => (
                    <li key={request.id}>
                      <span className="planner-pool-owner">
                        <b>{request.ownerName}</b>
                        {request.requestType === "URGENT" && <span className="badge urgent">URGENT</span>}
                        {request.projectName && <small>{request.projectName}</small>}
                      </span>
                      <ul className="planner-pool-stops">
                        {request.destinations.map((item) => (
                          <li key={item.id} className={servedStopIds.has(item.id) ? "done" : ""}>
                            <span aria-hidden="true">{servedStopIds.has(item.id) ? "✓" : "○"}</span>
                            <span>
                              <span className="sr-only">{servedStopIds.has(item.id) ? "On the route: " : "Waiting: "}</span>
                              {item.destinationName} — {item.purposeName}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="helper">No requests are waiting for this day.</p>
              )}
            </section>

            <section className={"editor-panel" + (commitments.length ? "" : " editor-panel-quiet")}>
              {commitments.length ? (
                <>
                  <div className="section-heading">
                    <div>
                      <h2>Existing commitments</h2>
                      <p>Time already held on this day by other schedules, including drafts.</p>
                    </div>
                  </div>
                  <ul className="planner-commitments">
                    {commitments.map((item, index) => (
                      <li key={`${item.scheduleId}-${index}`} className={clashes.includes(item) ? "clash" : ""}>
                        <b>
                          {item.start}–{item.end}
                        </b>
                        <span>
                          {item.plate} · {item.driverName}
                        </span>
                        <span className={"status-pill " + scheduleStatePill[item.state]}>{scheduleStateLabel[item.state]}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="helper">Nothing else is scheduled on this day yet.</p>
              )}
            </section>
          </div>

          <section className="editor-panel">
            <span className="planner-step">Step 2</span>
            <h2>Vehicle and Driver</h2>
            <div className="fields planner-vehicle">
              <label className="field">
                <span>Vehicle *</span>
                <Select value={plate} onValueChange={setPlate}>
                  <SelectTrigger aria-label="Vehicle">
                    <SelectValue placeholder="Select a vehicle" />
                  </SelectTrigger>
                  <SelectContent>
                    {vehicles
                      .filter((vehicle) => vehicle.status === "Active")
                      .map((vehicle) => (
                        <SelectItem key={vehicle.plate} value={vehicle.plate} disabled={!driverFor(vehicle.plate)}>
                          {vehicle.name} · {vehicle.plate}
                          {!driverFor(vehicle.plate) && " (no Driver assigned)"}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="field">
                <span>Driver (automatic)</span>
                <Input value={driver?.name ?? ""} placeholder="Follows the vehicle" readOnly />
              </label>
            </div>
            {!vehicles.some((vehicle) => vehicle.status === "Active") ? (
              <p className="helper">There are no active vehicles. An Admin adds them in Settings, under Vehicles.</p>
            ) : (
              vehicles.some((vehicle) => vehicle.status === "Active" && !driverFor(vehicle.plate)) && (
                <p className="helper">
                  A vehicle marked &quot;no Driver assigned&quot; can&apos;t be used yet. An Admin assigns a Driver in Settings,
                  under Vehicles.
                </p>
              )
            )}
            {clashes.length > 0 && (
              <p className="field-hint planner-clash" role="alert">
                {clashes
                  .map((item) =>
                    item.plate === plate
                      ? `${item.plate} is already reserved ${item.start}–${item.end}.`
                      : `${item.driverName} is already driving ${item.start}–${item.end}.`,
                  )
                  .join(" ")}
              </p>
            )}
          </section>

          <section className="editor-panel">
            <div className="section-heading">
              <div>
                <span className="planner-step">Step 3</span>
                <h2>Trip Record</h2>
                <p>
                  The Trip Record is the route sheet the Driver follows. Add legs in travel order: the first starts at
                  ANONANG (the base), each next one starts where the last ended, and the final leg returns to ANONANG. Up
                  to {MAX_LEGS} legs.
                </p>
              </div>
            </div>
            {legs.map((leg, index) => {
              const candidates = candidatesForLeg(legs, index, poolStops);
              const served = leg.stops.map((id) => stopsById.get(id)).filter((stop) => !!stop);
              return (
                <div className="leg-card" key={leg.key}>
                  <div className="leg-label">
                    <b>
                      LEG {String(index + 1).padStart(2, "0")}
                      {leg.isFinal && " · RETURN TO ANONANG"}
                    </b>
                    <span className="leg-actions">
                      {!leg.isFinal && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Move leg ${index + 1} up`}
                            disabled={index === 0}
                            onClick={() => applyLegs(moveLeg(legs, index, -1))}
                          >
                            <ArrowUp size={16} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Move leg ${index + 1} down`}
                            disabled={index === legs.length - 1 || legs[index + 1].isFinal}
                            onClick={() => applyLegs(moveLeg(legs, index, 1))}
                          >
                            <ArrowDown size={16} />
                          </Button>
                        </>
                      )}
                      {legs.length > 1 && (
                        <Button
                          variant="ghost"
                          onClick={() => (legHasContent(leg) ? setRemovingLeg(index) : applyLegs(removeLeg(legs, index)))}
                        >
                          Remove leg
                        </Button>
                      )}
                    </span>
                  </div>
                  <div className="fields leg-fields">
                    <label className="field">
                      <span>Origin (automatic)</span>
                      <Input value={origins[index]} readOnly />
                    </label>
                    {leg.isFinal ? (
                      <label className="field">
                        <span>Destination</span>
                        <Input value={BASE} readOnly />
                      </label>
                    ) : leg.stops.length > 0 ? (
                      <label className="field">
                        <span>Destination (automatic)</span>
                        <Input value={legDestinationName(leg)} readOnly />
                      </label>
                    ) : (
                      <label className="field">
                        <span>Destination *</span>
                        <Select
                          value={legGroupKey(leg)}
                          onValueChange={(value) =>
                            applyLegs(pickLegDestination(legs, index, value, poolStops, otherStopDestinationIds))
                          }
                        >
                          <SelectTrigger aria-label={`Leg ${index + 1} destination`}>
                            <SelectValue placeholder="Select a destination" />
                          </SelectTrigger>
                          <SelectContent>
                            {poolChoices.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>From the request pool</SelectLabel>
                                {poolChoices.map((option) => (
                                  <SelectItem key={option.id} value={option.id}>
                                    {option.name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                            {otherStopChoices.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Fuel/errand stops</SelectLabel>
                                {otherStopChoices.map((option) => (
                                  <SelectItem key={option.id} value={option.id}>
                                    {option.name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                          </SelectContent>
                        </Select>
                      </label>
                    )}
                    <label className="field">
                      <span>Planned Time Out</span>
                      <Input
                        type="time"
                        value={leg.plannedTimeOut}
                        aria-label={`Leg ${index + 1} planned Time Out`}
                        onChange={(event) => changeLeg(index, { plannedTimeOut: event.target.value })}
                      />
                      <small className="field-hint">Not required to save a draft — needed before you submit.</small>
                    </label>
                    <label className="field">
                      <span>Planned Time In</span>
                      <Input
                        type="time"
                        value={leg.plannedTimeIn}
                        aria-label={`Leg ${index + 1} planned Time In`}
                        onChange={(event) => setLegs(setLegTimeIn(legs, index, event.target.value))}
                      />
                    </label>
                    {!leg.isFinal && (
                      <>
                        <label className="field">
                          <span>Destination contact name</span>
                          <Input value={leg.contactName} onChange={(event) => changeLeg(index, { contactName: event.target.value })} />
                        </label>
                        <label className="field">
                          <span>Contact number</span>
                          <Input value={leg.contactNumber} onChange={(event) => changeLeg(index, { contactNumber: event.target.value })} />
                        </label>
                      </>
                    )}
                  </div>
                  {!!warnings[index]?.length && (
                    <ul className="leg-warnings" role="alert">
                      {warnings[index].map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                  {!leg.isFinal && leg.stops.length > 0 && (
                    <div className="leg-stops">
                      <span className="summary-label">
                        Requests served here
                        {served.length > 1 && <span className="badge">One stop for {served.length} requests</span>}
                      </span>
                      {candidates.map((stop) => (
                        <label key={stop.id}>
                          <Checkbox
                            checked={leg.stops.includes(stop.id)}
                            onCheckedChange={(value) => toggleStop(index, stop.id, value === true)}
                          />
                          <span>
                            <b>{stop.requester}</b> — {stop.purposeName}
                          </span>
                        </label>
                      ))}
                      <p className="helper">
                        Every request going here is served automatically. Untick one only if it shouldn&apos;t travel
                        with the rest of this leg.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
            {(canAddLeg(legs) || canAddFinal(legs)) && (
              <div className="leg-add">
                <Button variant="outline" disabled={!canAddLeg(legs)} onClick={() => applyLegs(addLeg(legs))}>
                  <Plus size={16} /> Add stop
                </Button>
                <Button variant="outline" disabled={!canAddFinal(legs)} onClick={() => applyLegs([...legs, finalLeg()])}>
                  <Flag size={16} /> Add return leg to ANONANG
                </Button>
              </div>
            )}
            <div className={"planner-checklist" + (ready ? " ready" : "")}>
              <b>{ready ? "Ready to submit" : "Before you submit"}</b>
              {!ready && <p>You can save a draft once the first four are done. Submitting needs all six.</p>}
              <ul>
                {checklist.map((item) => (
                  <li key={item.label} className={item.done ? "done" : ""}>
                    <span aria-hidden="true">{item.done ? "✓" : "○"}</span>
                    <span>
                      <span className="sr-only">{item.done ? "Done: " : "To do: "}</span>
                      {item.label}
                      {!item.done && item.detail && <small>{item.detail}</small>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </>
      )}

      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      {error && !confirm && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}

      <div className="booking-bottom">
        <div>
          <span>{fullDate(date)}</span>
          {step === 2 && (
            <span>
              {requestIds.length} {requestIds.length === 1 ? "request" : "requests"} · {legs.length} / {MAX_LEGS} legs
              {tripTime && ` · ${tripTime.start}–${tripTime.end}`}
            </span>
          )}
        </div>
        {step === 1 ? (
          <Button className="booking-continue" onClick={() => setStep(2)}>
            Continue — {dateLabel(date, { weekday: "short", month: "short", day: "numeric" })}
          </Button>
        ) : (
          <div className="planner-actions">
            {editing && (
              <Button variant="outline" className="danger-outline" disabled={busy} onClick={() => setConfirm("discard")}>
                <Trash2 size={16} /> Discard draft
              </Button>
            )}
            <Button variant="outline" disabled={busy || problems.save.length > 0} onClick={save}>
              <Save size={16} /> {busy && !confirm ? "Saving…" : "Save draft"}
            </Button>
            <Button
              className="booking-continue"
              disabled={busy || problems.save.length > 0 || problems.submit.length > 0}
              onClick={() => {
                setError("");
                setConfirm("submit");
              }}
            >
              <Send size={16} /> Submit for approval
            </Button>
          </div>
        )}
      </div>

      <Dialog open={confirm === "submit"} onOpenChange={(open) => !busy && setConfirm(open ? "submit" : null)}>
        <DialogContent className="review-trip-modal">
          <DialogHeader>
            <DialogTitle>Submit for approval</DialogTitle>
            <DialogDescription>
              {fullDate(date)} · {plate} · {driver?.name}
            </DialogDescription>
          </DialogHeader>
          <TripRecordView legs={reviewLegs} stopsById={stopsById} />
          <p className="helper">An Admin reviews the schedule. The Driver sees it only once it&apos;s approved.</p>
          {error && (
            <p className="modal-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter className="booking-dialog-actions">
            <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>
              Go back
            </Button>
            <Button className="primary" disabled={busy} onClick={submit}>
              {busy ? "Submitting…" : "Submit for approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm === "discard"} onOpenChange={(open) => !busy && setConfirm(open ? "discard" : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Its reserved time is released and its requests go back to Not yet scheduled, where they can be edited
              and planned again.
              {current?.publishedRevisionId && " The approved schedule stays in force."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep draft</AlertDialogCancel>
            <AlertDialogAction
              className="danger"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                discard();
              }}
            >
              {busy ? "Discarding…" : "Discard draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={removingLeg !== null} onOpenChange={(open) => !open && setRemovingLeg(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove leg {removingLeg === null ? "" : removingLeg + 1}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its destination, times, contact details and ticked requests are removed. The requests stay selected, so
              you can put them on another leg.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep leg</AlertDialogCancel>
            <AlertDialogAction
              className="danger"
              onClick={() => {
                if (removingLeg !== null) applyLegs(removeLeg(legs, removingLeg));
                setRemovingLeg(null);
              }}
            >
              Remove leg
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
