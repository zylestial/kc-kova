import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deviceGone, type PushMessage } from "@/lib/push-message";

// A push the device can't take within a day is dropped, not shown late.
const TIME_TO_LIVE_S = 24 * 60 * 60;

let configured = false;

/**
 * True when this deployment has VAPID keys, so phone notifications can be
 * sent. Without them push is simply off (the menu item hides too).
 */
export function pushConfigured() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  if (!configured) {
    // Push services contact this address if KOVA's pushes misbehave.
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:kova@kayelen.invalid", publicKey, privateKey);
    configured = true;
  }
  return true;
}

/**
 * Sends one phone notification to every device of an account, and forgets
 * the devices the push service says are gone. Needs the service-role client
 * (lib/supabase/admin.ts): push_subscriptions has no policy for writes.
 */
export async function sendToAccount(admin: SupabaseClient, accountId: string, message: PushMessage) {
  const { data, error } = await admin.from("push_subscriptions").select("endpoint, p256dh, auth").eq("account_id", accountId);
  if (error) throw Error(error.message);

  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    (data ?? []).map(async (device) => {
      try {
        await webpush.sendNotification(
          { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          JSON.stringify(message),
          { TTL: TIME_TO_LIVE_S, urgency: "high" },
        );
        sent++;
      } catch (caught) {
        if (deviceGone((caught as { statusCode?: number }).statusCode)) gone.push(device.endpoint);
        else console.error("Push failed", (caught as Error).message);
      }
    }),
  );

  if (gone.length) {
    const { error: removeError } = await admin.from("push_subscriptions").delete().in("endpoint", gone);
    if (removeError) console.error("Could not forget gone devices", removeError.message);
  }
  return { sent, removed: gone.length };
}
