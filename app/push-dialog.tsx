"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { pushState, turnPushOff, turnPushOn, type PushState } from "@/lib/push-device";

const stateText: Record<PushState, string> = {
  unsupported: "This browser can't show KOVA's notifications. Try Chrome, Edge or Firefox.",
  "needs-home-screen":
    "On an iPhone or iPad, add KOVA to your Home Screen first: tap Share, then Add to Home Screen. Open KOVA from there and turn notifications on.",
  blocked: "This browser is blocking KOVA's notifications. Allow them in the browser's settings for this site, then come back here.",
  off: "Off on this device.",
  on: "On for this device. Each new notification in the bell also shows here.",
};

/** Turns phone notifications on or off for this device (lib/push-device.ts). */
export function PushDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    pushState()
      .then(setState)
      .catch(() => setState("unsupported"));
  }, [open]);

  async function change(on: boolean) {
    setBusy(true);
    setError("");
    try {
      if (on) setState(await turnPushOn());
      else {
        await turnPushOff();
        setState("off");
      }
    } catch (caught) {
      setError((caught as Error).message || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function openChange(next: boolean) {
    if (!next) setError("");
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Phone notifications</DialogTitle>
          <DialogDescription>
            Get KOVA&apos;s notifications on this device, even when KOVA is closed. Turn them on on each phone or computer you
            use.
          </DialogDescription>
        </DialogHeader>
        <p role="status">{state ? stateText[state] : "Checking this device…"}</p>
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => openChange(false)}>
            Done
          </Button>
          {state === "off" && (
            <Button className="primary" disabled={busy} onClick={() => void change(true)}>
              {busy ? "Turning on…" : "Turn on"}
            </Button>
          )}
          {state === "on" && (
            <Button className="primary" disabled={busy} onClick={() => void change(false)}>
              {busy ? "Turning off…" : "Turn off"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
