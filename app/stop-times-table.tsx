"use client";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BASE } from "@/lib/trip-record";
import { coordinatesLabel, mapUrl, tapTimeLabel } from "@/lib/attendance";
import { atStop, hhmmLabel, stopPlaceLabel, type FormTime, type LegTimes } from "@/lib/stop-times";

type Props = {
  times: LegTimes[];
  /** The trip's Driver, so a tap made by someone else says who. */
  driverId: string;
  nameOf: (accountId: string) => string;
  /** For an Admin reviewing a submitted trip: each time gets a Fill in / Change button. */
  onEdit?: (time: FormTime) => void;
};

/**
 * Each leg's actual TIME OUT and TIME IN, in the form's column order (Leg,
 * Origin, Time Out, Destination, Time In) and as they'll print on it:
 * Start trip, Arrived/Leaving at each stop, End trip, or an Admin's entry in
 * place of one. A tap shows its time, where it was (linked to a map) and a
 * flag when it wasn't at the place; a time not tapped shows "—", or a Fill in
 * button for an Admin. The Admin's view; Drivers get app/driver-trip-steps.tsx.
 */
export default function StopTimesTable({ times, driverId, nameOf, onEdit }: Props) {
  function tapDetails(time: FormTime) {
    const tap = time.tap;
    if (!tap) return null;
    const place = "place" in time.source ? time.source.place : BASE;
    const at = atStop(tap.location);
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
        {tap.location && tap.location.distanceM === null && (
          <small className="attendance-flag">No location set for {place}; set it in Request choices to check</small>
        )}
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
    <div className="schedule-table stop-times">
      <table>
        <thead>
          <tr>
            <th>LEG</th>
            <th>ORIGIN</th>
            <th>TIME OUT</th>
            <th>DESTINATION</th>
            <th>TIME IN</th>
          </tr>
        </thead>
        <tbody>
          {times.map((item, index) => (
            <tr key={item.leg.id}>
              <td>{item.leg.legNo}</td>
              <td>
                <b>{item.leg.origin || times[index - 1]?.leg.destinationName || BASE}</b>
              </td>
              <td>{cell(item.out)}</td>
              <td>
                <b>{item.leg.destinationName}</b>
              </td>
              <td>{cell(item.in)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
