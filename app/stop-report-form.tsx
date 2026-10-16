"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { StopReportKind } from "@/lib/kova-api";
import { STOP_REPORT_CHOICES } from "@/lib/stop-reports";

/**
 * Reporting a problem at one stop (0061), for the Driver's trip and a
 * Company trip's requester alike: what happened (big buttons, one tap on a
 * phone), a note, and for a blocked road whether to skip the stop or wait.
 */
export default function StopReportForm({
  place,
  busy,
  onCancel,
  onSend,
}: {
  place: string;
  busy: boolean;
  onCancel: () => void;
  onSend: (report: { kind: StopReportKind; note: string; skip: boolean }) => void;
}) {
  const [kind, setKind] = useState<StopReportKind | null>(null);
  const [note, setNote] = useState("");
  const [skip, setSkip] = useState<boolean | null>(null);
  const choice = STOP_REPORT_CHOICES.find((item) => item.kind === kind);
  const ready = !!choice && (!choice.needsNote || note.trim() !== "") && (kind !== "ROAD_BLOCKED" || skip !== null);

  return (
    <div className="stop-report">
      <p className="helper">What happened at {place}?</p>
      <div className="stop-report-choices" role="group" aria-label="What happened">
        {STOP_REPORT_CHOICES.map((item) => (
          <button
            key={item.kind}
            type="button"
            className={"stop-report-choice" + (kind === item.kind ? " selected" : "")}
            aria-pressed={kind === item.kind}
            disabled={busy}
            onClick={() => {
              setKind(item.kind);
              setSkip(null);
            }}
          >
            <b>{item.label}</b>
            <small>{item.hint}</small>
          </button>
        ))}
      </div>
      {kind === "ROAD_BLOCKED" && (
        <div className="stop-report-choices two" role="group" aria-label="Skip or wait">
          <button
            type="button"
            className={"stop-report-choice" + (skip === true ? " selected" : "")}
            aria-pressed={skip === true}
            disabled={busy}
            onClick={() => setSkip(true)}
          >
            <b>Skip this stop</b>
            <small>It&apos;s missed; go on to the next.</small>
          </button>
          <button
            type="button"
            className={"stop-report-choice" + (skip === false ? " selected" : "")}
            aria-pressed={skip === false}
            disabled={busy}
            onClick={() => setSkip(false)}
          >
            <b>Wait</b>
            <small>Keep this stop; tap Arrived when you get there.</small>
          </button>
        </div>
      )}
      {choice && (
        <label className="field">
          <span>{choice.needsNote ? "What happened *" : "Anything to add"}</span>
          <Textarea value={note} maxLength={500} disabled={busy} onChange={(event) => setNote(event.target.value)} />
        </label>
      )}
      <div className="stop-report-actions">
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          Back
        </Button>
        <Button className="primary" disabled={busy || !ready} onClick={() => kind && onSend({ kind, note: note.trim(), skip: skip === true })}>
          {busy ? "Sending…" : "Send report"}
        </Button>
      </div>
    </div>
  );
}
