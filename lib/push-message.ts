import type { Notification } from "@/lib/kova-api";
import { notificationTarget, type ScheduleLookup } from "@/lib/notification-target";

/** What public/sw.js shows: the notification, and the page a tap opens. */
export type PushMessage = { title: string; body: string; url: string; tag?: string };

/**
 * A bell notification as a phone notification: same text, and a tap lands
 * where clicking it in the bell would. The tag keeps a resend from showing twice.
 */
export function pushMessage(
  notification: Pick<Notification, "id" | "type" | "message" | "relatedRequestId" | "relatedScheduleId">,
  findSchedule: ScheduleLookup,
  role: string,
): PushMessage {
  return {
    title: "KOVA",
    body: notification.message,
    url: notificationTarget(notification, findSchedule, role) ?? "/home",
    tag: notification.id,
  };
}

/** Catching up after sign-in: unread notifications from at most this long ago… */
export const CATCH_UP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** …and at most this many; more become one "You have N new notifications". */
export const CATCH_UP_LIMIT = 3;

type CatchUpNotification = Parameters<typeof pushMessage>[0] & { createdAt: string };

/**
 * What a device shows on signing back in for what arrived while it was
 * paused (0071), oldest first so the newest ends up on top.
 */
export function catchUpMessages(unread: CatchUpNotification[], findSchedule: ScheduleLookup, role: string): PushMessage[] {
  if (unread.length > CATCH_UP_LIMIT) {
    return [{ title: "KOVA", body: `You have ${unread.length} new notifications.`, url: "/home", tag: "catch-up" }];
  }
  return [...unread]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((notification) => pushMessage(notification, findSchedule, role));
}

/** The test a person sends themselves from the Phone notifications dialog. */
export const testPushMessage: PushMessage = {
  title: "KOVA",
  body: "Phone notifications work on this device.",
  url: "/home",
};

/** The push service's answer for a device that has gone for good (unsubscribed, expired, uninstalled). */
export const deviceGone = (statusCode: number | undefined) => statusCode === 404 || statusCode === 410;
