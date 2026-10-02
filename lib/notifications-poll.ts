import { refreshNotifications } from "@/lib/kova-api";

/** How often the bell rechecks while the tab is visible. */
export const NOTIFICATION_POLL_MS = 30_000;

/**
 * Keeps the bell current by refetching GET /api/notifications every
 * NOTIFICATION_POLL_MS while the tab is visible, and straight away when the
 * tab comes back into view. A hidden tab makes no requests. Returns a
 * function that stops it (on sign-out).
 */
export function watchNotifications(): () => void {
  if (typeof window === "undefined") return () => {};

  const check = () => {
    if (document.visibilityState === "visible") void refreshNotifications().catch(() => {});
  };
  const timer = window.setInterval(check, NOTIFICATION_POLL_MS);
  document.addEventListener("visibilitychange", check);

  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", check);
  };
}
