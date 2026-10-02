"use client";
import { useState } from "react";
import { ALL_TIME } from "@/lib/bootstrap-window";
import { loadOlderRecords } from "@/lib/kova-api";
import { useKovaData } from "@/lib/use-kova-data";
import { Button } from "@/components/ui/button";

/**
 * Says the screen only has recent records (the last 90 days, plus anything
 * older that still needs someone) and offers to load the rest. Renders
 * nothing once everything is loaded.
 */
export default function OlderRecordsNotice() {
  const { since } = useKovaData();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!since || since <= ALL_TIME) return null;

  async function load() {
    setBusy(true);
    setFailed(false);
    await loadOlderRecords().catch(() => setFailed(true));
    setBusy(false);
  }

  const from = new Date(since + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <p className="helper older-records" role="status">
      Showing records from {from} on, plus older ones that still need attention.{" "}
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void load()}>
        {busy ? "Loading…" : "Load older records"}
      </Button>
      {failed && <span className="field-hint"> Couldn&apos;t load them. Try again.</span>}
    </p>
  );
}
