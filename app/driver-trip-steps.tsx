"use client";
import { useState } from "react";
import { Check, Circle, Minus, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ScheduleLeg } from "@/lib/kova-api";
import { BASE, type StopInfo } from "@/lib/trip-record";
import { tapTimeLabel } from "@/lib/attendance";
import { hhmmLabel, stopKey, type TimeSource, type TripStep } from "@/lib/stop-times";

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

/** One place on the route: where to go, why, who to call, and its taps with planned times. */
type Card = {
  title: string;
  place: string;
  purposes: string[];
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
      purposes: [],
      contactName: "",
      contactNumber: "",
      rows: [{ step: steps[0], planned: legs[0]?.plannedTimeOut ?? "" }],
    },
  ];
  legs.slice(0, last).forEach((leg, i) => {
    const served = leg.stops.map((id) => stopsById.get(id)).filter((stop): stop is StopInfo => !!stop);
    cards.push({
      title: `Stop ${i + 1}`,
      place: leg.destinationName,
      purposes: [...new Set(served.map((stop) => stop.purposeName).filter(Boolean))],
      contactName: leg.contactName,
      contactNumber: leg.contactNumber,
      rows: [
        { step: steps[2 * i + 1], planned: leg.plannedTimeIn },
        { step: steps[2 * i + 2], planned: legs[i + 1].plannedTimeOut },
      ],
    });
  });
  cards.push({
    title: "Back",
    place: BASE,
    purposes: [],
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
};

/**
 * The Driver's trip as one card per place, in route order: where to go, the
 * purpose, the contact and the planned (estimated) times, with Arrived /
 * Left inside. Done taps are ticked with their time; the next one is the
 * only big button. No distances or flags (the Admin sees those); the
 * position is still recorded. "End trip now" covers a trip cut short, with
 * a second tap to confirm.
 */
export default function DriverTripSteps({ steps, legs, stopsById, onTap, busyKey, notYet }: Props) {
  const [confirmEnd, setConfirmEnd] = useState(false);
  const busy = busyKey !== null;
  const end = steps[steps.length - 1];
  const next = steps.find((step) => step.state === "next");
  const started = !!steps[0]?.time.tap;

  function row({ step, planned }: Card["rows"][number]) {
    const text = labels(step.time.source);
    const key = stepKey(step.time.source);
    if (step.state === "next") {
      if (notYet) return <p className="trip-step-note">{notYet}</p>;
      return (
        <Button className="primary trip-step-button" disabled={busy} onClick={() => onTap(step.time.source)}>
          {busyKey === key ? "Saving… stay where you are" : text.button}
        </Button>
      );
    }
    return (
      <div className={`trip-step ${step.state}`}>
        {step.state === "done" ? <Check size={18} /> : step.state === "skipped" ? <Minus size={18} /> : <Circle size={18} />}
        <span>{text.done}</span>
        {step.state === "done" && step.time.tap && <b>{tapTimeLabel(step.time.tap.at)}</b>}
        {step.state === "skipped" && <small>skipped</small>}
        {step.state === "later" && planned && <small>est. {hhmmLabel(planned)}</small>}
      </div>
    );
  }

  return (
    <div className="trip-steps">
      {cardsFor(steps, legs, stopsById).map((card) => {
        const current = card.rows.some((item) => item.step.state === "next");
        const finished = card.rows.every((item) => item.step.state === "done" || item.step.state === "skipped");
        return (
          <section key={card.title} className={`trip-card${current ? " current" : ""}${finished ? " finished" : ""}`}>
            <header>
              <small>{card.title}</small>
              <h3>{card.place}</h3>
              {card.purposes.length > 0 && <p>{card.purposes.join(", ")}</p>}
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
              <div key={stepKey(item.step.time.source)}>{row(item)}</div>
            ))}
          </section>
        );
      })}
      {started && next && next !== end && !end.time.tap && (
        <div className="trip-steps-end">
          {confirmEnd ? (
            <>
              <p>End the trip now and skip the stops left?</p>
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
