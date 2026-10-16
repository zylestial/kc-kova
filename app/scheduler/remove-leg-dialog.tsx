"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Reasons the requester sees when a stop goes back to them (prototype list). */
export const SEND_BACK_REASONS = ["Site closed or not ready", "Can't fit today", "Vehicle can't carry it", "Other"];

/**
 * Remove leg N (prototype): with stops on it, they go back to "To plan" or
 * back to the requester with a reason they see.
 */
export default function RemoveLegDialog({
  leg,
  busy,
  onCancel,
  onRemove,
}: {
  /** The leg being removed, or null when the dialog is closed. */
  leg: { number: number; name: string; stops: string; requesters: string; hasStops: boolean; lastStop: boolean } | null;
  busy: boolean;
  onCancel: () => void;
  onRemove: (sendBack: string | null) => void;
}) {
  const [where, setWhere] = useState<"pool" | "requester">("pool");
  const [reason, setReason] = useState(SEND_BACK_REASONS[0]);
  return (
    <Dialog open={!!leg} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        {leg && (
          <>
            <DialogTitle>
              Remove leg {leg.number}: {leg.name}
            </DialogTitle>
            <DialogDescription>{leg.hasStops ? `Stops ${leg.stops} · ${leg.requesters}` : "No requests on this leg."}</DialogDescription>
            {leg.hasStops && (
              <div className="sc-remove">
                <div className="sc-section">What happens to {leg.stops.includes(",") ? "these stops" : "this stop"}?</div>
                <label className={"sc-option" + (where === "pool" ? " best" : "")}>
                  <input type="radio" name="remove-where" checked={where === "pool"} onChange={() => setWhere("pool")} />
                  <div>
                    <b>Back to the pool</b>
                    <span>Stays in &quot;To plan&quot; so you can put it on another vehicle or day.</span>
                  </div>
                </label>
                <label className={"sc-option" + (where === "requester" ? " best" : "")}>
                  <input type="radio" name="remove-where" checked={where === "requester"} onChange={() => setWhere("requester")} />
                  <div>
                    <b>Back to the requester</b>
                    <span>{leg.requesters} is told it can&apos;t be done and picks another day.</span>
                  </div>
                </label>
                {where === "requester" && (
                  <label className="field">
                    <span>Reason (the requester sees this)</span>
                    <Select value={reason} onValueChange={setReason}>
                      <SelectTrigger aria-label="Reason">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SEND_BACK_REASONS.map((item) => (
                          <SelectItem key={item} value={item}>
                            {item}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                )}
              </div>
            )}
            {leg.lastStop && <p className="sc-muted">This is the trip&apos;s only stop, so removing it discards the draft.</p>}
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={onCancel}>
                Cancel
              </Button>
              <Button className="danger" disabled={busy} onClick={() => onRemove(leg.hasStops && where === "requester" ? reason : null)}>
                Remove leg
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
