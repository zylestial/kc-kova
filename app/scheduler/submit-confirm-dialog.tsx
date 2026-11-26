"use client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";

/**
 * Submit / Resubmit asks first, showing the vehicle and Driver large, so a
 * trip on the wrong vehicle is caught before the Admin sees it.
 */
export default function SubmitConfirmDialog({
  trip,
  again,
  busy,
  onCancel,
  onSubmit,
}: {
  /** What's being sent, or null when the dialog is closed. */
  trip: { plate: string; driverName: string; date: string; stops: number; times: string } | null;
  again: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={!!trip} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        {trip && (
          <>
            <DialogTitle>{again ? "Resubmit this trip?" : "Submit this trip?"}</DialogTitle>
            <DialogDescription>Check the vehicle and Driver before the Admin sees it.</DialogDescription>
            <dl className="sc-confirm">
              <dt>Vehicle</dt>
              <dd>
                <b>{trip.plate}</b>
              </dd>
              <dt>Driver</dt>
              <dd>
                <b>{trip.driverName}</b>
              </dd>
              <dt>Date</dt>
              <dd>
                {trip.date} · {trip.stops} {trip.stops === 1 ? "stop" : "stops"}
                {trip.times && `, ${trip.times}`}
              </dd>
            </dl>
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={onCancel}>
                Go back
              </Button>
              <Button className="primary" disabled={busy} onClick={onSubmit}>
                {again ? "Yes, resubmit" : "Yes, submit"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
