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
  onToggle,
  started,
  drop,
  renderTrip,
}: {
  row: VehicleRow;
  open: boolean;
  onToggle: () => void;
  started: (scheduleId: string) => boolean;
  /** A trip's legs and buttons (TripEditor). */
  renderTrip: (trip: Trip, state: TripState) => React.ReactNode;
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
          {!trips.length && <p className="sc-muted">Free all day.</p>}
          {trips.map((trip) => {
            const state = stateOf(trip);
            return (
              <div key={trip.schedule.id}>
                {trips.length > 1 && (
                  <div className="sc-trip-head">
                    <b>{trip.revision.driverName}</b>
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
