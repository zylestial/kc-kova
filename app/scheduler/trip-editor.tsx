"use client";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  discardScheduleDraft,
  moveRequestDay,
  saveScheduleDraft,
  sendBackRequests,
  submitSchedule,
  type BookingOption,
  type TransportRequest,
} from "@/lib/kova-api";
import { canShareTrip } from "@/lib/company-trips";
import { openRevision, publishedRevision } from "@/lib/trip-record";
import { hhmmLabel } from "@/lib/stop-times";
import { toMinutes } from "@/lib/trip-estimate";
import { legTimer, type PlanContext } from "@/lib/scheduling-plan";
import { undoEntry, type UndoEntry } from "@/lib/scheduling-undo";
import { stopNumber, tripStateLabel, type Trip, type TripKind, type TripState } from "@/lib/scheduling";
import {
  changeDestination,
  editInput,
  editLegs,
  moveLeg,
  removeLeg,
  setLegTimes,
  tripChecks,
  type EditLeg,
} from "@/lib/scheduling-edit";
import RemoveLegDialog from "./remove-leg-dialog";

type Choice = { id: string; name: string; stops: string[]; urgent: boolean; moveIds: string[]; label: string };

/** A time box that saves when the Scheduler leaves it, not on every keystroke. */
function TimeField({ label, value, disabled, onCommit }: { label: string; value: string; disabled: boolean; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label>
      <span>{label}</span>
      <input
        type="time"
        step={300}
        value={draft ?? value}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft && draft !== value) onCommit(draft);
          setDraft(null);
        }}
        onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

const two = (index: number) => String(index + 1).padStart(2, "0");

/**
 * One trip's leg cards on the Scheduling page (prototype "legTracks"):
 * Origin (automatic), Planned Time Out, Destination and Planned Time In per
 * leg, reordered by dragging ⠿ or with the arrows, and Remove. Every change
 * saves the draft. Below them, what the trip is waiting for and its
 * buttons: Submit, Discard, or Propose changes once approved.
 */
export default function TripEditor({
  trip,
  state,
  kind,
  day,
  context,
  waiting,
  fuel,
  doneLeg,
  busy,
  run,
}: {
  trip: Trip;
  state: TripState;
  kind: TripKind;
  day: string;
  context: PlanContext;
  /** Stops of this kind still to plan this day or any day this week. */
  waiting: TransportRequest[];
  /** Fuel or errand stops an Admin set up (Daily trips only). */
  fuel: BookingOption[];
  /** The Driver (or requester) has reached this leg: Arrived, or End trip on the last. */
  doneLeg: (legId: string, isLast: boolean) => boolean;
  busy: boolean;
  /** Runs a save; the message it returns is shown when it works. `undo`: the trip before it, or "clear". */
  run: (action: () => Promise<string>, undo?: UndoEntry | "clear") => Promise<void>;
}) {
  const company = kind === "COMPANY";
  const { requests } = context;
  const timer = useMemo(() => legTimer(context, company), [context, company]);
  const legs = useMemo(
    () => editLegs(trip.revision.legs, timer, trip.revision.legs[0]?.plannedTimeOut || "08:00"),
    [trip.revision.legs, timer],
  );
  const open = openRevision(trip.schedule);
  // A trip waiting for the Admin can still be changed; it stays waiting (0057).
  const editable = ["DRAFT", "RETURNED", "SUBMITTED", "CHANGES", "CHANGES_SUBMITTED"].includes(state);
  const waitingNote = open?.status === "SUBMITTED" ? " Still waiting for Admin, who sees the change." : "";
  const requestOf = (stopId: string) => requests.find((request) => request.destinations.some((item) => item.id === stopId));
  const tripRequests = trip.revision.requestIds.flatMap((id) => requests.filter((request) => request.id === id));
  const startingPoint = tripRequests[0]?.group?.startingPoint?.name ?? "Starting point";
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  // Places this trip could go instead: waiting stops it can take, by place.
  const choices: { today: Choice[]; week: Choice[]; fuel: Choice[] } = { today: [], week: [], fuel: [] };
  for (const stop of waiting) {
    if (company && tripRequests[0] && !canShareTrip(tripRequests[0], stop)) continue;
    const destination = stop.destinations[0];
    if (!destination?.destinationId) continue;
    const list = stop.flexibility === "WEEK" ? choices.week : choices.today;
    let choice = [...choices.today, ...choices.week].find((item) => item.id === destination.destinationId);
    if (!choice) {
      choice = { id: destination.destinationId, name: destination.destinationName, stops: [], urgent: false, moveIds: [], label: "" };
      list.push(choice);
    }
    choice.stops.push(destination.id);
    choice.urgent ||= stop.requestType === "URGENT";
    if (stop.date !== day) choice.moveIds.push(stop.id);
    choice.label = `${choice.name} · ${[...choice.stops.map((id) => stopNumber(requestOf(id)!))].join(", ")}${choice.urgent ? " · Urgent" : ""}`;
  }
  if (!company)
    choices.fuel = fuel.map((option) => ({ id: option.id, name: option.name, stops: [], urgent: false, moveIds: [], label: `${option.name} (fuel)` }));

  const save = (next: EditLeg[], message: string, moveIds: string[] = [], sendBack?: { ids: string[]; reason: string }) =>
    run(
      async () => {
        for (const id of moveIds) await moveRequestDay(id, day);
        await saveScheduleDraft(trip.schedule.id, open ? open.rowVersion : null, editInput(day, trip.revision.plate, next, (stopId) => requestOf(stopId)?.id));
        if (sendBack?.ids.length) await sendBackRequests(sendBack.ids, sendBack.reason);
        return message + (open ? "." + waitingNote : ". Saved in draft changes, not sent yet.");
      },
      sendBack?.ids.length
        ? "clear"
        : undoEntry(
            trip.schedule,
            kind,
            moveIds.map((id) => ({ id, from: requests.find((request) => request.id === id)?.date ?? day })),
          ),
    );

  function commitTime(index: number, which: "out" | "in", value: string) {
    const leg = legs[index];
    const out = which === "out" ? value : leg.timeOut;
    const inn = which === "in" ? value : leg.timeIn;
    if (toMinutes(inn) <= toMinutes(out)) {
      void run(async () => {
        throw new Error("Planned Time In must be after Planned Time Out.");
      });
      return;
    }
    void save(setLegTimes(legs, index, out, inn, timer), `Leg ${index + 1}: ${hhmmLabel(out)} → ${hhmmLabel(inn)}`);
  }
  function reorder(from: number, to: number) {
    const next = moveLeg(legs, from, to, timer);
    if (next !== legs) void save(next, `Leg ${from + 1} moved to ${to + 1}`);
  }
  function pickDestination(index: number, id: string) {
    const choice = [...choices.today, ...choices.week, ...choices.fuel].find((item) => item.id === id);
    if (!choice) return;
    const leftBehind = legs[index].stops.length ? ` ${legs[index].stops.map((stopId) => stopNumber(requestOf(stopId)!)).join(", ")} back in To plan.` : "";
    void save(
      changeDestination(legs, index, { id: choice.id, name: choice.name, stops: choice.stops }, timer),
      `Leg ${index + 1} now goes to ${choice.name}.${leftBehind}`.replace(/\.$/, ""),
      choice.moveIds,
    );
  }
  function remove(index: number, reason: string | null) {
    const leg = legs[index];
    const next = removeLeg(legs, index, timer);
    const ids = [...new Set(leg.stops.map((stopId) => requestOf(stopId)?.id).filter((id): id is string => !!id))];
    const sendBack = reason ? { ids, reason } : undefined;
    setRemoving(null);
    if (!next.some((item) => item.stops.length)) {
      // The trip's only stop: nothing is left to plan, so the draft goes.
      void run(
        async () => {
          if (!open || publishedRevision(trip.schedule)) throw new Error("A trip needs at least one stop. Discard the changes instead.");
          if (open.status === "SUBMITTED") throw new Error("A trip waiting for Admin needs at least one stop.");
          await discardScheduleDraft(trip.schedule.id, open.rowVersion);
          if (sendBack) await sendBackRequests(sendBack.ids, sendBack.reason);
          return `Leg removed and the draft discarded.${reason ? " Sent back to the requester." : ""}`;
        },
        sendBack ? "clear" : undoEntry(trip.schedule, kind),
      );
      return;
    }
    const names = leg.stops.map((stopId) => stopNumber(requestOf(stopId)!)).join(", ");
    void save(next, `Leg removed.${names ? (reason ? ` ${names} sent back to the requester` : ` ${names} back in To plan`) : ""}`.replace(/\.$/, ""), [], sendBack);
  }

  const late = new Set(timer.lateIn(legs));
  const problems = tripChecks(legs, timer, company, (id) => {
    const request = requests.find((item) => item.id === id);
    return request ? stopNumber(request) || request.ownerName : "A stop";
  });
  const removingLeg = removing === null ? null : legs[removing];

  return (
    <div className="sc-trip">
      {problems.map((problem) => (
        <div key={problem} className="sc-check">
          ⚠ {problem}
        </div>
      ))}
      {legs.map((leg, index) => {
        const done = doneLeg(trip.revision.legs[index]?.id ?? "", index === legs.length - 1);
        const locked = !editable || done || busy;
        const movable = editable && !done && !leg.isFinal;
        const origin = index === 0 ? (company ? startingPoint : "ANONANG") : legs[index - 1].destinationName;
        const lastMovable = legs.length - (legs.at(-1)?.isFinal ? 2 : 1);
        const warnings = [
          index > 0 && toMinutes(leg.timeOut) < toMinutes(legs[index - 1].timeIn) && "Time Out is before it arrives from the previous stop.",
          leg.stops.some((stopId) => late.has(requestOf(stopId)?.id ?? "")) && "Late for the requester's fixed time.",
        ].filter((item): item is string => !!item);
        return (
          <div
            key={leg.key}
            className={"sc-leg" + (done ? " done" : "") + (dragOver === index && dragFrom !== index ? " over" : "") + (dragFrom === index ? " src" : "")}
            onDragOver={(event) => {
              if (dragFrom === null || !movable) return;
              event.preventDefault();
              setDragOver(index);
            }}
            onDragLeave={() => setDragOver((current) => (current === index ? null : current))}
            onDrop={(event) => {
              if (dragFrom === null || !movable) return;
              event.preventDefault();
              reorder(dragFrom, index);
              setDragFrom(null);
              setDragOver(null);
            }}
          >
            <div className="sc-leg-head">
              {movable && (
                <span
                  className="sc-grip"
                  draggable
                  title="Drag onto another leg to reorder"
                  aria-hidden="true"
                  onDragStart={(event) => {
                    event.stopPropagation();
                    event.dataTransfer.setData("text/plain", `leg:${index}`);
                    event.dataTransfer.effectAllowed = "move";
                    setDragFrom(index);
                  }}
                  onDragEnd={() => {
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                >
                  <GripVertical size={16} />
                </span>
              )}
              <b className="sc-leg-no">
                LEG {two(index)}
                {leg.isFinal && " · RETURN TO ANONANG"}
                {done && " · DONE ✓"}
              </b>
              <span className="sc-stop-tags">
                {leg.stops.map((stopId) => {
                  const request = requestOf(stopId);
                  return (
                    <span key={stopId} className={"sc-tag" + (request?.requestType === "URGENT" ? " error" : "")}>
                      {request ? stopNumber(request) || request.ownerName : "Stop"}
                    </span>
                  );
                })}
                {leg.set && <span className="sc-tag info">time set</span>}
              </span>
              <span className="sc-space" />
              {movable && (
                <>
                  <button type="button" className="sc-icon" aria-label={`Move leg ${index + 1} up`} disabled={busy || index === 0} onClick={() => reorder(index, index - 1)}>
                    <ArrowUp size={15} />
                  </button>
                  <button
                    type="button"
                    className="sc-icon"
                    aria-label={`Move leg ${index + 1} down`}
                    disabled={busy || index >= lastMovable}
                    onClick={() => reorder(index, index + 1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setRemoving(index)}>
                    Remove
                  </Button>
                </>
              )}
            </div>
            <div className="sc-leg-fields">
              <label>
                <span>Origin (automatic)</span>
                <input value={origin} readOnly className="ro" />
              </label>
              <TimeField label="Planned Time Out" value={leg.timeOut} disabled={locked} onCommit={(value) => commitTime(index, "out", value)} />
              <label>
                <span>Destination{leg.isFinal ? "" : " *"}</span>
                {leg.isFinal ? (
                  <input value="ANONANG" readOnly className="ro" />
                ) : (
                  <select
                    value={leg.destinationId ?? ""}
                    disabled={locked}
                    aria-label={`Leg ${index + 1} destination`}
                    onChange={(event) => pickDestination(index, event.target.value)}
                  >
                    <option value={leg.destinationId ?? ""}>
                      {leg.destinationName}
                      {leg.stops.length ? ` · ${leg.stops.map((stopId) => stopNumber(requestOf(stopId)!)).join(", ")}` : ""}
                    </option>
                    {choices.today.length > 0 && (
                      <optgroup label={context.isToday ? "Today" : "This day"}>
                        {choices.today.map((choice) => (
                          <option key={choice.id} value={choice.id}>
                            {choice.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {choices.week.length > 0 && (
                      <optgroup label="Any day this week">
                        {choices.week.map((choice) => (
                          <option key={choice.id} value={choice.id}>
                            {choice.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {choices.fuel.filter((choice) => choice.id !== leg.destinationId).length > 0 && (
                      <optgroup label="Fuel">
                        {choices.fuel
                          .filter((choice) => choice.id !== leg.destinationId)
                          .map((choice) => (
                            <option key={choice.id} value={choice.id}>
                              {choice.label}
                            </option>
                          ))}
                      </optgroup>
                    )}
                  </select>
                )}
              </label>
              <TimeField label="Planned Time In" value={leg.timeIn} disabled={locked} onCommit={(value) => commitTime(index, "in", value)} />
            </div>
            {warnings.map((warning) => (
              <div key={warning} className="sc-warn">
                {warning}
              </div>
            ))}
          </div>
        );
      })}

      <TripActions
        trip={trip}
        state={state}
        kind={kind}
        busy={busy}
        run={run}
        legs={legs}
        day={day}
        problems={problems}
        requestIdOf={(stopId) => requestOf(stopId)?.id}
      />

      <RemoveLegDialog
        key={removing ?? "closed"}
        leg={
          removingLeg && removing !== null
            ? {
                number: removing + 1,
                name: removingLeg.destinationName,
                stops: removingLeg.stops.map((stopId) => stopNumber(requestOf(stopId)!)).join(", "),
                requesters: [...new Set(removingLeg.stops.map((stopId) => requestOf(stopId)?.ownerName ?? ""))].join(", "),
                hasStops: removingLeg.stops.length > 0,
                lastStop: !legs.some((item, position) => position !== removing && item.stops.length),
              }
            : null
        }
        busy={busy}
        onCancel={() => setRemoving(null)}
        onRemove={(reason) => removing !== null && remove(removing, reason)}
      />
    </div>
  );
}

/** What the trip is waiting for, and its buttons (prototype actionBox). */
function TripActions({
  trip,
  state,
  kind,
  busy,
  run,
  legs,
  day,
  problems,
  requestIdOf,
}: {
  trip: Trip;
  state: TripState;
  kind: TripKind;
  busy: boolean;
  run: (action: () => Promise<string>, undo?: UndoEntry | "clear") => Promise<void>;
  legs: EditLeg[];
  day: string;
  /** What's wrong with the trip (tripChecks): Submit waits until it's fixed. */
  problems: string[];
  requestIdOf: (stopId: string) => string | undefined;
}) {
  const open = openRevision(trip.schedule);
  const published = publishedRevision(trip.schedule);
  const submit = () =>
    run(async () => {
      if (problems.length) throw new Error("Fix the warnings on this trip before submitting.");
      await submitSchedule(trip.schedule.id, open!.rowVersion);
      return "Submitted. The Admin can see it now.";
    }, "clear");
  const discard = () =>
    run(async () => {
      await discardScheduleDraft(trip.schedule.id, open!.rowVersion);
      return published ? "Draft changes discarded. The approved trip stays." : "Draft discarded. Its stops are back in To plan.";
    }, undoEntry(trip.schedule, kind));
  const propose = () =>
    run(async () => {
      await saveScheduleDraft(trip.schedule.id, null, editInput(day, trip.revision.plate, legs, requestIdOf));
      return "Draft changes opened. Only you can see them until you submit.";
    }, undoEntry(trip.schedule, kind));
  const tone = state === "APPROVED" || state === "ON_THE_ROAD" ? " ok" : state === "RETURNED" ? " error" : "";
  return (
    <div className={"sc-state" + tone}>
      <b>{tripStateLabel[state]}</b>
      {state === "DRAFT" && " · only you can see it. Submit when the trip is ready."}
      {state === "RETURNED" && <> · the Admin sent it back{open?.decisionComment ? `: “${open.decisionComment}”` : ""}. Fix it, then submit again.</>}
      {state === "SUBMITTED" && " · the Admin can see it. You can still change it; the Admin approves the latest version."}
      {(state === "APPROVED" || state === "ON_THE_ROAD") && " · the Driver follows these times. To change them, propose changes for the Admin to approve."}
      {state === "CHANGES" && " · only you can see these. The Driver still follows the approved times below until the Admin approves."}
      {state === "CHANGES_SUBMITTED" &&
        " · the changes are submitted and you can still change them; the approved times below stay in effect until approved."}
      {(state === "CHANGES" || state === "CHANGES_SUBMITTED") && published && (
        <ul className="sc-legs">
          {published.legs.map((leg) => (
            <li key={leg.id}>
              <span className="sc-time">
                {hhmmLabel(leg.plannedTimeOut)} → {hhmmLabel(leg.plannedTimeIn)}
              </span>
              <span>{leg.isFinal ? "Back to ANONANG" : leg.destinationName}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="sc-state-actions">
        {["DRAFT", "RETURNED", "CHANGES"].includes(state) && (
          <>
            <Button size="sm" className="primary" disabled={busy} onClick={submit}>
              Submit for approval
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={discard}>
              {state === "CHANGES" ? "Discard changes" : "Discard draft"}
            </Button>
          </>
        )}
        {(state === "APPROVED" || state === "ON_THE_ROAD") && (
          <Button size="sm" className="primary" disabled={busy} onClick={propose}>
            Propose changes
          </Button>
        )}
      </div>
    </div>
  );
}
