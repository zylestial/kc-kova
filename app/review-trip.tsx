"use client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Booking } from "@/lib/kova-api";
import type { RecordData } from "./scheduler";

export default function ReviewTrip({
  record,
  booking,
  open,
  onBack,
  onSubmit,
  busy,
}: {
  record: RecordData;
  booking: Booking;
  open: boolean;
  onBack: () => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const item = (label: string, value: string | number) => (
    <div className="review-item" key={label}>
      <span>{label}</span>
      <strong>{value === "" ? "—" : value}</strong>
    </div>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onBack();
      }}
    >
      <DialogContent className="review-trip-modal">
        <DialogHeader>
          <DialogTitle>Review Trip</DialogTitle>
          <DialogDescription>
            Check the actual trip details before submitting.
          </DialogDescription>
        </DialogHeader>
        <div className="review-trip-body">
          <div className="review-grid">
            {item("Date", record.date)}
            {item("Vehicle", record.vehicle)}
            {item("Plate Number", record.plate)}
            {item("Driver", record.driver)}
            {record.project && item("Project / Department", record.project)}
          </div>
          <h3>Scheduled</h3>
          <div className="review-grid">
            {item("Requested By", booking.requestedBy)}
            {item("Destination", booking.destination)}
            {item("Purpose", booking.purpose)}
          </div>
          <h3>Actual trip</h3>
          <div className="review-grid">
            {item("Starting Odometer", `${record.start} km`)}
            {item("Ending Odometer", `${record.end} km`)}
            {item(
              "Total Distance",
              `${Number(record.end) - Number(record.start)} km`,
            )}
          </div>
          <h3>Trip Legs</h3>
          {record.legs.map((l, i) => (
            <div className="review-leg" key={i}>
              <strong>
                LEG {String(i + 1).padStart(2, "0")} · {l.origin} →{" "}
                {l.destination}
              </strong>
              <span>
                Time Out: {l.out || "—"} · Time In: {l.arrival || "—"}
              </span>
              <span>
                Requestor: {l.requestor || "—"} · Purpose / Activity:{" "}
                {l.purpose || "—"}
              </span>
              <span>
                Destination Contact Name: {l.contact || "—"} · Contact Number:{" "}
                {l.phone || "—"}
              </span>
            </div>
          ))}
          <h3>Return</h3>
          <div className="review-grid">
            {item("Full-tank condition", record.full ? "Yes" : "No")}
            {item(
              "Official company fleet card used",
              record.card ? "Yes" : "No",
            )}
            {item("Shell gas receipt attached", record.receipt ? "Yes" : "No")}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onBack} disabled={busy}>
            Back to Edit
          </Button>
          <Button className="primary" onClick={onSubmit} disabled={busy}>
            {busy ? "Submitting…" : "Submit Trip"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
