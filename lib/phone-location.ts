import type { AttendanceInput } from "@/lib/kova-api";

/** A reading this accurate (in metres) is good enough to stop waiting for a better one. */
export const GOOD_ACCURACY_M = 50;

/**
 * Asks the phone for its position (the browser shows its permission prompt
 * the first time) and keeps listening for up to `maxWaitMs`, keeping the
 * most accurate reading: a phone's first reading indoors often comes from
 * Wi-Fi or cell towers and can be hundreds of metres off, and GPS sharpens
 * it over a few seconds. Stops early at GOOD_ACCURACY_M or better.
 *
 * Resolves to null instead of failing when there's no reading at all (no
 * GPS, permission denied, nothing within the wait), so a tap is never lost:
 * it's saved without a location and flagged for the Admin.
 */
export function getPhoneLocation(maxWaitMs = 10000): Promise<AttendanceInput["location"]> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    let best: GeolocationPosition | null = null;
    let done = false;
    let watchId: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function finish() {
      if (done) return;
      done = true;
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      resolve(
        best && {
          lat: best.coords.latitude,
          lng: best.coords.longitude,
          accuracyM: Number.isFinite(best.coords.accuracy) ? best.coords.accuracy : null,
        },
      );
    }

    timer = setTimeout(finish, maxWaitMs);
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (!best || position.coords.accuracy < best.coords.accuracy) best = position;
        if (best.coords.accuracy <= GOOD_ACCURACY_M) finish();
      },
      // Denied won't change by waiting; a missing fix might, so keep listening.
      (error) => {
        if (error.code === error.PERMISSION_DENIED) finish();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxWaitMs },
    );
    if (done && watchId !== undefined) navigator.geolocation.clearWatch(watchId);
  });
}
