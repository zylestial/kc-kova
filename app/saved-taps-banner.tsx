"use client";
import { Button } from "@/components/ui/button";
import { clearRefusedTaps, getRefusedTaps, savedTapCount } from "@/lib/kova-api";
import { useKovaData } from "@/lib/use-kova-data";

/**
 * On the trip screens: how many taps are waiting on this phone for signal
 * (0077), and any KOVA refused when they were sent, until read.
 */
export default function SavedTapsBanner() {
  // Re-renders whenever the data or the saved taps change.
  useKovaData();
  const waiting = savedTapCount();
  const refused = getRefusedTaps();
  return (
    <>
      {waiting > 0 && (
        <p className="notice info" role="status">
          {waiting === 1 ? "1 tap is" : `${waiting} taps are`} saved on this phone with the time you tapped. KOVA sends{" "}
          {waiting === 1 ? "it" : "them"} by itself when you have signal; keep going with your trip.
        </p>
      )}
      {refused.length > 0 && (
        <div className="notice error" role="alert">
          <p>A tap saved on this phone couldn&apos;t be recorded. Tell your Scheduler:</p>
          <ul>
            {refused.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          <Button variant="outline" onClick={clearRefusedTaps}>
            OK
          </Button>
        </div>
      )}
    </>
  );
}
