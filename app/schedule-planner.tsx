"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, Flag, Plus, Save, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import {
  BASE,
  MAX_LEGS,
  canAddFinal,
  canAddLeg,
  candidatesForLeg,
  commitmentsOn,
  conflictsWith,
  finalLeg,
  keepStops,
  legOrigins,
  legsFromRevision,
  matchingDestinations,
  moveLeg,
  newLeg,
  currentRevision,
  openRevision,
  removeLeg,
  scheduleState,
  scheduleStateLabel,
  scheduleStatePill,
  setLegDestination,
  stopsFor,
  toScheduleInput,
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
  const [requestIds, setRequestIds] = useState<string[]>(opened?.revision?.requestIds ?? []);
  const [plate, setPlate] = useState(opened?.revision?.plate ?? "");
  const [legs, setLegs] = useState<LegDraft[]>(() =>
    opened?.revision ? legsFromRevision(opened.revision) : [newLeg()],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<"submit" | "discard" | null>(null);

  const current: Schedule | undefined = editing ? schedules.find((item) => item.id === editing.id) : undefined;
  const returnedComment = current && openRevision(current)?.status === "RETURNED" ? openRevision(current)?.decisionComment : "";

  // Requests for the day that are free to plan, plus any this schedule holds.
  const pool = requests
    .filter(
      (request) =>
        request.date === date &&
        request.status === "ACTIVE" &&
        (request.progress === "NOT_YET_SCHEDULED" || requestIds.includes(request.id)),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const heldElsewhere = requests.filter(
    (request) =>
      request.date === date && request.status === "ACTIVE" && request.progress !== "NOT_YET_SCHEDULED" && !requestIds.includes(request.id),
  ).length;
  const selectedRequests = pool.filter((request) => requestIds.includes(request.id));
  const selectedStops = stopsFor(selectedRequests);
  const stopsById = new Map(stopsFor(requests).map((stop) => [stop.id, stop]));
  const matches = matchingDestinations(selectedStops);

  const destinationName = (id: string) =>
    options.destinations.find((option) => option.id === id)?.name ?? stopsById.get(id)?.destinationName ?? "";
  // Active destinations, plus any a selected request uses (it may have
  // been made Inactive after the request was submitted).
  const destinationChoices = [
    ...options.destinations.filter((option) => option.status === "Active"),
    ...selectedStops
      .filter((stop) => !options.destinations.some((option) => option.id === stop.destinationId && option.status === "Active"))
      .map((stop) => ({ id: stop.destinationId, name: stop.destinationName })),
  ].filter((option, index, all) => all.findIndex((other) => other.id === option.id) === index);
  const origins = legOrigins(legs, destinationName);

  const driverFor = (vehiclePlate: string) => {
    const vehicle = vehicles.find((item) => item.plate === vehiclePlate);
    const driver = accounts.find((account) => account.id === vehicle?.assignedDriverId);
    return driver && driver.role === "Driver" && driver.status === "Active" ? driver : undefined;
  };
  const driver = driverFor(plate);
  const commitments = commitmentsOn(date, schedules, editing?.id);
  const tripTime = tripWindow(legs);
  const clashes = plate && driver ? conflictsWith(tripTime, plate, driver.id, commitments) : [];
  const problems = tripProblems({ plate, requestIds, legs, stops: selectedStops });
  if (plate && !driver) problems.save.unshift("This vehicle has no active Driver assigned.");

  const days = Array.from({ length: 14 }, (_, index) => addDays(anchor, index));
  const months = [...new Set([days[0], days.at(-1)!].map((day) => dateLabel(day, { month: "long", year: "numeric" })))];
  const openCount = (day: string) =>
    requests.filter((request) => request.date === day && request.status === "ACTIVE" && request.progress === "NOT_YET_SCHEDULED").length;

  function pickDate(day: string) {
    setDate(day);
    setRequestIds([]);
    setLegs([newLeg()]);
    setError("");
  }

  function toggleRequest(id: string, checked: boolean) {
    const next = checked ? [...requestIds, id] : requestIds.filter((item) => item !== id);
    setRequestIds(next);
    const allowed = new Set(stopsFor(pool.filter((request) => next.includes(request.id))).map((stop) => stop.id));
    setLegs(keepStops(legs, allowed));
  }

  function changeLeg(index: number, patch: Partial<LegDraft>) {
    setLegs(legs.map((leg, position) => (position === index ? { ...leg, ...patch } : leg)));
  }

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
    destinationName: leg.isFinal ? BASE : destinationName(leg.destinationId) || "—",
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
              : "Select requests, assign a vehicle, then arrange the Trip Record. Saving a draft reserves the time."}
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
                    <small>{count ? `${count} waiting` : "—"}</small>
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
          {returnedComment && (
            <div className="notice" role="status">
              <b>Returned by Admin:</b> {returnedComment}
            </div>
          )}
          <div className="planner-columns">
            <section className="editor-panel">
              <div className="section-heading">
                <div>
                  <h2>Request pool</h2>
                  <p>
                    Requests for {dateLabel(date, { month: "short", day: "numeric" })} that aren&apos;t scheduled yet.
                    {heldElsewhere > 0 && ` ${heldElsewhere} more ${heldElsewhere === 1 ? "is" : "are"} already in another schedule.`}
                  </p>
                </div>
              </div>
              {pool.length ? (
                <ul className="planner-pool">
                  {pool.map((request) => (
                    <li key={request.id}>
                      <label>
                        <Checkbox
                          checked={requestIds.includes(request.id)}
                          onCheckedChange={(value) => toggleRequest(request.id, value === true)}
                        />
                        <span>
                          <b>{request.ownerName}</b>
                          {request.requestType === "URGENT" && <span className="badge urgent">URGENT</span>}
                          {request.projectName && <small>{request.projectName}</small>}
                          {request.destinations.map((item) => (
                            <small key={item.id}>
                              {item.destinationName} — {item.purposeName}
                            </small>
                          ))}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="helper">No requests are waiting for this day.</p>
              )}
              {matches.length > 0 && (
                <div className="planner-matches">
                  <h3>Matching destinations</h3>
                  <p>
                    These selected requests go to the same place. You can serve them at one shared stop if the timing
                    works, or give each its own leg. Nothing is combined unless you tick it on a leg.
                  </p>
                  {matches.map((group) => (
                    <p key={group.destinationId}>
                      <b>{group.destinationName}:</b>{" "}
                      {group.stops.map((stop) => `${stop.requester} (${stop.purposeName})`).join(", ")}
                    </p>
                  ))}
                </div>
              )}
            </section>

            <section className="editor-panel">
              <div className="section-heading">
                <div>
                  <h2>Existing commitments</h2>
                  <p>Time already held on this day by other schedules, including drafts.</p>
                </div>
              </div>
              {commitments.length ? (
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
              ) : (
                <p className="helper">Nothing is scheduled on this day yet.</p>
              )}
            </section>
          </div>

          <section className="editor-panel">
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
                <h2>Trip Record</h2>
                <p>
                  Legs in travel order. The first leg starts at ANONANG and each leg starts where the previous one
                  ended. Up to {MAX_LEGS} legs, including the final leg back to ANONANG.
                </p>
              </div>
            </div>
            {legs.map((leg, index) => {
              const candidates = candidatesForLeg(legs, index, selectedStops);
              const served = leg.stops.map((id) => stopsById.get(id)).filter((stop) => !!stop);
              return (
                <div className="leg-card" key={leg.key}>
                  <div className="leg-label">
                    <b>
                      LEG {String(index + 1).padStart(2, "0")}
                      {leg.isFinal && " · FINAL"}
                    </b>
                    <span className="leg-actions">
                      {!leg.isFinal && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Move leg ${index + 1} up`}
                            disabled={index === 0}
                            onClick={() => setLegs(moveLeg(legs, index, -1))}
                          >
                            <ArrowUp size={16} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Move leg ${index + 1} down`}
                            disabled={index === legs.length - 1 || legs[index + 1].isFinal}
                            onClick={() => setLegs(moveLeg(legs, index, 1))}
                          >
                            <ArrowDown size={16} />
                          </Button>
                        </>
                      )}
                      {legs.length > 1 && (
                        <Button variant="ghost" onClick={() => setLegs(removeLeg(legs, index))}>
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
                    ) : (
                      <label className="field">
                        <span>Destination *</span>
                        <Select
                          value={leg.destinationId}
                          onValueChange={(value) => setLegs(setLegDestination(legs, index, value, selectedStops))}
                        >
                          <SelectTrigger aria-label={`Leg ${index + 1} destination`}>
                            <SelectValue placeholder="Select a destination" />
                          </SelectTrigger>
                          <SelectContent>
                            {destinationChoices.map((option) => (
                              <SelectItem key={option.id} value={option.id}>
                                {option.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                    )}
                    <label className="field">
                      <span>Planned Time Out *</span>
                      <Input
                        type="time"
                        value={leg.plannedTimeOut}
                        aria-label={`Leg ${index + 1} planned Time Out`}
                        onChange={(event) => changeLeg(index, { plannedTimeOut: event.target.value })}
                      />
                    </label>
                    <label className="field">
                      <span>Planned Time In *</span>
                      <Input
                        type="time"
                        value={leg.plannedTimeIn}
                        aria-label={`Leg ${index + 1} planned Time In`}
                        onChange={(event) => changeLeg(index, { plannedTimeIn: event.target.value })}
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
                  {!leg.isFinal && leg.destinationId && (
                    <div className="leg-stops">
                      <span className="summary-label">
                        Requests served here
                        {served.length > 1 && <span className="badge">Shared stop · {served.length} requests</span>}
                      </span>
                      {candidates.length ? (
                        candidates.map((stop) => (
                          <label key={stop.id}>
                            <Checkbox
                              checked={leg.stops.includes(stop.id)}
                              onCheckedChange={(value) => toggleStop(index, stop.id, value === true)}
                            />
                            <span>
                              <b>{stop.requester}</b> — {stop.purposeName}
                            </span>
                          </label>
                        ))
                      ) : (
                        <p className="helper">No selected request needs this destination.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {(canAddLeg(legs) || canAddFinal(legs)) && (
              <div className="leg-add">
                <Button variant="outline" disabled={!canAddLeg(legs)} onClick={() => setLegs([...legs, newLeg()])}>
                  <Plus size={16} /> Add leg
                </Button>
                <Button variant="outline" disabled={!canAddFinal(legs)} onClick={() => setLegs([...legs, finalLeg()])}>
                  <Flag size={16} /> Add final leg
                </Button>
              </div>
            )}
            {(problems.save.length > 0 || problems.submit.length > 0) && (
              <div className="planner-problems">
                <b>{problems.save.length ? "Before saving:" : "Before submitting:"}</b>
                <ul>
                  {[...problems.save, ...problems.submit].map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            )}
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
              <Button variant="outline" disabled={busy} onClick={() => setConfirm("discard")}>
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
              Edit
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
    </div>
  );
}
