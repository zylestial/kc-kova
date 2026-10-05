import type { Account } from "@/lib/kova-api";
import type { HomeData } from "@/lib/home-counts";
import { hasTripEnded, manilaToday } from "@/lib/timezone";
import { scheduleState } from "@/lib/trip-record";

export type StatTone = "info" | "success" | "warning" | "error";
export type HomeStat = { label: string; value: number; tone: StatTone };

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
      { label: "Open requests", value: open.length, tone: "info" },
      { label: "Not yet scheduled", value: unscheduled, tone: "warning" },
      { label: "Sent back", value: sentBack, tone: "error" },
      { label: "Scheduled", value: open.length - unscheduled - sentBack, tone: "success" },
    ];
  }

  if (role === "Scheduler") {
    const waiting = data.requests.filter(
      (request) => request.status === "ACTIVE" && request.progress === "NOT_YET_SCHEDULED" && request.date >= today,
    ).length;
    const states = data.schedules.map(scheduleState);
    const tripsToday = data.schedules.filter(
      (schedule) => schedule.status === "ACTIVE" && schedule.publishedRevisionId && schedule.date === today,
    ).length;
    return [
      { label: "Waiting to be scheduled", value: waiting, tone: "warning" },
      { label: "Drafts to finish", value: states.filter((state) => state === "DRAFT").length, tone: "info" },
      { label: "Returned by Admin", value: states.filter((state) => state === "RETURNED").length, tone: "error" },
      { label: "Trips today", value: tripsToday, tone: "success" },
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
        return [{ date: schedule.date, ended: hasTripEnded(schedule.date, lastIn, now) }];
      });
    return [
      { label: "Trips today", value: trips.filter((trip) => !trip.ended && trip.date === today).length, tone: "info" },
      { label: "Upcoming trips", value: trips.filter((trip) => !trip.ended && trip.date > today).length, tone: "success" },
      { label: "Ready to complete", value: trips.filter((trip) => trip.ended).length, tone: "warning" },
    ];
  }

  return [
    {
      label: "Schedules to approve",
      value: data.schedules.filter((schedule) => scheduleState(schedule) === "SUBMITTED").length,
      tone: "warning",
    },
    {
      label: "Cancellation requests",
      value: data.cancellations.filter((item) => item.status === "PENDING").length,
      tone: "warning",
    },
    { label: "Trips to close", value: data.completions.filter((item) => item.status === "SUBMITTED").length, tone: "info" },
    { label: "Open problems", value: data.problems.filter((item) => item.status === "OPEN").length, tone: "error" },
  ];
}
