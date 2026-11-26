"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { UnendedTrip } from "@/lib/unended-trip";

const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/**
 * Shown when a Driver taps Start trip while an earlier trip has no End trip
 * (owner, 2026-11-16: a warning, not a block). `onOpen` opens that trip on
 * this screen; without it, a link goes to the screen it's on.
 */
export default function UnendedTripWarning({
  trip,
  busy,
  onOpen,
  onStart,
  onCancel,
}: {
  trip: UnendedTrip;
  busy: boolean;
  onOpen?: () => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  const href = `${trip.kind === "COMPANY" ? "/my-trips" : "/my-schedule"}?open=${encodeURIComponent(trip.scheduleId)}`;
  return (
    <div className="notice" role="alert">
      <b>You haven&apos;t ended your trip on {dateLabel(trip.date)}</b> ({trip.plate}). Tap End trip on it first if you can.
      <div className="actions" style={{ marginTop: 12, flexWrap: "wrap" }}>
        {onOpen ? (
          <Button variant="outline" disabled={busy} onClick={onOpen}>
            Open that trip
          </Button>
        ) : (
          <Button variant="outline" disabled={busy} asChild>
            <Link href={href}>Open that trip</Link>
          </Button>
        )}
        <Button className="primary" disabled={busy} onClick={onStart}>
          Start anyway
        </Button>
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
