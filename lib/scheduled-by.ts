import type { Account, Schedule, ScheduleRevision } from "@/lib/kova-api";
import { currentRevision, openRevision } from "@/lib/trip-record";

const drafting = (revision: ScheduleRevision) => revision.status === "DRAFT" || revision.status === "RETURNED";

/** The drafter of a draft (or returned) version; once submitted, who submitted it. */
const plannerId = (revision: ScheduleRevision) =>
  drafting(revision) ? revision.createdByAccountId : (revision.submittedByAccountId ?? revision.createdByAccountId);

/**
 * Who planned a trip version: "Drafted by" while it's a draft (or returned
 * to one), "Scheduled by" once submitted, naming who submitted it. Null
 * when the account isn't known.
 */
export function scheduledBy(revision: ScheduleRevision | undefined, accounts: Account[]) {
  if (!revision) return null;
  const name = accounts.find((account) => account.id === plannerId(revision))?.name;
  return name ? { label: drafting(revision) ? "Drafted by" : "Scheduled by", name } : null;
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

/**
 * The question to ask before changing a trip someone else is planning:
 * its open version was drafted (or submitted) by another account. Null
 * when it's yours, there's no open version, or the planner isn't known.
 */
export function othersDraftQuestion(schedule: Schedule, meId: string | undefined, accounts: Account[]) {
  const open = openRevision(schedule);
  if (!open || !meId || plannerId(open) === meId) return null;
  const by = scheduledBy(open, accounts);
  if (!by) return null;
  return drafting(open) ? `${by.name} is drafting this trip. Edit anyway?` : `${by.name} scheduled this trip. Edit anyway?`;
}

/**
 * Who cancelled a trip and when, e.g. { name: "Liza", at: "Nov 26, 2026,
 * 3:40 PM" } (Manila time). Null unless it's cancelled.
 */
export function cancelledBy(
  schedule: Pick<Schedule, "status" | "cancelledAt" | "cancelledByAccountId"> | null | undefined,
  accounts: Pick<Account, "id" | "name">[],
): { name: string; at: string } | null {
  if (schedule?.status !== "CANCELLED") return null;
  const name = accounts.find((account) => account.id === schedule.cancelledByAccountId)?.name ?? "an Admin";
  const at = schedule.cancelledAt
    ? new Date(schedule.cancelledAt).toLocaleString("en-US", {
        timeZone: "Asia/Manila",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  return { name, at };
}
