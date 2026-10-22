import type { Notification, Schedule } from "@/lib/kova-api";
import { schedulingHref } from "@/lib/scheduling";

/** What a link needs to know about the schedule a notification names. */
export type ScheduleLookup = (id: string) => Pick<Schedule, "id" | "date" | "kind"> | undefined;

/**
 * Where opening a notification should land, per its type: from the bell
 * (app/notification-bell.tsx) and from a phone notification (/api/push/send).
 */
export function notificationTarget(
  notification: Pick<Notification, "type" | "relatedRequestId" | "relatedScheduleId">,
  findSchedule: ScheduleLookup,
  role: string,
): string | undefined {
  const { type, relatedRequestId, relatedScheduleId } = notification;
  switch (type) {
    case "REQUEST_SCHEDULED":
    case "REQUEST_RETURNED":
    case "REQUEST_SENT_BACK":
    case "REQUEST_SPLIT":
    case "REQUEST_MOVED":
    case "REQUEST_CANCELLED":
    case "CANCELLATION_DECLINED":
    case "STOP_MISSED":
      return relatedRequestId ? `/requests?open=${encodeURIComponent(relatedRequestId)}` : "/requests";
    case "CANCELLATION_REQUESTED":
      // The ask itself, with its Confirm and Decline.
      return relatedRequestId ? `/schedules?cancellation=${encodeURIComponent(relatedRequestId)}` : "/schedules#cancellations";
    case "SCHEDULE_SUBMITTED":
      return relatedScheduleId ? `/schedules?open=${encodeURIComponent(relatedScheduleId)}` : "/schedules";
    case "PROBLEM_REPORTED":
      return relatedScheduleId ? `/finished?open=${encodeURIComponent(relatedScheduleId)}` : "/finished";
    case "SCHEDULE_RETURNED": {
      // Fixed on Scheduling, opened on the schedule's day and kind.
      if (!relatedScheduleId) return "/schedules";
      const schedule = findSchedule(relatedScheduleId);
      return schedulingHref(schedule?.date, schedule?.kind, schedule?.id);
    }
    case "TRIP_PUBLISHED": {
      // A Company trip is driven from My Trips, whoever drives it (0079).
      const page = relatedScheduleId && findSchedule(relatedScheduleId)?.kind === "COMPANY" ? "/my-trips" : "/my-schedule";
      return relatedScheduleId ? `${page}?open=${encodeURIComponent(relatedScheduleId)}` : page;
    }
    case "STOP_REPORTED": {
      // A Scheduler handles it on Scheduling; an Admin sees it with the trip's problems.
      if (!relatedScheduleId) return role === "Scheduler" ? "/scheduling" : "/finished";
      if (role !== "Scheduler") return `/finished?open=${encodeURIComponent(relatedScheduleId)}`;
      const schedule = findSchedule(relatedScheduleId);
      return schedulingHref(schedule?.date, schedule?.kind, schedule?.id);
    }
    case "TRIP_CHANGED":
    case "STOP_ANSWERED": {
      // A Company trip is recorded on My Trips (0079); a Driver's Daily trip on My Schedule.
      const company = !!relatedScheduleId && findSchedule(relatedScheduleId)?.kind === "COMPANY";
      const page = company || role !== "Driver" ? "/my-trips" : "/my-schedule";
      return relatedScheduleId ? `${page}?open=${encodeURIComponent(relatedScheduleId)}` : page;
    }
    default:
      return undefined;
  }
}
