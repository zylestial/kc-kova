import type { AttendanceInput } from "@/lib/kova-api";

/**
 * Asks the phone for one fresh position (the browser shows its permission
 * prompt the first time). Resolves to null instead of failing when there's
 * no GPS, permission is denied or it takes longer than `timeoutMs`, so a tap
 * is never lost: it's saved without a location and flagged for the Admin.
 */
export function getPhoneLocation(timeoutMs = 15000): Promise<AttendanceInput["location"]> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );
  });
}
