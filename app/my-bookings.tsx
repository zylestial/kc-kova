"use client";
import { useEffect, useState } from "react";
import { CalendarDays, Truck } from "lucide-react";
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
  canManageBooking,
  cancelBooking,
  currentAccount,
  getBookings,
  getVehicles,
  type Booking,
} from "@/lib/kova-api";

const statusLabel: Record<Booking["status"], string> = {
  PENDING: "Pending Admin approval",
  SCHEDULED: "Scheduled",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};
const hour = (h: number) => `${String(h % 12 || 12)}:00 ${h < 12 ? "AM" : "PM"}`;
const tripTime = (b: Booking) => `${hour(b.start)} – ${hour(b.end)}`;
const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function MyBookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [vehicleNames, setVehicleNames] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Booking | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const account = currentAccount();

  useEffect(() => {
    function refresh() {
      const mine = getBookings()
        .filter((b) => (b.createdByAccountId || b.createdBy) === account?.id)
        .sort((a, b) => b.date.localeCompare(a.date) || a.start - b.start);
      setBookings(mine);
      setVehicleNames(Object.fromEntries(getVehicles().map((v) => [v.plate, v.name])));
    }
    refresh();
    window.addEventListener("kova-data-update", refresh);
    return () => window.removeEventListener("kova-data-update", refresh);
  }, [account?.id]);

  async function doCancel() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await cancelBooking(selected.id);
      setSelected(null);
      setConfirmCancel(false);
    } catch (caught) {
      setError((caught as Error).message);
      setConfirmCancel(false);
    } finally {
      setBusy(false);
    }
  }

  const canCancel = !!selected && canManageBooking(selected, account);

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{account?.role.toUpperCase()}</div>
          <h1>
            My Bookings<span className="title-dot">.</span>
          </h1>
          <p>Every vehicle you&apos;ve booked, whatever its status.</p>
        </div>
      </div>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <section className="schedule-panel">
        <div className="panel-toolbar">
          <div>
            <CalendarDays size={20} />
            <h2>Your bookings</h2>
            <span className="count">{bookings.length}</span>
          </div>
        </div>
        {bookings.length ? (
          <div className="schedule-table admin-trip-table">
            <table>
              <thead>
                <tr>
                  {["DATE", "TIME", "VEHICLE", "PLATE NUMBER", "DRIVER", "TYPE", "STATUS", ""].map((t) => (
                    <th key={t}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} onClick={() => { setSelected(b); setError(""); }}>
                    <td>{dateLabel(b.date)}</td>
                    <td>{tripTime(b)}</td>
                    <td>{vehicleNames[b.plate] || b.plate}</td>
                    <td>{b.plate}</td>
                    <td>{b.driver}</td>
                    <td>
                      <span className={"badge " + (b.bookingType === "URGENT" ? "urgent" : "")}>{b.bookingType}</span>
                    </td>
                    <td>
                      <span className={"status-pill " + b.status.toLowerCase()}>{statusLabel[b.status]}</span>
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(b);
                          setError("");
                        }}
                      >
                        Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <div className="empty-icon">
              <Truck size={30} />
            </div>
            <h3>No bookings yet</h3>
            <p>Vehicles you book will appear here.</p>
          </div>
        )}
      </section>

      <Dialog open={!!selected && !confirmCancel} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Booking Details</DialogTitle>
            <DialogDescription>{selected && dateLabel(selected.date)}</DialogDescription>
          </DialogHeader>
          {selected && (
            <>
              <div className="driver-trip-details">
                {[
                  ["Vehicle", vehicleNames[selected.plate] || selected.plate],
                  ["Plate Number", selected.plate],
                  ["Time", tripTime(selected)],
                  ["Driver", selected.driver],
                  ["Destination", selected.destination],
                  ["Purpose", selected.purpose],
                  ...(selected.notes ? [["Notes", selected.notes]] : []),
                  ["Type", selected.bookingType === "URGENT" ? "Urgent" : "Regular"],
                  ...(selected.bookingType === "URGENT" && selected.urgentReason
                    ? [["Urgent reason", selected.urgentReason]]
                    : []),
                  ["Status", statusLabel[selected.status]],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelected(null)}>
                  Close
                </Button>
                {canCancel && (
                  <Button variant="destructive" disabled={busy} onClick={() => setConfirmCancel(true)}>
                    Cancel Booking
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel your booking. If it was already scheduled, the slot will be freed for others.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep Booking</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                doCancel();
              }}
            >
              Cancel Booking
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
