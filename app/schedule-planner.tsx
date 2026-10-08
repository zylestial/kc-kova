"use client";
import { useAutoClear } from "@/lib/use-auto-clear";
import { useMemo, useState } from "react";
import { ArrowLeft, Flag, Plus, Save, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createSchedule,
  discardScheduleDraft,
  getRequests,
  getSchedules,
  hydrateKovaData,
  saveScheduleDraft,
  sendBackRequests,
  splitRequest,
  submitSchedule,
  type Schedule,
  type TransportRequest,
} from "@/lib/kova-api";
import { useKovaData } from "@/lib/use-kova-data";
import { addDays, manilaToday } from "@/lib/timezone";
import { tripSignature, useUnsavedChanges } from "@/lib/unsaved-changes";
import {
  BASE,
  MAX_LEGS,
  addLeg,
  canAddFinal,
  canAddLeg,
  commitmentsOn,
  conflictsWith,
  finalLeg,
  initialLegs,
  keepStops,
  legOrigins,
  legsFromRevision,
  currentRevision,
  openRevision,
  poolDestinationChoices,
  poolOrder,
  reflowFinalLegTimeOut,
  scheduleState,
  scheduleStateLabel,
  scheduleStatePill,
  servedRequestIds,
  splitOffs,
  stopsFor,
  toScheduleInput,
  legWarnings,
  tripChecklist,
  tripProblems,
  tripWindow,
  unplacedUrgentRequestIds,
  type LegDraft,
} from "@/lib/trip-record";
import DayPicker from "./planner/day-picker";
import RequestPool from "./planner/request-pool";
import CommitmentsPanel from "./planner/commitments-panel";
import VehiclePanel from "./planner/vehicle-panel";
import LegCard from "./planner/leg-card";
import TripChecklist from "./planner/trip-checklist";
import SubmitDialog from "./planner/submit-dialog";
import SendBackDialog from "./planner/send-back-dialog";
import DiscardDialog, { discardLabel, type DiscardKind } from "./planner/discard-dialog";
import RemoveLegDialog from "./planner/remove-leg-dialog";
import { dateLabel, fullDate } from "./planner/format";

/** Days from `today` on with requests still waiting to be scheduled, earliest first. */
function waitingDays(requests: TransportRequest[], today: string) {
  return [
    ...new Set(
      requests
        .filter((request) => request.status === "ACTIVE" && request.progress === "NOT_YET_SCHEDULED" && request.date >= today)
        .map((request) => request.date),
    ),
  ].sort();
}

/**
 * Create schedule (and continue a draft): choose a day, pick requests from
 * the pool, assign a vehicle (its Driver follows), then build the Trip
 * Record leg by leg. Saving a draft locks the requests, and reserves the
 * time once every leg has times; every rule is rechecked by
 * save_schedule_draft.
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
  // A new schedule opens on the first day with requests waiting, which may
  // be weeks out, rather than on an empty today.
  const [anchor, setAnchor] = useState(() => opened?.schedule.date ?? waitingDays(requests, today)[0] ?? today);
  const [date, setDate] = useState(anchor);
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
  // Requests waiting for the Scheduler to confirm sending them back.
  const [sendingBack, setSendingBack] = useState<string[] | null>(null);
  const [sendBackReason, setSendBackReason] = useState("");
  // On submit, the pool requests left off the route go back to their
  // requesters too, unless the Scheduler is keeping them for another vehicle.
  const [sendLeftovers, setSendLeftovers] = useState(true);
  const [leftoverReason, setLeftoverReason] = useState("");

  const current: Schedule | undefined = editing ? schedules.find((item) => item.id === editing.id) : undefined;
  const discardKind: DiscardKind =
    editing?.rowVersion === null ? "changes" : current?.publishedRevisionId ? "revision" : "draft";
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
    .sort(poolOrder);
  const sentBackCount = dayRequests.filter((request) => request.progress === "SENT_BACK").length;
  const heldElsewhere = dayRequests.filter(
    (request) =>
      request.progress !== "NOT_YET_SCHEDULED" && request.progress !== "SENT_BACK" && !requestIds.includes(request.id),
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
  const openOn = (day: string) =>
    requests.filter((request) => request.date === day && request.status === "ACTIVE" && request.progress === "NOT_YET_SCHEDULED");
  // Urgent requests in the pool still off the route, so they aren't missed.
  const urgentLeft = unplacedUrgentRequestIds(poolStops, legs).length;
  // Pool requests with no stop on this route can go back to their requester
  // to pick another day. One with any stop placed belongs to this schedule.
  const unplacedIds = pool.filter((request) => !requestIds.includes(request.id)).map((request) => request.id);
  // A request only partly on this route has its other stops split off into a
  // new request on submit, which then counts as a leftover too.
  const splits = splitOffs(poolStops, legs);
  const leftoverLabels = [
    ...pool
      .filter((request) => unplacedIds.includes(request.id))
      .map((request) => request.ownerName + (request.requestType === "URGENT" ? " (Urgent)" : "")),
    ...splits.map(
      (part) => `${part.requester}${part.urgent ? " (Urgent)" : ""} — ${part.destinations.join(", ")}, split off`,
    ),
  ];

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
      setNotice(
        tripTime
          ? "Draft saved. Its time is reserved and its requests are locked until you submit or discard it."
          : "Draft saved. Its requests are locked until you submit or discard it. No time is reserved until every leg has times.",
      );
    });
  const submit = () =>
    run(async () => {
      const saved = await saveDraft();
      // Stops this vehicle can't take become their own request first, since
      // submit needs every stop of every request it serves on the route.
      const splitIds: string[] = [];
      for (const part of splits) splitIds.push((await splitRequest(part.requestId, part.stopIds)).id);
      await submitSchedule(saved.id, saved.rowVersion);
      const leftovers = sendLeftovers ? [...unplacedIds, ...splitIds] : [];
      let sentBack = "";
      if (leftovers.length) {
        // The schedule is already submitted, so a failure here is reported
        // rather than thrown: the requests just stay in the pool.
        try {
          await sendBackRequests(leftovers, leftoverReason);
          sentBack = ` ${leftovers.length === 1 ? "1 other request was" : `${leftovers.length} other requests were`} sent back to ${leftovers.length === 1 ? "its requester" : "their requesters"}.`;
        } catch (caught) {
          sentBack = ` The other requests couldn't be sent back (${(caught as Error).message}). Send them back from the pool.`;
        }
      }
      onDone("Schedule submitted. An Admin will review and approve it." + sentBack, date);
    });
  const sendBack = () =>
    run(async () => {
      if (!sendingBack) return;
      await sendBackRequests(sendingBack, sendBackReason);
      setNotice(
        sendingBack.length === 1
          ? "Request sent back. The requester is notified and can pick another day."
          : `${sendingBack.length} requests sent back. Their requesters are notified and can pick another day.`,
      );
      setSendingBack(null);
      setSendBackReason("");
    });
  const discard = () =>
    run(async () => {
      if (!editing) return;
      if (editing.rowVersion === null) {
        onDone("Nothing was saved. The approved schedule stays in force.", date);
        return;
      }
      await discardScheduleDraft(editing.id, editing.rowVersion);
      onDone(
        discardKind === "revision"
          ? "Revision discarded. The approved schedule stays in force."
          : "Draft discarded. Its requests are back to Not yet scheduled.",
        date,
      );
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
              : "Pick a vehicle, then build the route from the requests in the pool. A leg is one drive from one place to the next, and the trip starts and ends at ANONANG (the base). Saving a draft locks its requests, and reserves the time once every leg has times."}
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
        <DayPicker months={months} days={days} date={date} anchor={anchor} openOn={openOn} pickDate={pickDate} setAnchor={setAnchor} otherWaitingDays={waitingDays(requests, today).filter((day) => !days.includes(day))} />
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
          <div className={"planner-columns" + (commitments.length ? "" : " planner-columns-single")}>
            <RequestPool date={date} pool={pool} servedStopIds={servedStopIds} unplacedIds={unplacedIds} heldElsewhere={heldElsewhere} sentBackCount={sentBackCount} busy={busy} setSendingBack={setSendingBack} />

            <CommitmentsPanel commitments={commitments} clashes={clashes} />
          </div>

          <VehiclePanel plate={plate} setPlate={setPlate} vehicles={vehicles} driverFor={driverFor} driver={driver} clashes={clashes} />

          <section className="editor-panel">
            <div className="section-heading">
              <div>
                <h2>Trip Record</h2>
                <p>
                  The Trip Record is the route sheet the Driver follows. Add legs in travel order: the first starts at
                  ANONANG (the base), each next one starts where the last ended, and the final leg returns to ANONANG. Up
                  to {MAX_LEGS} legs.
                </p>
              </div>
            </div>
            {legs.map((leg, index) => (
              <LegCard key={leg.key} leg={leg} index={index} legs={legs} origins={origins} legDestinationName={legDestinationName} poolStops={poolStops} stopsById={stopsById} poolChoices={poolChoices} otherStopChoices={otherStopChoices} otherStopDestinationIds={otherStopDestinationIds} warnings={warnings} applyLegs={applyLegs} changeLeg={changeLeg} setLegs={setLegs} toggleStop={toggleStop} setRemovingLeg={setRemovingLeg} />
            ))}
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
            <TripChecklist ready={ready} checklist={checklist} />
          </section>
        </>
      )}

      <div className="booking-bottom">
        {/* In the bar, not below the form, which the bar would cover. */}
        {notice && (
          <div className="notice success planner-bar-notice" role="status">
            {notice}
          </div>
        )}
        {error && !confirm && !sendingBack && (
          <div className="notice error planner-bar-notice" role="alert">
            {error}
          </div>
        )}
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
              // Icon only on phones (planner-wide), so the bar keeps to one row.
              <Button
                variant="outline"
                className="danger-outline planner-discard"
                aria-label={discardLabel[discardKind]}
                disabled={busy}
                onClick={() => setConfirm("discard")}
              >
                <Trash2 size={16} /> <span className="planner-wide">{discardLabel[discardKind]}</span>
              </Button>
            )}
            <Button variant="outline" disabled={busy || problems.save.length > 0} onClick={save}>
              <Save size={16} /> {busy && !confirm ? "Saving…" : "Save draft"}
            </Button>
            <Button
              className="booking-continue"
              aria-label="Submit for approval"
              disabled={busy || problems.save.length > 0 || problems.submit.length > 0}
              onClick={() => {
                setError("");
                setConfirm("submit");
              }}
            >
              <Send size={16} />
              <span>
                Submit<span className="planner-wide"> for approval</span>
              </span>
            </Button>
          </div>
        )}
      </div>

      <SubmitDialog confirm={confirm} setConfirm={setConfirm} busy={busy} date={date} plate={plate} driverName={driver?.name} reviewLegs={reviewLegs} stopsById={stopsById} urgentLeft={urgentLeft} leftoverLabels={leftoverLabels} splits={splits} sendLeftovers={sendLeftovers} setSendLeftovers={setSendLeftovers} leftoverReason={leftoverReason} setLeftoverReason={setLeftoverReason} error={error} submit={submit} />

      <SendBackDialog sendingBack={sendingBack} setSendingBack={setSendingBack} sendBackReason={sendBackReason} setSendBackReason={setSendBackReason} busy={busy} pool={pool} date={date} error={error} setError={setError} sendBack={sendBack} />

      <DiscardDialog confirm={confirm} setConfirm={setConfirm} busy={busy} kind={discardKind} discard={discard} />
      <RemoveLegDialog removingLeg={removingLeg} setRemovingLeg={setRemovingLeg} legs={legs} applyLegs={applyLegs} />
    </div>
  );
}
