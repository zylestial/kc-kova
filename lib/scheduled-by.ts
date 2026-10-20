import type { Account, Schedule, ScheduleRevision } from "@/lib/kova-api";
import { currentRevision } from "@/lib/trip-record";

/**
 * Who planned a trip version: "Drafted by" while it's a draft (or returned
 * to one), "Scheduled by" once submitted, naming who submitted it. Null
 * when the account isn't known.
 */
export function scheduledBy(revision: ScheduleRevision | undefined, accounts: Account[]) {
  if (!revision) return null;
  const drafting = revision.status === "DRAFT" || revision.status === "RETURNED";
  const id = drafting ? revision.createdByAccountId : (revision.submittedByAccountId ?? revision.createdByAccountId);
  const name = accounts.find((account) => account.id === id)?.name;
  return name ? { label: drafting ? "Drafted by" : "Scheduled by", name } : null;
}

/** Who planned the live trip a request is on, if it's on one. */
export function requestScheduledBy(requestId: string, schedules: Schedule[], accounts: Account[]) {
  for (const schedule of schedules) {
    if (schedule.status !== "ACTIVE") continue;
    const revision = currentRevision(schedule);
    if (revision?.requestIds.includes(requestId)) return scheduledBy(revision, accounts);
  }
  return null;
}
