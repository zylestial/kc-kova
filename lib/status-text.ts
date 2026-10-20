import type { RequestProgress, TripCompletion } from "@/lib/kova-api";
import type { ScheduleState } from "@/lib/trip-record";

/**
 * One glossary for the words people see next to a status, with a plain
 * sentence saying what it means and what happens next. Screens use these
 * instead of writing their own, so the same state is never called two things.
 */

export const requestProgressLabel: Record<RequestProgress, string> = {
  NOT_YET_SCHEDULED: "Not yet scheduled",
  SENT_BACK: "Sent back",
  SCHEDULING: "Being scheduled",
  PENDING_APPROVAL: "Waiting for approval",
  APPROVED: "Approved",
  COMPLETED: "Waiting for review",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

export const requestProgressMeaning: Record<RequestProgress, string> = {
  NOT_YET_SCHEDULED: "A Scheduler hasn't planned this trip yet.",
  SENT_BACK: "The Scheduler sent this back. Fix it or move it to another day, then save to send it again. Or cancel it.",
  SCHEDULING: "A Scheduler is planning this trip.",
  PENDING_APPROVAL: "The plan is ready and waiting for an Admin to approve it.",
  APPROVED: "The trip is planned and approved. The Driver will make it on the day.",
  COMPLETED: "The trip is finished. An Admin is checking the Driver's odometer readings.",
  DONE: "The trip is finished and an Admin has checked it.",
  CANCELLED: "This request was cancelled.",
};

export const scheduleStateMeaning: Record<ScheduleState, string> = {
  DRAFT: "A Scheduler is still planning this.",
  RETURNED: "An Admin sent this back for changes. The Scheduler needs to fix it and submit it again.",
  SUBMITTED: "Waiting for an Admin to approve it. The Driver can't see it yet.",
  APPROVED: "Approved. The Driver can see it and will make the trip.",
  CANCELLED: "This schedule was cancelled.",
};

export const completionLabel: Record<TripCompletion["status"], string> = {
  SUBMITTED: "Waiting for review",
  DONE: "Done",
};

export const completionMeaning: Record<TripCompletion["status"], string> = {
  SUBMITTED: "The Driver has submitted the odometer readings. An Admin reviews them, then marks the trip Done.",
  DONE: "An Admin has checked this trip and marked it Done.",
};
