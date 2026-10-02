import type {
  Account,
  CancellationRequest,
  ProblemReport,
  Schedule,
  TransportRequest,
  TripCompletion,
} from "@/lib/kova-api";
import { addDays, hasTripEnded, manilaToday } from "@/lib/timezone";
import { scheduleState } from "@/lib/trip-record";

export type HomeCardKey = "my-requests" | "create-schedule" | "schedules" | "my-schedule" | "finished";

export type HomeData = {
  requests: TransportRequest[];
  schedules: Schedule[];
  cancellations: CancellationRequest[];
  completions: TripCompletion[];
  problems: ProblemReport[];
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * A short line of waiting work for each Home card, so a person sees what
 * needs them without opening every screen. Every count comes from data the
 * app already holds; a card with nothing waiting says so.
 */
export function homeCounts(account: Account, data: HomeData, now: Date = new Date()): Partial<Record<HomeCardKey, string>> {
  const today = manilaToday(now);
  const counts: Partial<Record<HomeCardKey, string>> = {};

  if (account.role === "Requester" || account.role === "Admin") {
    const open = data.requests.filter(
      (request) =>
        request.ownerAccountId === account.id &&
        request.status === "ACTIVE" &&
        request.progress !== "COMPLETED" &&
        request.progress !== "DONE",
    );
    const unscheduled = open.filter((request) => request.progress === "NOT_YET_SCHEDULED").length;
    const sentBack = open.filter((request) => request.progress === "SENT_BACK").length;
    counts["my-requests"] = open.length
      ? [
          `${open.length} open`,
          unscheduled ? `${unscheduled} not yet scheduled` : "",
          sentBack ? `${sentBack} sent back` : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "No open requests";
  }

  if (account.role === "Scheduler") {
    const waiting = data.requests.filter(
      (request) => request.status === "ACTIVE" && request.progress === "NOT_YET_SCHEDULED" && request.date >= today,
    ).length;
    counts["create-schedule"] = waiting ? `${plural(waiting, "request")} waiting to be scheduled` : "No requests waiting";

    const states = data.schedules.map(scheduleState);
    const returned = states.filter((state) => state === "RETURNED").length;
    const toFinish = states.filter((state) => state === "DRAFT").length + returned;
    counts["schedules"] = toFinish
      ? [`${toFinish} to finish`, returned ? `${returned} returned by Admin` : ""].filter(Boolean).join(" · ")
      : "Nothing to finish";
  }

  if (account.role === "Admin") {
    const toApprove = data.schedules.filter((schedule) => scheduleState(schedule) === "SUBMITTED").length;
    const cancellations = data.cancellations.filter((item) => item.status === "PENDING").length;
    const parts = [
      toApprove ? `${toApprove} to approve` : "",
      cancellations ? plural(cancellations, "cancellation request") : "",
    ].filter(Boolean);
    counts["schedules"] = parts.length ? parts.join(" · ") : "Nothing waiting";

    const toClose = data.completions.filter((item) => item.status === "SUBMITTED").length;
    const problems = data.problems.filter((item) => item.status === "OPEN").length;
    const closing = [toClose ? `${toClose} to close` : "", problems ? plural(problems, "open problem") : ""].filter(Boolean);
    counts["finished"] = closing.length ? closing.join(" · ") : "Nothing waiting";
  }

  if (account.role === "Driver") {
    const trips = data.schedules
      .filter((schedule) => schedule.status === "ACTIVE")
      .flatMap((schedule) => {
        const revision = schedule.revisions.find((item) => item.id === schedule.publishedRevisionId);
        if (!revision || revision.driverId !== account.id) return [];
        if (data.completions.some((item) => item.scheduleId === schedule.id)) return [];
        const lastIn = revision.legs[revision.legs.length - 1]?.plannedTimeIn ?? "";
        return [{ date: schedule.date, ended: hasTripEnded(schedule.date, lastIn, now) }];
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    const ready = trips.filter((trip) => trip.ended).length;
    const next = trips.find((trip) => !trip.ended);
    const when = (date: string) =>
      date === today
        ? "today"
        : date === addDays(today, 1)
          ? "tomorrow"
          : new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const parts = [ready ? `${ready} ready to complete` : "", next ? `Next trip ${when(next.date)}` : ""].filter(Boolean);
    counts["my-schedule"] = parts.length ? parts.join(" · ") : "No upcoming trips";
  }

  return counts;
}
