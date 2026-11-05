"use client";
import { useState } from "react";
import { Check, Circle, Minus, Phone, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProblemReport, ScheduleLeg, StopTap, StopTask, StopTaskInput } from "@/lib/kova-api";
import { BASE, legStops, type StopInfo } from "@/lib/trip-record";
import { tapTimeLabel } from "@/lib/attendance";
import { hhmmLabel, stopKey, type TimeSource, type TripStep } from "@/lib/stop-times";
import type { JobFlag } from "@/lib/stop-reports";
import { asksTasks, tasksOpen, wholeStopWaiting } from "@/lib/stop-tasks";
import StopJobs from "./stop-jobs";
import StopTaskActions from "./stop-task-actions";

/** Which tap a step is, so the screen can say which one is saving. */
export const stepKey = (source: TimeSource) => ("legId" in source ? stopKey(source) : source.kind);

/** A step's button and its done line, inside a card that already names the place. */
function labels(source: TimeSource): { button: string; done: string } {
  const place = "place" in source ? source.place : BASE;
  switch (source.kind) {
    case "START":
      return { button: "Start trip", done: "Left" };
    case "ARRIVE":
      return { button: `Arrived at ${place}`, done: "Arrived" };
    case "LEAVE":
      return { button: `Leaving ${place}`, done: "Left" };
    case "END":
      return { button: `End trip (back at ${BASE})`, done: "Arrived" };
  }
}

/** One place on the route: where to go, each request there, who to call, and its taps with planned times. */
type Card = {
  /** The stop's leg; none for Start and Back. */
  legId?: string;
  title: string;
  place: string;
  served: StopInfo[];
  contactName: string;
  contactNumber: string;
  rows: { step: TripStep; planned: string }[];
};

/**
 * Groups the flat steps (Start, then Arrived/Leaving per stop, then End) by
 * place. steps[0] is Start trip; for leg i (0-based) that isn't the last,
 * steps[2i+1] is Arrived there and steps[2i+2] is Leaving it (the next leg's
 * Time Out); the last step is End trip.
 */
function cardsFor(steps: TripStep[], legs: ScheduleLeg[], stopsById: Map<string, StopInfo>): Card[] {
  const last = legs.length - 1;
  const cards: Card[] = [
    {
      title: "Start",
      place: BASE,
      served: [],
      contactName: "",
      contactNumber: "",
      rows: [{ step: steps[0], planned: legs[0]?.plannedTimeOut ?? "" }],
    },
  ];
  legs.slice(0, last).forEach((leg, i) => {
    const served = legStops(leg.stops, stopsById);
    // The leg's contact is the requests' own, joined when it was planned; each request shows its own.
    const ownContacts = served.some((stop) => stop.contact);
    cards.push({
      legId: leg.id,
      title: `Stop ${i + 1}`,
      place: leg.destinationName,
      served,
      contactName: ownContacts ? "" : leg.contactName,
      contactNumber: ownContacts ? "" : leg.contactNumber,
      rows: [
        { step: steps[2 * i + 1], planned: leg.plannedTimeIn },
        { step: steps[2 * i + 2], planned: legs[i + 1].plannedTimeOut },
      ],
    });
  });
  cards.push({
    title: "Back",
    place: BASE,
    served: [],
    contactName: "",
    contactNumber: "",
    rows: [{ step: steps[steps.length - 1], planned: legs[last]?.plannedTimeIn ?? "" }],
  });
  return cards;
}

type Props = {
  steps: TripStep[];
  legs: ScheduleLeg[];
  stopsById: Map<string, StopInfo>;
  /** Records the next step's tap. */
  onTap: (source: TimeSource) => void;
  /** The step being saved, if any; every button waits while one is. */
  busyKey: string | null;
  /** Shown instead of the Start trip button before the trip's date. */
  notYet?: string;
  /** Stops reported missed (0061), by leg, with what happened. */
  missed?: Map<string, string>;
  /** Opens the report sheet for a stop; `roadOnly` once its tasks are answered one by one. */
  onReport?: (legId: string, place: string, roadOnly?: boolean) => void;
  /** The trip is held for the Scheduler's answer (0068): this says so instead of the next button; it's told if any task here is still to do. */
  held?: (othersLeft: boolean) => string;
  taps: StopTap[];
  tasks: StopTask[];
  problems: ProblemReport[];
  /** Done, or Undo, for one request at a stop (0088). */
  onTask: (legId: string, requestId: string, kind: StopTaskInput["kind"]) => void;
  /** Opens the report sheet naming this one request. */
  onNotDone: (legId: string, place: string, requestId: string) => void;
  /** Requests a report names (lib/stop-reports), by request id. */
  flags?: Map<string, JobFlag>;
};

/**
 * The Driver's trip as one card per place, in route order: where to go, each
 * request's purpose and notes, the contact and the planned (estimated) times, with Arrived /
 * Left inside. Done taps are ticked with their time; the next one is the
 * only big button. No distances or flags (the Admin sees those); the
 * position is still recorded. "End trip now" covers a trip cut short, with
 * a second tap to confirm. After Arrived, each request is Done or Not yet done,
 * which reports it (0088), and Leaving stays locked until each has an answer.
 * The link under the current stop reports what isn't about one request (0061).
 * Any report makes the trip wait for the Scheduler's answer (0068). A stop
 * Arrived at before tasks existed goes on as it used to.
 */
export default function DriverTripSteps({ steps, legs, stopsById, onTap, busyKey, notYet, missed, onReport, held, flags, taps, tasks, problems, onTask, onNotDone }: Props) {
  const [confirmEnd, setConfirmEnd] = useState(false);
  const busy = busyKey !== null;
  const end = steps[steps.length - 1];
  const next = steps.find((step) => step.state === "next");
  const started = !!steps[0]?.time.tap;
  const cards = cardsFor(steps, legs, stopsById);

  function row({ step, planned }: Card["rows"][number], open: number) {
    const text = labels(step.time.source);
    const key = stepKey(step.time.source);
    if (step.state === "missed") {
      // One line for the stop: its Arrived row says it; its Leaving row is left out.
      if (step.time.source.kind !== "ARRIVE" || !("legId" in step.time.source)) return null;
      return (
        <div className="trip-step missed">
          <TriangleAlert size={18} />
          <span>{missed?.get(step.time.source.legId) ?? "Missed"}</span>
        </div>
      );
    }
    if (step.state === "next") {
      if (notYet) return <p className="trip-step-note">{notYet}</p>;
      if (held)
        return (
          <p className="notice error trip-held" role="status">
            {held(open > 0)}
          </p>
        );
      return (
        <>
          <Button className="primary trip-step-button" disabled={busy || open > 0} onClick={() => onTap(step.time.source)}>
            {busyKey === key ? "Saving… stay where you are" : text.button}
          </Button>
          {open > 0 && <p className="trip-step-note">Mark {open === 1 ? "the task" : "each task"} above first: {open} left.</p>}
        </>
      );
    }
    return (
      <div className={`trip-step ${step.state}`}>
        {step.state === "done" ? <Check size={18} /> : step.state === "skipped" ? <Minus size={18} /> : <Circle size={18} />}
        <span>{text.done}</span>
        {step.state === "done" && step.time.tap && <b>{tapTimeLabel(step.time.tap.at)}</b>}
        {step.state === "done" && step.time.tap?.saved && <small>waiting for signal</small>}
        {step.state === "skipped" && <small>skipped</small>}
        {step.state === "later" && planned && <small>est. {hhmmLabel(planned)}</small>}
      </div>
    );
  }

  return (
    <div className="trip-steps">
      {cards.map((card) => {
        const current = card.rows.some((item) => item.step.state === "next");
        const finished = card.rows.every((item) => ["done", "skipped", "missed"].includes(item.step.state));
        const legId = card.legId;
        // At this stop, between Arrived and Leaving, answering for each request (0088).
        const live = !!legId && card.rows[1]?.step.state === "next" && asksTasks(taps, legId);
        const open = live ? tasksOpen(card.served, legId!, tasks, flags ?? new Map()) : 0;
        const arrived = card.rows[0]?.step.state === "done";
        return (
          <section key={card.title} className={`trip-card${current ? " current" : ""}${finished ? " finished" : ""}`}>
            <header>
              <small>{card.title}</small>
              <h3>{card.place}</h3>
              <StopJobs
                stops={card.served}
                flags={flags}
                actions={
                  legId
                    ? (stop) => (
                        <StopTaskActions
                          legId={legId}
                          requestId={stop.requestId}
                          tasks={tasks}
                          flag={flags?.get(stop.requestId)}
                          live={live && !wholeStopWaiting(problems, legId)}
                          busy={busy}
                          onTask={onTask}
                          onNotDone={(leg, requestId) => onNotDone(leg, card.place, requestId)}
                        />
                      )
                    : undefined
                }
              />
              {(card.contactName || card.contactNumber) && (
                <p>
                  {card.contactName}
                  {card.contactNumber && (
                    <a href={`tel:${card.contactNumber.replace(/[^\d+]/g, "")}`}>
                      <Phone size={14} /> {card.contactNumber}
                    </a>
                  )}
                </p>
              )}
            </header>
            {card.rows.map((item) => (
              <div key={stepKey(item.step.time.source)}>{row(item, open)}</div>
            ))}
            {current && started && !held && legId && onReport && (!live || open > 0 || !card.served.length) && (
              <button type="button" className="trip-step-report" disabled={busy} onClick={() => onReport(legId, card.place, live)}>
                {live ? "Vehicle or road problem? Report it" : arrived ? "Problem here? Report it" : "Can't get here? Report it"}
              </button>
            )}
          </section>
        );
      })}
      {started && next && next !== end && !end.time.tap && (
        <div className="trip-steps-end">
          {confirmEnd ? (
            <>
              <p>End the trip now? The stops left are marked not reached, and they go back to the Scheduler to plan again, with any task here not marked Done.</p>
              <Button variant="outline" disabled={busy} onClick={() => setConfirmEnd(false)}>
                No
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setConfirmEnd(false);
                  onTap(end.time.source);
                }}
              >
                {busyKey === stepKey(end.time.source) ? "Saving…" : "Yes, end trip"}
              </Button>
            </>
          ) : (
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmEnd(true)}>
              Back at {BASE} early? End trip now
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
