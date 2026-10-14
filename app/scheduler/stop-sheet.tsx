"use client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { TransportRequest } from "@/lib/kova-api";
import { stopNumber } from "@/lib/scheduling";
import { fullDate } from "../planner/format";
import { whatText, whenText } from "./stop-card";

/**
 * A stop's (or a place group's) details, sliding in from the right
 * (prototype "Fit it in" sheet): who asked, what for, when, the details
 * and the contact.
 */
export default function StopSheet({
  stops,
  onClose,
  children,
}: {
  stops: TransportRequest[];
  onClose: () => void;
  /** Below the details: where the stops can go. */
  children?: React.ReactNode;
}) {
  const first = stops[0];
  const urgent = stops.some((stop) => stop.requestType === "URGENT");
  return (
    <Dialog open={!!first} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sc-sheet top-0 right-0 left-auto h-full max-h-none translate-x-0 translate-y-0 rounded-none max-w-full sm:max-w-[440px] content-start">
        {first && (
          <>
            <div>
              <DialogTitle className="sc-sheet-title">
                {urgent ? "Fit it in: " : ""}
                {stops.map((stop) => stopNumber(stop) || "Request").join(" + ")}
              </DialogTitle>
              <DialogDescription>
                {first.destinations[0]?.destinationName} · {fullDate(first.date)}
              </DialogDescription>
            </div>
            {stops.map((stop) => (
              <div key={stop.id} className="sc-detail">
                <div>
                  <b>{stopNumber(stop) || "Request"}</b> · {stop.ownerName}{" "}
                  {stop.requestType === "URGENT" ? (
                    <span className="sc-tag error">Urgent: {stop.urgentReason?.name}</span>
                  ) : (
                    <span className="sc-tag">Regular</span>
                  )}
                </div>
                <div>{stop.projectName}</div>
                <div>
                  {stop.requestType === "URGENT" ? "" : `${whatText(stop)} · `}
                  <b>{whenText(stop)}</b>
                </div>
                {stop.details && <div className="sc-note">{stop.details}</div>}
                {stop.group?.form === "COMPANY" && (
                  <div className="sc-muted">
                    Company trip · {stop.group.vehiclePlate} · Driver {stop.group.driver?.name} · {stop.group.department?.name} · from{" "}
                    {stop.group.startingPoint?.name}
                  </div>
                )}
                <div className="sc-muted">Contact: {stop.contact || "—"}</div>
              </div>
            ))}
            {children}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
