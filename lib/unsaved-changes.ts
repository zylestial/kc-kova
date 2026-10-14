import { useEffect } from "react";
import type { LegDraft } from "@/lib/trip-record";

/**
 * Which screens hold work that would be lost if the person left. A screen
 * reports itself with useUnsavedChanges; the app shell asks hasUnsavedChanges
 * before it navigates away, and the browser asks before a refresh or close.
 */
const dirty = new Set<string>();

export function setUnsavedChanges(key: string, value: boolean) {
  if (value) dirty.add(key);
  else dirty.delete(key);
}

export const hasUnsavedChanges = () => dirty.size > 0;

export function useUnsavedChanges(key: string, value: boolean) {
  useEffect(() => {
    setUnsavedChanges(key, value);
    return () => setUnsavedChanges(key, false);
  }, [key, value]);
}

/** Whether a New request form holds anything the Requester entered. */
export function requestDraftHasContent(draft: {
  projectId: string;
  projectOther: string;
  vehiclePlate: string;
  destinations: Array<{ destinationId: string; destinationOther: string; purposeId: string; purposeOther: string }>;
}): boolean {
  return !!(
    draft.projectId ||
    draft.projectOther.trim() ||
    draft.vehiclePlate ||
    draft.destinations.some(
      (item) => item.destinationId || item.destinationOther.trim() || item.purposeId || item.purposeOther.trim(),
    )
  );
}

/**
 * A comparable fingerprint of a schedule being planned, ignoring the ids that
 * keep rows stable in React. A change since the last save means unsaved work.
 */
export function tripSignature(plate: string, requestIds: string[], legs: LegDraft[]): string {
  return JSON.stringify([
    plate,
    [...requestIds].sort(),
    legs.map((leg) => [
      leg.destinationId,
      leg.plannedTimeOut,
      leg.plannedTimeIn,
      leg.contactName,
      leg.contactNumber,
      leg.stops,
      leg.isFinal,
    ]),
  ]);
}
