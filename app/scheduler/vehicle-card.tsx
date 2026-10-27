"use client";
import { ChevronDown, ChevronRight } from "lucide-react";
import { hhmmLabel } from "@/lib/stop-times";
import { tripState, tripStateLabel, tripStateTone, type Trip, type TripState, type VehicleRow } from "@/lib/scheduling";

/**
 * One vehicle on the Scheduling page (prototype vehicle card): a header
 * that folds the card open, then each trip's leg cards.
 */
export default function VehicleCard({
  row,
  open,
  flash = false,
  onToggle,
  started,
  drop,
  renderTrip,
  byOf,
}: {
  row: VehicleRow;
  open: boolean;
  /** Highlighted for a moment, when a link (a notification, Edit) led to one of its trips. */
  flash?: boolean;
  onToggle: () => void;
  started: (scheduleId: string) => boolean;
  /** A trip's legs and buttons (TripEditor). */
  renderTrip: (trip: Trip, state: TripState) => React.ReactNode;
  /** "Drafted by Sam Cruz" or "Scheduled by …", or "" when not known. */
  byOf: (trip: Trip) => string;
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

  return (
    <div
      className={"sc-vehicle" + (drop ? (drop.blocked ? " drop-no" : " drop-ok") : "") + (flash ? " flash" : "")}
      data-plate={vehicle.plate}
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
        <span className="sc-muted">
          {summary}
          {trips.length === 1 && byOf(first) && ` · ${byOf(first)}`}
        </span>
        {trips.length === 1 ? (
          <span className={"sc-tag " + tripStateTone[stateOf(first)]}>{tripStateLabel[stateOf(first)]}</span>
        ) : !trips.length ? (
          <span className="sc-tag ok">Free</span>
        ) : null}
        <span className="sc-plate">{vehicle.plate}</span>
      </button>
      {open && (
        <>
          {!trips.length && <p className="sc-muted">Free all day.</p>}
          {trips.map((trip) => {
            const state = stateOf(trip);
            return (
              <div key={trip.schedule.id}>
                {trips.length > 1 && (
                  <div className="sc-trip-head">
                    <b>{trip.revision.driverName}</b>
                    {byOf(trip) && <span className="sc-muted">{byOf(trip)}</span>}
                    <span className={"sc-tag " + tripStateTone[state]}>{tripStateLabel[state]}</span>
                  </div>
                )}
                {renderTrip(trip, state)}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
