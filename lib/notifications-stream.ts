import { refreshNotifications } from "@/lib/kova-api";

const apiBase = (process.env.NEXT_PUBLIC_KOVA_API_BASE_URL || "").replace(/\/$/, "");

/**
 * Opens a live connection to app/api/notifications/stream (Server-Sent
 * Events, not Supabase Realtime -- see that route's comment) and refetches
 * the notification list whenever it says something new arrived. The stream
 * closes itself periodically (serverless function limits); EventSource
 * reconnects on its own, so callers don't need to.
 */
export function watchNotifications(): () => void {
  if (typeof window === "undefined") return () => {};

  let source: EventSource | null = new EventSource(`${apiBase}/api/notifications/stream`);
  source.addEventListener("new-notifications", () => {
    void refreshNotifications().catch(() => {});
  });

  return () => {
    source?.close();
    source = null;
  };
}
