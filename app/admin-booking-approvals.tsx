"use client";
import { useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  approveBooking,
  denyBooking,
  getActiveBookings,
  getPendingBookings,
  type Booking,
} from "@/lib/kova-api";

const time = (hour: number) => `${hour % 12 || 12}:00 ${hour < 12 ? "AM" : "PM"}`;
const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

export default function AdminBookingApprovals() {
  const [pending, setPending] = useState<Booking[]>([]);
  const [scheduled, setScheduled] = useState<Booking[]>([]);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function refresh() {
      setPending(
        [...getPendingBookings()].sort(
          (a, b) =>
            (a.bookingType === b.bookingType ? 0 : a.bookingType === "URGENT" ? -1 : 1) ||
            a.createdAt.localeCompare(b.createdAt),
        ),
      );
      setScheduled(getActiveBookings());
    }
    refresh();
    window.addEventListener("kova-data-update", refresh);
    return () => window.removeEventListener("kova-data-update", refresh);
  }, []);

  function conflictsFor(booking: Booking) {
    return scheduled.filter(
      (s) =>
        s.date === booking.date &&
        s.start < booking.end &&
        s.end > booking.start &&
        (s.plate === booking.plate || s.driverId === booking.driverId),
    );
  }

  async function approve(id: string) {
    setBusy(true);
    setError("");
    try {
      await approveBooking(id);
      setConfirmId(null);
      setSelected(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deny(id: string) {
    setBusy(true);
    setError("");
    try {
      await denyBooking(id);
      setSelected(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const confirmBooking = pending.find((booking) => booking.id === confirmId);
  const confirmConflicts = confirmBooking ? conflictsFor(confirmBooking) : [];

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ADMIN</div>
          <h1>
            Booking Approvals<span className="title-dot">.</span>
          </h1>
          <p>Pending requests awaiting review.</p>
        </div>
      </div>
      <section className="schedule-panel">
        <div className="panel-toolbar">
          <div>
            <ClipboardCheck size={20} />
            <h2>Pending requests</h2>
            <span className="count">{pending.length}</span>
          </div>
        </div>
        {error && (
          <div className="notice" role="alert">
            {error}
            <Button variant="ghost" onClick={() => setError("")}>
              Close
            </Button>
          </div>
        )}
        {pending.length ? (
          <div className="schedule-table admin-trip-table">
            <table>
              <thead>
                <tr>
                  {["TYPE", "DATE", "TIME", "VEHICLE", "DRIVER", "REQUESTED BY", "CONFLICTS", ""].map((v, i) => (
                    <th key={i}>{v}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pending.map((booking) => {
                  const conflicts = conflictsFor(booking);
                  return (
                    <tr key={booking.id} onClick={() => { setSelected(booking); setError(""); }}>
                      <td>
                        <span className={"badge " + (booking.bookingType === "URGENT" ? "urgent" : "")}>
                          {booking.bookingType}
                        </span>
                      </td>
                      <td>{booking.date}</td>
                      <td>
                        {time(booking.start)} – {time(booking.end)}
                      </td>
                      <td>{booking.plate}</td>
                      <td>{booking.driver}</td>
                      <td>{booking.requestedBy}</td>
                      <td>{conflicts.length ? `${conflicts.length} will be cancelled` : "—"}</td>
                      <td>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmId(booking.id);
                          }}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            deny(booking.id);
                          }}
                        >
                          Deny
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <h3>No pending requests</h3>
            <p>New booking requests will appear here for review.</p>
          </div>
        )}
      </section>

      <Dialog open={!!selected && !confirmId} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Booking Request Details</DialogTitle>
            <DialogDescription>{selected && dateLabel(selected.date)}</DialogDescription>
          </DialogHeader>
          {selected && (
            <>
              <div className="driver-trip-details">
                {[
                  ["Vehicle", selected.plate],
                  ["Time", `${time(selected.start)} – ${time(selected.end)}`],
                  ["Driver", selected.driver],
                  ["Requested By", selected.requestedBy],
                  ["Destination", selected.destination],
                  ["Purpose", selected.purpose],
                  ...(selected.notes ? [["Notes", selected.notes]] : []),
                  ["Type", selected.bookingType === "URGENT" ? "Urgent" : "Regular"],
                  ...(selected.bookingType === "URGENT" && selected.urgentReason
                    ? [["Urgent reason", selected.urgentReason]]
                    : []),
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              {conflictsFor(selected).length > 0 && (
                <p className="helper">
                  Approving this will cancel {conflictsFor(selected).length} currently scheduled booking
                  {conflictsFor(selected).length === 1 ? "" : "s"} that conflict with it.
                </p>
              )}
              <DialogFooter className="booking-dialog-actions">
                <Button variant="outline" onClick={() => setSelected(null)}>
                  Close
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => deny(selected.id)}>
                  Deny
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setConfirmId(selected.id)}>
                  Approve
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmId} onOpenChange={(open) => { if (!open) setConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve this booking?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmConflicts.length
                ? `This will cancel ${confirmConflicts.length} currently scheduled booking${confirmConflicts.length === 1 ? "" : "s"} that conflict with it.`
                : "This will confirm the booking and reserve its slots."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                if (confirmId) approve(confirmId);
              }}
            >
              Approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
