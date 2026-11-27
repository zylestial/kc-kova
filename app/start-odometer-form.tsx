"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The starting odometer, asked for right after Start trip (owner,
 * 2026-11-16) in place of the next button, so it's entered before Arrived.
 * `initial` is the vehicle's last ending reading, when there is one.
 */
export default function StartOdometerForm({
  initial,
  busy,
  onSave,
  className = "my-trip-action",
}: {
  initial: number | null;
  busy: boolean;
  onSave: (reading: number) => void;
  /** "trip-reading" on the Daily trip's Start card, full width like its buttons; My Trips' own layout otherwise. */
  className?: string;
}) {
  const [value, setValue] = useState(initial === null ? "" : String(initial));
  const [error, setError] = useState("");
  const save = () => {
    const reading = Number(value);
    if (value.trim() === "" || !Number.isInteger(reading) || reading < 0) {
      setError("Enter the odometer reading in whole kilometres.");
      return;
    }
    setError("");
    onSave(reading);
  };
  return (
    <div className={className}>
      <label className="field">
        <span>Starting odometer (km)</span>
        <Input inputMode="numeric" placeholder="e.g. 48215" value={value} disabled={busy} onChange={(event) => setValue(event.target.value)} />
      </label>
      {initial !== null && <p className="trip-step-note">Filled in from this vehicle&apos;s last trip. Change it if the dashboard shows something different.</p>}
      <Button className="primary trip-step-button" disabled={busy} onClick={save}>
        {busy ? "Saving…" : "Save reading"}
      </Button>
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
