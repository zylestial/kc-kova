import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CATCH_UP_WINDOW_MS,
  catchUpMessages,
  deviceGone,
  pushFailure,
  vapidSubject,
  type PushMessage,
} from "@/lib/push-message";

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
    // Push services contact this address if KOVA's pushes misbehave. Vercel
    // sets VERCEL_PROJECT_PRODUCTION_URL, the site's own host, as a fallback.
    const site = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const fallback = site ? `https://${site}` : "mailto:kova@kayelen.invalid";
    webpush.setVapidDetails(vapidSubject(process.env.VAPID_SUBJECT, fallback), publicKey, privateKey);
    configured = true;
  }
  return true;
}

type Device = { endpoint: string; p256dh: string; auth: string };

/**
 * Sends each message, in order, to each device, and forgets the devices the
 * push service says are gone. Needs the service-role client
 * (lib/supabase/admin.ts): push_subscriptions has no policy for writes.
 */
async function sendToDevices(admin: SupabaseClient, devices: Device[], messages: PushMessage[]) {
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(
    devices.map(async (device) => {
      for (const message of messages) {
        try {
          await webpush.sendNotification(
            { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
            JSON.stringify(message),
            { TTL: TIME_TO_LIVE_S, urgency: "high" },
          );
          sent++;
        } catch (caught) {
          if (deviceGone((caught as { statusCode?: number }).statusCode)) {
            gone.push(device.endpoint);
            return;
          }
          console.error("Push failed", pushFailure(caught, device.endpoint));
        }
      }
    }),
  );

  if (gone.length) {
    const { error } = await admin.from("push_subscriptions").delete().in("endpoint", gone);
    if (error) console.error("Could not forget gone devices", error.message);
  }
  return { sent, removed: gone.length };
}

/** One phone notification to every device of an account, except paused ones (0071). */
export async function sendToAccount(admin: SupabaseClient, accountId: string, message: PushMessage) {
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("account_id", accountId)
    .is("paused_at", null);
  if (error) throw Error(error.message);
  return sendToDevices(admin, data ?? [], [message]);
}

/** One phone notification to a single device of an account, if it isn't paused. */
export async function sendToDevice(admin: SupabaseClient, accountId: string, endpoint: string, message: PushMessage) {
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("account_id", accountId)
    .eq("endpoint", endpoint)
    .is("paused_at", null);
  if (error) throw Error(error.message);
  return sendToDevices(admin, data ?? [], [message]);
}

/**
 * A device just signed back in (0071): sends it the account's unread
 * notifications from while it was paused, within the catch-up window.
 */
export async function catchUpDevice(admin: SupabaseClient, accountId: string, role: string, endpoint: string, pausedAt: string) {
  const since = new Date(Math.max(new Date(pausedAt).getTime(), Date.now() - CATCH_UP_WINDOW_MS)).toISOString();
  const [{ data: device, error: deviceError }, { data: unread, error: unreadError }] = await Promise.all([
    admin.from("push_subscriptions").select("endpoint, p256dh, auth").eq("endpoint", endpoint).eq("account_id", accountId).maybeSingle(),
    admin
      .from("notifications")
      .select("id, type, message, related_request_id, related_schedule_id, created_at")
      .eq("account_id", accountId)
      .is("read_at", null)
      .gt("created_at", since),
  ]);
  if (deviceError) throw Error(deviceError.message);
  if (unreadError) throw Error(unreadError.message);
  if (!device || !unread?.length) return { sent: 0, removed: 0 };

  // Only some links need the schedule's day and kind (Scheduling).
  const scheduleIds = [...new Set(unread.map((row) => row.related_schedule_id).filter((id): id is string => !!id))];
  const { data: schedules, error: scheduleError } = scheduleIds.length
    ? await admin.from("schedules").select("id, schedule_date, kind").in("id", scheduleIds)
    : { data: [], error: null };
  if (scheduleError) throw Error(scheduleError.message);

  const messages = catchUpMessages(
    unread.map((row) => ({
      id: row.id,
      type: row.type,
      message: row.message,
      relatedRequestId: row.related_request_id ?? undefined,
      relatedScheduleId: row.related_schedule_id ?? undefined,
      createdAt: row.created_at,
    })),
    (id) => {
      const row = schedules?.find((item) => item.id === id);
      return row && { id: row.id, date: row.schedule_date, kind: row.kind ?? "DAILY" };
    },
    role,
  );
  return sendToDevices(admin, [device], messages);
}
