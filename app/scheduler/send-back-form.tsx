"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SEND_BACK_REASONS } from "./remove-leg-dialog";

/**
 * Below a waiting stop's plan options: send it straight back to the
 * requester with a reason they see, without putting it on a trip first.
 */
export default function SendBackForm({
  requesters,
  busy,
  onSendBack,
}: {
  /** Who is told, e.g. "Ana Reyes". */
  requesters: string;
  busy: boolean;
  onSendBack: (reason: string) => void;
}) {
  const [reason, setReason] = useState(SEND_BACK_REASONS[0]);
  return (
    <div>
      <div className="sc-section">Or send it back</div>
      <div className="sc-remove">
        <span className="sc-muted">{requesters} is told it can&apos;t be done, fixes it or picks another day, and saves it to send it again.</span>
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
        <Button className="danger" disabled={busy} onClick={() => onSendBack(reason)}>
          Send back to requester
        </Button>
      </div>
    </div>
  );
}
