"use client";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { splitOffs, type StopInfo } from "@/lib/trip-record";
import TripRecordView from "../trip-record-view";
import { fullDate } from "./format";

type Props = {
  confirm: "submit" | "discard" | null;
  setConfirm: (value: "submit" | "discard" | null) => void;
  busy: boolean;
  date: string;
  plate: string;
  driverName: string | undefined;
  reviewLegs: ComponentProps<typeof TripRecordView>["legs"];
  stopsById: Map<string, StopInfo>;
  urgentLeft: number;
  leftoverLabels: string[];
  splits: ReturnType<typeof splitOffs>;
  sendLeftovers: boolean;
  setSendLeftovers: (value: boolean) => void;
  leftoverReason: string;
  setLeftoverReason: (value: string) => void;
  error: string;
  submit: () => void;
};

export default function SubmitDialog({
  confirm,
  setConfirm,
  busy,
  date,
  plate,
  driverName,
  reviewLegs,
  stopsById,
  urgentLeft,
  leftoverLabels,
  splits,
  sendLeftovers,
  setSendLeftovers,
  leftoverReason,
  setLeftoverReason,
  error,
  submit,
}: Props) {
  return (
    <Dialog open={confirm === "submit"} onOpenChange={(open) => !busy && setConfirm(open ? "submit" : null)}>
      <DialogContent className="review-trip-modal">
        <DialogHeader>
          <DialogTitle>Submit for approval</DialogTitle>
          <DialogDescription>
            {fullDate(date)} · {plate} · {driverName}
          </DialogDescription>
        </DialogHeader>
        <TripRecordView legs={reviewLegs} stopsById={stopsById} />
        {urgentLeft > 0 && (
          <div className="notice" role="status">
            {urgentLeft === 1 ? "1 Urgent request is" : `${urgentLeft} Urgent requests are`} not on this route. Add{" "}
            {urgentLeft === 1 ? "it" : "them"} here or to another schedule for this day, or send{" "}
            {urgentLeft === 1 ? "it" : "them"} back so the requester can pick another day.
          </div>
        )}
        {leftoverLabels.length > 0 && (
          <div className="planner-leftovers">
            <span className="summary-label">Not on this route ({leftoverLabels.length})</span>
            <ul className="planner-leftovers-list">
              {leftoverLabels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
            {splits.length > 0 && (
              <p className="helper">
                A split-off stop becomes its own request for the same day, and the rest of that request stays on this
                route.
              </p>
            )}
            <label className="planner-leftovers-toggle">
              <Checkbox checked={sendLeftovers} onCheckedChange={(checked) => setSendLeftovers(checked === true)} />
              Send {leftoverLabels.length === 1 ? "it" : "these"} back to{" "}
              {leftoverLabels.length === 1 ? "the requester" : "their requesters"} to pick another day
            </label>
            {sendLeftovers ? (
              <label className="field">
                <span>Reason (optional)</span>
                <Textarea
                  value={leftoverReason}
                  maxLength={500}
                  placeholder="e.g. All vehicles are fully booked that day."
                  onChange={(event) => setLeftoverReason(event.target.value)}
                />
              </label>
            ) : (
              <p className="helper">
                {leftoverLabels.length === 1 ? "It stays" : "They stay"} in the pool, for another vehicle&apos;s schedule.
              </p>
            )}
          </div>
        )}
        <p className="helper">An Admin reviews the schedule. The Driver sees it only once it&apos;s approved.</p>
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        <DialogFooter className="booking-dialog-actions">
          <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>
            Go back
          </Button>
          <Button className="primary" disabled={busy} onClick={submit}>
            {busy ? "Submitting…" : "Submit for approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
