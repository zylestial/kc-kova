"use client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TransportRequest } from "@/lib/kova-api";
import { fullDate } from "./format";

type Props = {
  sendingBack: string[] | null;
  setSendingBack: (ids: string[] | null) => void;
  sendBackReason: string;
  setSendBackReason: (value: string) => void;
  busy: boolean;
  pool: TransportRequest[];
  date: string;
  error: string;
  setError: (value: string) => void;
  sendBack: () => void;
};

export default function SendBackDialog({
  sendingBack,
  setSendingBack,
  sendBackReason,
  setSendBackReason,
  busy,
  pool,
  date,
  error,
  setError,
  sendBack,
}: Props) {
  return (
    <Dialog
      open={!!sendingBack}
      onOpenChange={(open) => {
        if (open || busy) return;
        setSendingBack(null);
        setSendBackReason("");
        setError("");
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {sendingBack?.length === 1 ? "Send this request back?" : `Send ${sendingBack?.length ?? 0} requests back?`}
          </DialogTitle>
          <DialogDescription className="dialog-context">
            {pool
              .filter((request) => sendingBack?.includes(request.id))
              .map((request) => request.ownerName + (request.requestType === "URGENT" ? " (Urgent)" : ""))
              .join(", ")}{" "}
            · {fullDate(date)}
          </DialogDescription>
        </DialogHeader>
        <p className="helper">
          {sendingBack?.length === 1 ? "It leaves" : "They leave"} the pool for this day. The requester is notified and
          can move {sendingBack?.length === 1 ? "it" : "them"} to another day, or cancel.
        </p>
        <label className="field">
          <span>Reason (optional)</span>
          <Textarea
            value={sendBackReason}
            maxLength={500}
            placeholder="e.g. All vehicles are fully booked that day."
            onChange={(event) => setSendBackReason(event.target.value)}
          />
        </label>
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        <DialogFooter className="booking-dialog-actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setSendingBack(null);
              setSendBackReason("");
              setError("");
            }}
          >
            Keep in pool
          </Button>
          <Button className="primary" disabled={busy} onClick={sendBack}>
            {busy ? "Sending back…" : "Send back"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
