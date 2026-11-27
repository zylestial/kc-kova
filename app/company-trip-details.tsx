"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  cancelCompanyTrip,
  hydrateKovaData,
  type Account,
  type CompanyTripState,
  type CompanyTripStatus,
  type RequestProgress,
  type TransportRequest,
  type Vehicle,
} from "@/lib/kova-api";
import { clock } from "@/lib/company-trip-draft";
import TripFacts from "./trip-facts";
import CompanyTripPrint, { companyPaperData } from "./company-trip-print";

/** A Company trip's place, in the requester's words (0096), once it has run its progress wins. */
export function companyTripLabel(state: CompanyTripState | undefined, progress: RequestProgress): { label: string; pill: string } {
  if (progress === "COMPLETED") return { label: "Completed", pill: "scheduled" };
  if (progress === "DONE") return { label: "Done", pill: "scheduled" };
  switch (state) {
    case "WAITING":
      return { label: "Waiting for approval", pill: "pending" };
    case "RETURNED":
      return { label: "Returned to you", pill: "rejected" };
    case "APPROVED":
      return { label: "Approved", pill: "scheduled" };
    case "CHANGES_WAITING":
      return { label: "Approved · changes waiting", pill: "pending" };
    case "CHANGES_RETURNED":
      return { label: "Approved · changes returned", pill: "rejected" };
    case "CANCELLED":
      return { label: "Cancelled", pill: "cancelled" };
    default:
      return { label: progress === "CANCELLED" ? "Cancelled" : "Waiting for approval", pill: progress === "CANCELLED" ? "cancelled" : "pending" };
  }
}

const MEANING: Partial<Record<CompanyTripState, string>> = {
  WAITING: "Sent to the Admin. You'll be notified when it's approved or returned.",
  RETURNED: "The Admin returned it. Edit it and send it again.",
  APPROVED: "Approved. Print the Company Trip Form and bring it on the trip. Its odometer readings fill in once the trip ends.",
  CHANGES_WAITING: "Your changes are with the Admin. Until they decide, the trip stays as it was approved. Print the form again once they approve.",
  CHANGES_RETURNED: "The Admin returned your changes. The trip stays as it was approved; edit it again or leave it.",
  CANCELLED: "This trip was cancelled.",
};

const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

/** My requests: one Company trip request (all its destinations), with Edit and Cancel. */
export default function CompanyTripDetails({
  stops,
  status,
  vehicles,
  accounts,
  onClose,
  onEdit,
}: {
  /** The request's stops, A first. */
  stops: TransportRequest[];
  status?: CompanyTripStatus;
  vehicles: Vehicle[];
  accounts: Account[];
  onClose: () => void;
  onEdit: () => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const group = stops[0]?.group;
  if (!group) return null;
  const active = stops.filter((stop) => stop.status === "ACTIVE");
  const shown = active.length ? active : stops;
  const progress = shown[0]?.progress ?? "CANCELLED";
  const { label } = companyTripLabel(status?.state, progress);
  const cancelled = status?.state === "CANCELLED" || !active.length;
  const finished = ["COMPLETED", "DONE"].includes(progress);
  const legs = status?.legs ?? [];
  const vehicle = vehicles.find((item) => item.plate === group.vehiclePlate);
  // Prints once approved, and after the trip with its odometers; not while changes wait for the Admin.
  const printable = status?.state === "APPROVED";
  const passengers = (status?.passengers ?? []).map((item) =>
    "accountId" in item ? (accounts.find((account) => account.id === item.accountId)?.name ?? "Former account") : `${item.guestName} (guest)`,
  );

  async function cancel() {
    setBusy(true);
    setError("");
    try {
      await cancelCompanyTrip(group!.id, reason.trim());
      onClose();
    } catch (caught) {
      setError((caught as Error).message);
      await hydrateKovaData().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{cancelling ? "Cancel this company trip?" : "Company trip"}</DialogTitle>
          <DialogDescription className="sr-only">
            Request #{group.number} · {dateLabel(group.date)}
          </DialogDescription>
          <TripFacts
            facts={[
              { label: "Request", value: `#${group.number}`, key: true },
              { label: "Date", value: dateLabel(group.date) },
              { label: "Status", value: label },
            ]}
          />
        </DialogHeader>
        {cancelling ? (
          <>
            <p className="helper">
              {status?.state === "WAITING" || status?.state === "RETURNED"
                ? "The request is cancelled right away. It stays in your list as Cancelled."
                : "The approved trip is cancelled right away, and the Driver is told."}
            </p>
            <label className="field">
              <span>Reason (optional)</span>
              <Textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
            </label>
          </>
        ) : (
          <>
            <TripFacts
              facts={[
                { label: "Vehicle", value: vehicle ? `${vehicle.name} · ${vehicle.plate}` : (group.vehiclePlate ?? "—"), key: true },
                { label: "Driver", value: group.driver?.name ?? "—", key: true },
                { label: "Time", value: legs.length ? `${clock(legs[0].out)} to ${clock(legs.at(-1)!.in)}` : "—" },
                {
                  label: "Type",
                  value: group.priority === "URGENT" ? `Urgent${group.urgentReason ? ": " + group.urgentReason.name : ""}` : "Regular",
                },
                { label: "Department / Project Site", value: group.department?.name ?? "—" },
                { label: "Fleet card", value: group.fleetCard ? `ending ${group.fleetCard}` : "—" },
                { label: "Passengers", value: passengers.join(", ") || "None" },
              ]}
            />
            {status?.comment && (status.state === "RETURNED" || status.state === "CHANGES_RETURNED") && (
              <p className="notice" role="status">
                <b>Admin&apos;s comment:</b> {status.comment}
              </p>
            )}
            {status && MEANING[status.state] && !finished && <p className="helper">{MEANING[status.state]}</p>}
            <span className="summary-label">Route</span>
            <ol className="request-review-list">
              <li>
                <b>{group.startingPoint?.name ?? "Main Office"}</b>
                {legs[0] ? ` — leave ${clock(legs[0].out)}` : ""}
              </li>
              {shown.map((stop, index) => (
                <li key={stop.id}>
                  <b>{stop.destinations[0]?.destinationName ?? "—"}</b>
                  {legs[index] ? ` — arrive ${clock(legs[index].in)}` : ""}
                  {legs[index + 1] ? `, leave ${clock(legs[index + 1].out)}` : ""}
                </li>
              ))}
            </ol>
            <p className="helper">
              <b>Purpose:</b> {group.purpose || "—"}
            </p>
          </>
        )}
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          {cancelling ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setCancelling(false)}>
                Keep trip
              </Button>
              <Button className="danger" disabled={busy} onClick={cancel}>
                {busy ? "Cancelling…" : "Cancel trip"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              {!cancelled && !finished && (
                <>
                  <Button
                    variant="outline"
                    className="danger-outline"
                    onClick={() => {
                      setCancelling(true);
                      setError("");
                    }}
                  >
                    Cancel trip
                  </Button>
                  <Button className={printable ? "" : "primary"} variant={printable ? "outline" : "default"} onClick={onEdit}>
                    Edit
                  </Button>
                </>
              )}
              {printable && (
                <Button className="primary" onClick={() => window.print()}>
                  Print Company Trip Form
                </Button>
              )}
            </>
          )}
        </DialogFooter>
        {printable && <CompanyTripPrint data={companyPaperData(group, stops, status, vehicles, accounts)} />}
      </DialogContent>
    </Dialog>
  );
}
