import type { Account } from "@/lib/kova-api";
import { tripOver, type HomeData } from "@/lib/home-counts";
import { manilaToday } from "@/lib/timezone";
import { scheduleState } from "@/lib/trip-record";

export type StatTone = "info" | "success" | "warning" | "error";
/** What each tile counts, so each has its own icon (the bell's, where the bell has that event). */
export type StatIcon =
  | "requests"
  | "waiting"
  | "sentBack"
  | "scheduled"
  | "draft"
  | "returned"
  | "trips"
  | "upcoming"
  | "complete"
  | "approve"
  | "cancellation"
  | "close"
  | "problem";
// `href` is the screen where that work gets done, filtered to what the tile
// counts where that screen has a matching filter.
export type HomeStat = { label: string; value: number; tone: StatTone; icon: StatIcon; href: string };

/**
 * The numbers across the top of the Dashboard for the role being shown.
 * Tones mark what needs attention (warning) or is going wrong (error); the
 * screen shows a zero in neutral grey whatever its tone. `driverId` null
 * counts every driver's trips (Admin viewing as Driver).
 */
export function homeStats(
  role: Account["role"],
  accountId: string,
  data: HomeData,
  now: Date = new Date(),
  driverId: string | null = accountId,
): HomeStat[] {
  const today = manilaToday(now);

  if (role === "Requester") {
    const open = data.requests.filter(
      (request) =>
        request.ownerAccountId === accountId &&
        request.status === "ACTIVE" &&
        request.progress !== "COMPLETED" &&
        request.progress !== "DONE",
    );
    const unscheduled = open.filter((request) => request.progress === "NOT_YET_SCHEDULED").length;
    const sentBack = open.filter((request) => request.progress === "SENT_BACK").length;
    return [
      { label: "Open requests", href: "/requests", value: open.length, tone: "info", icon: "requests" },
      { label: "Not yet scheduled", href: "/requests?progress=NOT_YET_SCHEDULED", value: unscheduled, tone: "warning", icon: "waiting" },
      { label: "Sent back", href: "/requests?progress=SENT_BACK", value: sentBack, tone: "error", icon: "sentBack" },
      { label: "Scheduled", href: "/requests", value: open.length - unscheduled - sentBack, tone: "success", icon: "scheduled" },
    ];
  }

  // Finance's tiles come with its read-only screens.
  if (role === "Finance") return [];

  if (role === "Scheduler") {
    const waiting = data.requests.filter(
      (request) => request.status === "ACTIVE" && request.progress === "NOT_YET_SCHEDULED" && request.date >= today,
    ).length;
    const states = data.schedules.map(scheduleState);
    const tripsToday = data.schedules.filter(
      (schedule) => schedule.status === "ACTIVE" && schedule.publishedRevisionId && schedule.date === today,
    ).length;
    return [
      { label: "Waiting to be scheduled", href: "/scheduling", value: waiting, tone: "warning", icon: "waiting" },
      { label: "Drafts to finish", href: "/schedules?status=DRAFT", value: states.filter((state) => state === "DRAFT").length, tone: "info", icon: "draft" },
      { label: "Returned by Admin", href: "/schedules?status=RETURNED", value: states.filter((state) => state === "RETURNED").length, tone: "error", icon: "returned" },
      { label: "Trips today", href: "/schedules?view=day", value: tripsToday, tone: "success", icon: "trips" },
    ];
  }

  if (role === "Driver") {
    const trips = data.schedules
      .filter((schedule) => schedule.status === "ACTIVE")
      .flatMap((schedule) => {
        const revision = schedule.revisions.find((item) => item.id === schedule.publishedRevisionId);
        if (!revision || (driverId !== null && revision.driverId !== driverId)) return [];
        if (data.completions.some((item) => item.scheduleId === schedule.id)) return [];
        const lastIn = revision.legs[revision.legs.length - 1]?.plannedTimeIn ?? "";
        return [{ date: schedule.date, ended: tripOver(data, schedule, lastIn, now) }];
      });
    return [
      { label: "Trips today", href: "/my-schedule", value: trips.filter((trip) => !trip.ended && trip.date === today).length, tone: "info", icon: "trips" },
      { label: "Upcoming trips", href: "/my-schedule", value: trips.filter((trip) => !trip.ended && trip.date > today).length, tone: "success", icon: "upcoming" },
      { label: "Ready to complete", href: "/my-schedule", value: trips.filter((trip) => trip.ended).length, tone: "warning", icon: "complete" },
    ];
  }

  return [
    {
      label: "Schedules to approve",
      href: "/schedules?status=SUBMITTED",
      value: data.schedules.filter((schedule) => scheduleState(schedule) === "SUBMITTED").length,
      tone: "warning",
      icon: "approve",
    },
    {
      label: "Cancellation requests",
      href: "/schedules#cancellations",
      value: data.cancellations.filter((item) => item.status === "PENDING").length,
      tone: "warning",
      icon: "cancellation",
    },
    { label: "Trips to close", href: "/finished?status=SUBMITTED", value: data.completions.filter((item) => item.status === "SUBMITTED").length, tone: "info", icon: "close" },
    { label: "Open problems", href: "/finished?problems=open", value: data.problems.filter((item) => item.status === "OPEN").length, tone: "error", icon: "problem" },
  ];
}
