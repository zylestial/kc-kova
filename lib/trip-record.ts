import type { Schedule, StopFlexibility, TransportRequest } from "@/lib/kova-api";

/**
 * Trip Record basics the screens share: limits, a schedule's versions and
 * state, and a request's stops. The Scheduling page's own rules are in
 * lib/scheduling*.ts; the database stays the authority on saves.
 */

/** Rows on the printed Daily Vehicle Record, final leg included. */
export const MAX_LEGS = 8;
export const BASE = "ANONANG";

/** One destination of one request: a stop a leg can serve. */
export type StopInfo = {
  id: string;
  requestId: string;
  requester: string;
  destinationId?: string;
  destinationName: string;
  destinationIsOther: boolean;
  purposeName: string;
  /** The request is Urgent, so the Scheduler places it before Regular ones. */
  urgent?: boolean;
  /** "52-A" for a stop of a request group (0052); "" before groups. */
  stopNumber?: string;
  urgentReason?: string;
  details?: string;
  flexibility?: StopFlexibility;
  fixedTime?: string;
  contact?: string;
};

export type ScheduleState = "DRAFT" | "RETURNED" | "SUBMITTED" | "APPROVED" | "CANCELLED";

export const scheduleStateLabel: Record<ScheduleState, string> = {
  DRAFT: "Draft",
  RETURNED: "Returned",
  SUBMITTED: "Waiting for approval",
  APPROVED: "Approved",
  CANCELLED: "Cancelled",
};

// Reuses the existing status-pill colours.
export const scheduleStatePill: Record<ScheduleState, string> = {
  DRAFT: "pending",
  RETURNED: "rejected",
  SUBMITTED: "pending",
  APPROVED: "scheduled",
  CANCELLED: "cancelled",
};

export function stopsFor(requests: TransportRequest[]): StopInfo[] {
  return requests.flatMap((request) =>
    request.destinations.map((destination) => ({
      id: destination.id,
      requestId: request.id,
      requester: request.ownerName,
      destinationId: destination.destinationId,
      destinationName: destination.destinationName,
      destinationIsOther: destination.destinationIsOther,
      purposeName: destination.purposeName,
      urgent: request.requestType === "URGENT",
      stopNumber: request.group ? `${request.group.number}-${request.stopLetter}` : "",
      urgentReason: request.urgentReason?.name,
      details: request.details,
      flexibility: request.flexibility,
      fixedTime: request.fixedTime,
      contact: request.contact,
    })),
  );
}

export const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** The reservation a set of legs would take: first Time Out to last Time In. */
export function tripWindow(legs: { plannedTimeOut: string; plannedTimeIn: string }[]): { start: string; end: string } | null {
  if (!legs.length || legs.some((leg) => !validTime(leg.plannedTimeOut) || !validTime(leg.plannedTimeIn))) return null;
  return { start: legs[0].plannedTimeOut, end: legs.at(-1)!.plannedTimeIn };
}

export const openRevision = (schedule: Schedule) =>
  schedule.revisions.find((revision) => ["DRAFT", "SUBMITTED", "RETURNED"].includes(revision.status));
export const publishedRevision = (schedule: Schedule) =>
  schedule.revisions.find((revision) => revision.id === schedule.publishedRevisionId);
/** The version a Scheduler works from: the open one if any, else the published one. */
export const currentRevision = (schedule: Schedule) => openRevision(schedule) ?? publishedRevision(schedule);

export function scheduleState(schedule: Schedule): ScheduleState {
  if (schedule.status === "CANCELLED") return "CANCELLED";
  const open = openRevision(schedule);
  if (open) return open.status as ScheduleState;
  return "APPROVED";
}
