"use client";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BASE } from "@/lib/trip-record";
import { coordinatesLabel, mapUrl, tapTimeLabel } from "@/lib/attendance";
import { atStop, stopKey, stopPlaceLabel, type FormTime, type LegTimes } from "@/lib/stop-times";

const tapLabel = { ARRIVE: "Arrived", LEAVE: "Leaving" } as const;

type Props = {
  times: LegTimes[];
  /** The trip's Driver, so a tap made by someone else says who. */
  driverId: string;
  nameOf: (accountId: string) => string;
  /** Stop taps that can be made now (stopKey()s); with onTap, these show a button. */
  open?: Set<string>;
  onTap?: (legId: string, kind: "ARRIVE" | "LEAVE") => void;
  /** The stop tap being saved, if any; every button waits while one is. */
  busyKey?: string | null;
};

/**
 * Each leg's actual TIME OUT and TIME IN, as they'll print on the form:
 * Start trip, Arrived/Leaving at each stop, End trip. A tap shows its time,
 * where it was (linked to a map) and a flag when it wasn't at the place; a
 * tap still to make shows its button for the Driver, or "—".
 */
export default function StopTimesTable({ times, driverId, nameOf, open, onTap, busyKey }: Props) {
  // The first open tap is the expected one; the other is for passing a forgotten tap.
  const next = open ? [...open][0] : undefined;
  function cell(time: FormTime) {
    const source = time.source;
    const place = "place" in source ? source.place : BASE;
    const tap = time.tap;
    if (!tap) {
      if (onTap && "legId" in source && open?.has(stopKey(source))) {
        const key = stopKey(source);
        return (
          <Button
            className={key === next ? "primary" : undefined}
            variant={key === next ? "default" : "outline"}
            disabled={!!busyKey}
            onClick={() => onTap(source.legId, source.kind)}
          >
            {busyKey === key ? "Getting location…" : tapLabel[source.kind]}
          </Button>
        );
      }
      return <>—</>;
    }
    const at = atStop(tap.location);
    return (
      <div className="attendance-tap">
        <b>{tapTimeLabel(tap.at)}</b>
        {tap.location && (
          <a href={mapUrl(tap.location.lat, tap.location.lng)} target="_blank" rel="noreferrer">
            <MapPin size={13} /> {stopPlaceLabel(tap.location, place)}
          </a>
        )}
        {tap.location && <small className="attendance-coordinates">{coordinatesLabel(tap.location)}</small>}
        {!tap.location && <small className="attendance-flag">No location</small>}
        {at === false && <small className="attendance-flag">Away from {place}</small>}
        {tap.recordedByAccountId !== driverId && <small>Tapped by {nameOf(tap.recordedByAccountId)}</small>}
      </div>
    );
  }

  return (
    <div className="schedule-table stop-times">
      <table>
        <thead>
          <tr>
            <th>LEG</th>
            <th>DESTINATION</th>
            <th>TIME OUT</th>
            <th>TIME IN</th>
          </tr>
        </thead>
        <tbody>
          {times.map((item) => (
            <tr key={item.leg.id}>
              <td>{item.leg.legNo}</td>
              <td>
                <b>{item.leg.destinationName}</b>
              </td>
              <td>{cell(item.out)}</td>
              <td>{cell(item.in)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
