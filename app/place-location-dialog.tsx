"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { saveBookingOption, type BookingOption } from "@/lib/kova-api";
import { parseCoordinates, type Coordinates } from "@/lib/coordinates";
import { coordinatesLabel } from "@/lib/attendance";

type Props = {
  /** The destination choice to set a location on; null while closed. */
  choice: BookingOption | null;
  /** Where the tap that showed "no place location set" was, offered as a starting point. */
  tapSpot: Coordinates | null;
  onClose: () => void;
  onSaved: (message: string) => void;
};

/**
 * Sets a destination choice's location from a trip's Actual times, the same
 * as its Location box in Settings → Request choices. Every tap there, on any
 * trip, is then checked against it. Admin only (the save route checks too).
 */
export default function PlaceLocationDialog({ choice, tapSpot, onClose, onSaved }: Props) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function close() {
    if (busy) return;
    setValue("");
    setError("");
    onClose();
  }

  async function save() {
    if (!choice) return;
    const location = parseCoordinates(value);
    if (location === null || location === "invalid") {
      setError(
        location === null
          ? "Paste the place's coordinates or a Google Maps link."
          : "Location isn't readable. In Google Maps, right-click the place and click its coordinates to copy them, then paste here.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveBookingOption("destinations", { ...choice, location });
      setValue("");
      onSaved(`Location saved for ${choice.name}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!choice} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Location for {choice?.name}</DialogTitle>
          <DialogDescription>
            Drivers&apos; Arrived and Leaving taps here, on this trip and every other, are checked against it. You can change it later in Settings → Request choices.
          </DialogDescription>
        </DialogHeader>
        <label className="field">
          <span>Location</span>
          <Input
            value={value}
            maxLength={2000}
            placeholder="16.103769, 120.436222"
            autoFocus
            onChange={(e) => setValue(e.target.value)}
          />
          <small className="field-hint">
            Paste coordinates or a Google Maps link. In Google Maps, right-click the place and click its coordinates to copy them.
          </small>
        </label>
        {tapSpot && (
          <div className="field">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setValue(coordinatesLabel(tapSpot))}>
              Use where this tap was
            </Button>
            <small className="field-hint">
              {coordinatesLabel(tapSpot)}. Only right if the Driver tapped at {choice?.name}; check it on the map first.
            </small>
          </div>
        )}
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button className="primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save location"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
