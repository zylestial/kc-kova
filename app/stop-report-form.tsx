"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import type { StopReportKind } from "@/lib/kova-api";
import { STOP_REPORT_CHOICES } from "@/lib/stop-reports";

/**
 * Reporting a problem at one stop (0061), for the Driver's trip and a
 * Company trip's requester alike: what happened (big buttons, one tap on a
 * phone), a note, and for a blocked road whether to skip the stop or wait.
 * Where several requests share the stop, Not available and Wrong address
 * ask which of them (0067): some of them, and the stop goes on as planned.
 */
export default function StopReportForm({
  place,
  stops = [],
  busy,
  onCancel,
  onSend,
}: {
  place: string;
  /** The requests at this stop, e.g. "52-A · Pick up · Cement". */
  stops?: Array<{ requestId: string; label: string }>;
  busy: boolean;
  onCancel: () => void;
  onSend: (report: { kind: StopReportKind; note: string; skip: boolean; requestIds?: string[] }) => void;
}) {
  const [kind, setKind] = useState<StopReportKind | null>(null);
  const [note, setNote] = useState("");
  const [skip, setSkip] = useState<boolean | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(stops.map((stop) => stop.requestId)));
  const choice = STOP_REPORT_CHOICES.find((item) => item.kind === kind);
  const asksWhich = stops.length > 1 && (kind === "NOT_AVAILABLE" || kind === "WRONG_ADDRESS");
  const some = asksWhich && picked.size < stops.length;
  const ready = !!choice && (kind !== "ROAD_BLOCKED" || skip !== null) && (!asksWhich || picked.size > 0);
  function pick(requestId: string, on: boolean) {
    const next = new Set(picked);
    if (on) next.add(requestId);
    else next.delete(requestId);
    setPicked(next);
  }

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
      {asksWhich && (
        <div className="stop-report-which" role="group" aria-label="Which ones">
          <p className="helper">Which ones?</p>
          {stops.map((stop) => (
            <label key={stop.requestId}>
              <Checkbox checked={picked.has(stop.requestId)} disabled={busy} onCheckedChange={(on) => pick(stop.requestId, on === true)} />
              {stop.label}
            </label>
          ))}
          {some && <small>The others stay on the trip: tap Arrived and Leaving here as usual.</small>}
        </div>
      )}
      {choice && (
        <label className="field">
          <span>What happened (optional)</span>
          <Textarea value={note} maxLength={500} disabled={busy} onChange={(event) => setNote(event.target.value)} />
        </label>
      )}
      <div className="stop-report-actions">
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          Back
        </Button>
        <Button className="primary" disabled={busy || !ready} onClick={() => kind && onSend({ kind, note: note.trim(), skip: skip === true, requestIds: some ? [...picked] : undefined })}>
          {busy ? "Sending…" : "Send report"}
        </Button>
      </div>
    </div>
  );
}
