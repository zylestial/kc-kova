"use client";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TransportRequest } from "@/lib/kova-api";
import { hhmmLabel } from "@/lib/stop-times";
import { timelinePercent } from "@/lib/company-trips";
import { stopNumber, tripState, tripStateLabel, tripStateTone, type Trip, type TripState, type VehicleRow } from "@/lib/scheduling";

const TICKS = ["06:00", "09:00", "12:00", "15:00", "18:00"];
const tickLabel = (time: string) => (time === "06:00" ? "6 AM" : time === "12:00" ? "12 PM" : String(Number(time.slice(0, 2)) % 12));
const percent = (time: string) => `${timelinePercent(time)}%`;

/** What the state box under a trip says (prototype actionBox); the buttons come with editing. */
const stateNote: Record<TripState, string> = {
  DRAFT: "Only you can see it. Submit when the trip is ready.",
  RETURNED: "The Admin sent it back. Fix it, then submit again.",
  SUBMITTED: "Locked until the Admin approves or returns it.",
  APPROVED: "The Driver follows these times. To change them, propose changes for the Admin to approve.",
  CHANGES: "Only you can see these. The Driver still follows the approved times until the Admin approves.",
  CHANGES_SUBMITTED: "The approved times stay in effect until the Admin approves the changes.",
  ON_THE_ROAD: "The Driver has started this trip.",
};

/**
 * One vehicle on the Scheduling page (prototype vehicle card): a header
 * that folds the card open, then the day's timeline and each trip's legs.
 */
export default function VehicleCard({
  row,
  open,
  onToggle,
  isToday,
  now,
  requests,
  started,
  drop,
}: {
  row: VehicleRow;
  open: boolean;
  onToggle: () => void;
  isToday: boolean;
  /** "HH:MM" in Manila, for the red now line on today's timeline. */
  now: string;
  requests: TransportRequest[];
  started: (scheduleId: string) => boolean;
  /** While a stop is dragged: whether it can go on this vehicle, and what dropping does. */
  drop?: {
    blocked: string;
    onDrop: () => void;
  };
}) {
  const { vehicle, kind, driver, trips } = row;
  const stateOf = (trip: Trip) => tripState(trip.schedule, started(trip.schedule.id));
  const first = trips[0];
  const legsTimed = trips.flatMap((trip) => trip.revision.legs).filter((leg) => leg.plannedTimeOut && leg.plannedTimeIn);
  const summary = !trips.length
    ? "No trip"
    : trips.length > 1
      ? `${trips.length} trips`
      : `${first.revision.legs.length} ${first.revision.legs.length === 1 ? "leg" : "legs"}${
          legsTimed.length ? ` · ${hhmmLabel(legsTimed[0].plannedTimeOut)} – ${hhmmLabel(legsTimed.at(-1)!.plannedTimeIn)}` : ""
        }`;
  const stopTag = (stopId: string) => {
    const request = requests.find((item) => item.destinations.some((destination) => destination.id === stopId));
    return request ? (
      <span key={stopId} className={"sc-tag" + (request.requestType === "URGENT" ? " error" : "")}>
        {stopNumber(request) || request.ownerName}
      </span>
    ) : null;
  };

  return (
    <div
      className={"sc-vehicle" + (drop ? (drop.blocked ? " drop-no" : " drop-ok") : "")}
      title={drop?.blocked || undefined}
      onDragOver={(event) => {
        if (!drop) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = drop.blocked ? "none" : "move";
      }}
      onDrop={(event) => {
        if (!drop) return;
        event.preventDefault();
        drop.onDrop();
      }}
    >
      <button type="button" className="sc-vehicle-head" aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <b>{vehicle.name}</b>
        <span className="sc-muted">{kind === "COMPANY" ? "Company trips · Driver per request" : (driver?.name ?? "No Driver assigned")}</span>
        <span className="sc-space" />
        <span className="sc-muted">{summary}</span>
        {trips.length === 1 ? (
          <span className={"sc-tag " + tripStateTone[stateOf(first)]}>{tripStateLabel[stateOf(first)]}</span>
        ) : !trips.length ? (
          <span className="sc-tag ok">Free</span>
        ) : null}
        <span className="sc-plate">{vehicle.plate}</span>
      </button>
      {open && (
        <>
          <div className="sc-track" aria-hidden="true">
            {trips.flatMap((trip) =>
              trip.revision.legs
                .filter((leg) => leg.plannedTimeOut && leg.plannedTimeIn)
                .map((leg) => (
                  <i
                    key={leg.id}
                    className={["APPROVED", "ON_THE_ROAD"].includes(stateOf(trip)) ? "" : "draft"}
                    style={{ left: percent(leg.plannedTimeOut), width: `calc(${percent(leg.plannedTimeIn)} - ${percent(leg.plannedTimeOut)})` }}
                  >
                    {leg.legNo}
                  </i>
                )),
            )}
            {isToday && <span className="sc-now" style={{ left: percent(now) }} />}
          </div>
          <div className="sc-ticks" aria-hidden="true">
            {TICKS.map((time) => (
              <span key={time} style={{ left: percent(time) }}>
                {tickLabel(time)}
              </span>
            ))}
          </div>
          {!trips.length && <p className="sc-muted">Free all day.</p>}
          {trips.map((trip) => {
            const state = stateOf(trip);
            return (
              <div key={trip.schedule.id} className="sc-trip">
                {trips.length > 1 && (
                  <div className="sc-trip-head">
                    <b>{trip.revision.driverName}</b>
                    <span className={"sc-tag " + tripStateTone[state]}>{tripStateLabel[state]}</span>
                  </div>
                )}
                <ul className="sc-legs">
                  {trip.revision.legs.map((leg) => (
                    <li key={leg.id}>
                      <span className="sc-time">
                        {leg.plannedTimeOut && leg.plannedTimeIn
                          ? `${hhmmLabel(leg.plannedTimeOut)} → ${hhmmLabel(leg.plannedTimeIn)}`
                          : "No times yet"}
                      </span>
                      <span>
                        {leg.isFinal ? "Back to ANONANG" : leg.destinationName}
                        <span className="sc-stop-tags">{leg.stops.map(stopTag)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <div className={"sc-state " + tripStateTone[state]}>
                  <b>{tripStateLabel[state]}</b> · {stateNote[state]}
                  {state === "RETURNED" && trip.revision.decisionComment && <> Admin: “{trip.revision.decisionComment}”</>}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
