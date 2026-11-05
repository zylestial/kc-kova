import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

type LiveAccess = { url: string; key: string; token: string; expiresAt: number; accountId: string };

/** Several notifications made by one action count as one change. */
const CHANGE_DELAY_MS = 500;
/** A new token is fetched this long before the old one expires. */
const RENEW_BEFORE_MS = 60_000;
/** How long to wait before trying again after a failed token request. */
const RETRY_MS = 60_000;

/** When to fetch the next token: shortly before expiry, and never right away in a loop. */
export function renewDelay(expiresAtSeconds: number, now: number) {
  return Math.max(expiresAtSeconds * 1000 - now - RENEW_BEFORE_MS, RETRY_MS);
}

async function fetchAccess(): Promise<LiveAccess> {
  const response = await fetch("/api/notifications/live", { cache: "no-store" });
  if (!response.ok) throw Error(`Live access failed: ${response.status}`);
  return response.json();
}

/**
 * Tells onChange when this account gets a notification, and onLive whether
 * that's working. It carries only the signal: the bell still reads through
 * GET /api/notifications. Any failure leaves onLive(false), and the regular
 * check (lib/notifications-poll.ts) keeps the bell current. Returns a function
 * that stops it.
 */
export function watchLiveNotifications(onChange: () => void, onLive: (live: boolean) => void): () => void {
  let stopped = false;
  let client: SupabaseClient | undefined;
  let channel: RealtimeChannel | undefined;
  let renewTimer: number | undefined;
  let changeTimer: number | undefined;

  const signalChange = () => {
    window.clearTimeout(changeTimer);
    changeTimer = window.setTimeout(onChange, CHANGE_DELAY_MS);
  };

  const renew = async () => {
    if (stopped) return;
    try {
      const access = await fetchAccess();
      if (stopped) return;
      if (!client) await connect(access);
      else await client.realtime.setAuth(access.token);
      renewTimer = window.setTimeout(renew, renewDelay(access.expiresAt, Date.now()));
    } catch {
      if (stopped) return;
      onLive(false);
      renewTimer = window.setTimeout(renew, RETRY_MS);
    }
  };

  const connect = async (access: LiveAccess) => {
    // Loaded only here, so the first page load doesn't carry it.
    const { createClient } = await import("@supabase/supabase-js");
    if (stopped) return;
    client = createClient(access.url, access.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    await client.realtime.setAuth(access.token);
    channel = client
      .channel(`notifications:${access.accountId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `account_id=eq.${access.accountId}` },
        signalChange,
      )
      .subscribe((status) => {
        if (stopped) return;
        const live = status === "SUBSCRIBED";
        onLive(live);
        // Back after a gap: catch up on anything sent during it.
        if (live) signalChange();
      });
  };

  void renew();

  return () => {
    stopped = true;
    window.clearTimeout(renewTimer);
    window.clearTimeout(changeTimer);
    onLive(false);
    if (client && channel) void client.removeChannel(channel);
    client?.realtime.disconnect();
  };
}
