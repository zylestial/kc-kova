import { refreshNotifications } from "@/lib/kova-api";
import { watchLiveNotifications } from "@/lib/notifications-live";

/** How often the bell rechecks while the tab is visible and Realtime is down. */
export const NOTIFICATION_POLL_MS = 300_000;
/** The same while Realtime is working, as a backup for anything it misses. */
export const LIVE_NOTIFICATION_POLL_MS = 900_000;
const TICK_MS = 60_000;

/** Whether the bell's regular check is due. */
export function pollDue(live: boolean, lastCheckedAt: number, now: number) {
  return now - lastCheckedAt >= (live ? LIVE_NOTIFICATION_POLL_MS : NOTIFICATION_POLL_MS);
}

/**
 * Keeps the bell current by refetching GET /api/notifications when Realtime
 * says something's new (lib/notifications-live.ts), on a slower regular check
 * while the tab is visible, and straight away when the tab comes back into
 * view. A hidden tab makes no requests. Returns a function that stops it (on
 * sign-out).
 */
export function watchNotifications(): () => void {
  if (typeof window === "undefined") return () => {};

  let live = false;
  let lastCheckedAt = Date.now();

  const check = () => {
    if (document.visibilityState !== "visible") return;
    lastCheckedAt = Date.now();
    void refreshNotifications().catch(() => {});
  };
  const tick = () => {
    if (pollDue(live, lastCheckedAt, Date.now())) check();
  };
  const timer = window.setInterval(tick, TICK_MS);
  document.addEventListener("visibilitychange", check);
  const stopLive = watchLiveNotifications(check, (next) => {
    live = next;
  });

  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", check);
    stopLive();
  };
}
