"use client";
import { useState } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BASE } from "@/lib/trip-record";
import { coordinatesLabel, mapUrl, sentLaterLabel, tapTimeLabel } from "@/lib/attendance";
import { atStop, choiceResolver, hhmmLabel, stopPlaceLabel, type FormTime, type LegTimes } from "@/lib/stop-times";
import type { BookingOption } from "@/lib/kova-api";
import type { Coordinates } from "@/lib/coordinates";
import PlaceLocationDialog from "./place-location-dialog";

type Props = {
  times: LegTimes[];
  /** The trip's Driver, so a tap made by someone else says who. */
  driverId: string;
  nameOf: (accountId: string) => string;
  /** For an Admin reviewing a submitted trip: each time gets a Fill in / Change button. */
  onEdit?: (time: FormTime) => void;
  /** For an Admin: a place with no location gets a Set location button, saved to its destination choice. */
  setLocation?: { destinations: BookingOption[]; onSaved: (message: string) => void };
};

/**
 * Each leg's actual TIME OUT and TIME IN, in the form's column order (Leg,
 * Origin, Time Out, Destination, Time In) and as they'll print on it:
 * Start trip, Arrived/Leaving at each stop, End trip, or an Admin's entry in
 * place of one. A tap shows its time, where it was (linked to a map) and a
 * flag when it wasn't at the place; a time not tapped shows "—", or a Fill in
 * button for an Admin. The Admin's view; Drivers get app/driver-trip-steps.tsx.
 * Shown as one route card per leg at every screen size (.route-cards in globals.css).
 */
export default function StopTimesTable({ times, driverId, nameOf, onEdit, setLocation }: Props) {
  const [locating, setLocating] = useState<{ choice: BookingOption; tapSpot: Coordinates } | null>(null);
  const choiceOf = setLocation && choiceResolver(setLocation.destinations);

  /** The "no place location set" note, with a Set location button for an Admin when the place is a choice. */
  function noPlaceLocation(time: FormTime, place: string, tapSpot: Coordinates) {
    const source = time.source;
    const leg = "legId" in source ? times.find((item) => item.leg.id === source.legId)?.leg : undefined;
    const choice = leg && choiceOf ? choiceOf(leg) : null;
    if (!choiceOf) return <small className="attendance-flag">No location set for {place}; set it in Request choices to check</small>;
    if (!choice) return <small className="attendance-flag">{place} isn&apos;t a Request choice; add it there with a location to check</small>;
    return (
      <>
        <small className="attendance-flag">No location set for {place}</small>
        <Button variant="outline" size="sm" onClick={() => setLocating({ choice, tapSpot })}>
          Set location
        </Button>
      </>
    );
  }

  function tapDetails(time: FormTime) {
    const tap = time.tap;
    if (!tap) return null;
    const place = "place" in time.source ? time.source.place : BASE;
    const at = atStop(tap.location);
    const sent = sentLaterLabel(tap);
    return (
      <>
        {tap.location && (
          <a href={mapUrl(tap.location.lat, tap.location.lng)} target="_blank" rel="noreferrer">
            <MapPin size={13} /> {stopPlaceLabel(tap.location, place)}
          </a>
        )}
        {tap.location && <small className="attendance-coordinates">{coordinatesLabel(tap.location)}</small>}
        {!tap.location && <small className="attendance-flag">No location</small>}
        {at === false && <small className="attendance-flag">Away from {place}</small>}
        {tap.location && tap.location.distanceM === null && noPlaceLocation(time, place, tap.location)}
        {sent && <small className="attendance-flag">{sent}</small>}
        {tap.recordedByAccountId !== driverId && <small>Tapped by {nameOf(tap.recordedByAccountId)}</small>}
      </>
    );
  }

  function cell(time: FormTime) {
    const { tap, correction } = time;
    const edit = onEdit && (
      <Button variant="outline" size="sm" onClick={() => onEdit(time)}>
        {tap || correction ? "Change" : "Fill in"}
      </Button>
    );
    if (correction) {
      return (
        <div className="attendance-tap">
          <b>{hhmmLabel(correction.time)}</b>
          <small className="attendance-flag">
            {tap ? `Corrected by ${nameOf(correction.correctedByAccountId)}; tapped ${tapTimeLabel(tap.at)}` : `Filled in by ${nameOf(correction.correctedByAccountId)}`}
          </small>
          {tapDetails(time)}
          {edit}
        </div>
      );
    }
    if (tap) {
      return (
        <div className="attendance-tap">
          <b>{tapTimeLabel(tap.at)}</b>
          {tapDetails(time)}
          {edit}
        </div>
      );
    }
    return edit ? (
      <div className="attendance-tap">
        <small className="attendance-flag">Not tapped</small>
        {edit}
      </div>
    ) : (
      <>—</>
    );
  }

  return (
    <>
      <ol className="route-cards">
        {times.map((item, index) => (
          <li key={item.leg.id} className="route-card">
            <div className="route-card-head">
              <b>Leg {item.leg.legNo}</b>
            </div>
            <div className="route-stop route-from">
              <span className="route-place">{item.leg.origin || times[index - 1]?.leg.destinationName || BASE}</span>
              <div className="route-actual">
                <span className="route-label">Out</span>
                {cell(item.out)}
              </div>
            </div>
            <div className="route-stop route-to">
              <span className="route-place">{item.leg.destinationName}</span>
              <div className="route-actual">
                <span className="route-label">In</span>
                {cell(item.in)}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {setLocation && (
        <PlaceLocationDialog
          choice={locating?.choice ?? null}
          tapSpot={locating?.tapSpot ?? null}
          onClose={() => setLocating(null)}
          onSaved={(message) => {
            setLocating(null);
            setLocation.onSaved(message);
          }}
        />
      )}
    </>
  );
}
