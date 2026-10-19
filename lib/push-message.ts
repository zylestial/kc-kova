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

/** The test a person sends themselves from the Phone notifications dialog. */
export const testPushMessage: PushMessage = {
  title: "KOVA",
  body: "Phone notifications work on this device.",
  url: "/home",
};

/** The push service's answer for a device that has gone for good (unsubscribed, expired, uninstalled). */
export const deviceGone = (statusCode: number | undefined) => statusCode === 404 || statusCode === 410;
