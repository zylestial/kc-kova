import type { Schedule, ScheduleInput, ScheduleRevision } from "@/lib/kova-api";
import { openRevision, publishedRevision } from "@/lib/trip-record";
import type { TripKind } from "@/lib/scheduling";

/**
 * Undo on the Scheduling page (prototype "Undo"): before a change to a
 * trip, what its open version was; undoing puts that back. Every change is
 * a real save, so undoing is another save: the old version saved again, a
 * new draft discarded, or a discarded one made again. Moved "any day that
 * week" stops go back to the day they were asked for. Submit and sending a
 * stop back to its requester can't be undone; they clear the list.
 */

export type UndoEntry = {
  scheduleId: string;
  kind: TripKind;
  /** The open version before the change; null when there was none (a new trip, or an approved one). */
  input: ScheduleInput | null;
  /** "Any day that week" stops moved to this day, with the day they were asked for. */
  moves: Array<{ id: string; from: string }>;
};

/** What save_schedule_draft takes to save this version again. */
export function revisionInput(date: string, revision: ScheduleRevision): ScheduleInput {
  return {
    date,
    plate: revision.plate,
    requestIds: revision.requestIds,
    legs: revision.legs.map((leg) => ({
      destinationId: leg.isFinal ? undefined : leg.destinationId,
      plannedTimeOut: leg.plannedTimeOut,
      plannedTimeIn: leg.plannedTimeIn,
      contactName: leg.contactName,
      contactNumber: leg.contactNumber,
      stops: leg.isFinal ? [] : leg.stops,
      isFinal: leg.isFinal,
    })),
  };
}

/** A trip's undo entry, taken just before a change to it. */
export function undoEntry(schedule: Schedule, kind: TripKind, moves: UndoEntry["moves"] = []): UndoEntry {
  const open = openRevision(schedule);
  return { scheduleId: schedule.id, kind, input: open ? revisionInput(schedule.date, open) : null, moves };
}

export type UndoStep =
  | { action: "discard"; id: string; rowVersion: number }
  | { action: "save"; id: string; rowVersion: number | null; input: ScheduleInput }
  | { action: "create"; kind: TripKind; input: ScheduleInput }
  | { action: "none" };

/** The save that puts an entry's version back, given the trip as it is now (gone when it was discarded). */
export function undoStep(entry: UndoEntry, now: Schedule | undefined): UndoStep {
  const current = now?.status === "ACTIVE" ? now : undefined;
  const open = current && openRevision(current);
  if (!entry.input) return current && open ? { action: "discard", id: current.id, rowVersion: open.rowVersion } : { action: "none" };
  if (current && open) return { action: "save", id: current.id, rowVersion: open.rowVersion, input: entry.input };
  // An approved trip whose draft changes were discarded: open them again.
  if (current && publishedRevision(current)) return { action: "save", id: current.id, rowVersion: null, input: entry.input };
  return { action: "create", kind: entry.kind, input: entry.input };
}
