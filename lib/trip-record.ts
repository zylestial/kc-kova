import type { Schedule, ScheduleInput, ScheduleRevision, TransportRequest } from "@/lib/kova-api";

/**
 * Trip Record planning rules the Scheduler's editor uses to guide input.
 * They mirror save_schedule_draft / submit_schedule, which stay the
 * authority: these only explain problems before a save is attempted.
 */

/** Rows on the printed Daily Vehicle Record, final leg included. */
export const MAX_LEGS = 8;
export const BASE = "ANONANG";

export type LegDraft = {
  key: string;
  /** "" until chosen; always "" on the final leg. */
  destinationId: string;
  plannedTimeOut: string;
  plannedTimeIn: string;
  contactName: string;
  contactNumber: string;
  /** Request destination ids served at this stop. */
  stops: string[];
  isFinal: boolean;
};

/** One destination of one request: a stop a leg can serve. */
export type StopInfo = {
  id: string;
  requestId: string;
  requester: string;
  destinationId: string;
  destinationName: string;
  purposeName: string;
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

let keySeed = 0;
const nextKey = () => `leg-${++keySeed}`;

export const newLeg = (): LegDraft => ({
  key: nextKey(),
  destinationId: "",
  plannedTimeOut: "",
  plannedTimeIn: "",
  contactName: "",
  contactNumber: "",
  stops: [],
  isFinal: false,
});

export const finalLeg = (): LegDraft => ({ ...newLeg(), isFinal: true });

/** The Time Out a new Trip Record starts with; the Scheduler can change it. */
export const START_TIME = "08:00";

/** A new Trip Record starts with one destination leg and the return leg to ANONANG. */
export const initialLegs = (): LegDraft[] => [{ ...newLeg(), plannedTimeOut: START_TIME }, finalLeg()];

export function stopsFor(requests: TransportRequest[]): StopInfo[] {
  return requests.flatMap((request) =>
    request.destinations.map((destination) => ({
      id: destination.id,
      requestId: request.id,
      requester: request.ownerName,
      destinationId: destination.destinationId,
      destinationName: destination.destinationName,
      purposeName: destination.purposeName,
    })),
  );
}

/** Leg 1 starts at ANONANG; every later leg starts where the previous one ended. */
export function legOrigins(legs: LegDraft[], destinationName: (id: string) => string): string[] {
  return legs.map((_, index) => {
    if (index === 0) return BASE;
    const previous = legs[index - 1];
    return previous.isFinal ? BASE : destinationName(previous.destinationId) || "—";
  });
}

export const hasFinal = (legs: LegDraft[]) => legs.some((leg) => leg.isFinal);
/** A destination leg fits while there is a free row; it goes in before the final leg. */
export const canAddLeg = (legs: LegDraft[]) => legs.length < MAX_LEGS;
/**
 * Adds a destination leg before the final leg (or at the end when there is
 * none). Its Time Out starts as the previous leg's Time In, when that is set.
 */
export function addLeg(legs: LegDraft[]): LegDraft[] {
  const at = legs.findIndex((leg) => leg.isFinal);
  const position = at === -1 ? legs.length : at;
  const previousIn = legs[position - 1]?.plannedTimeIn ?? "";
  const leg = { ...newLeg(), plannedTimeOut: validTime(previousIn) ? previousIn : "" };
  return [...legs.slice(0, position), leg, ...legs.slice(position)];
}

/**
 * Sets a leg's Time In. The next leg's Time Out is copied from it when that
 * is still empty, since the vehicle leaves when it arrives; a Time Out the
 * Scheduler already typed is never overwritten.
 */
export function setLegTimeIn(legs: LegDraft[], index: number, value: string): LegDraft[] {
  return legs.map((leg, position) => {
    if (position === index) return { ...leg, plannedTimeIn: value };
    if (position === index + 1 && !leg.plannedTimeOut && validTime(value)) return { ...leg, plannedTimeOut: value };
    return leg;
  });
}
export const canAddFinal = (legs: LegDraft[]) =>
  !hasFinal(legs) && legs.length < MAX_LEGS && legs.some((leg) => !leg.isFinal);

/** Moves a leg up or down; its stops, times and contact travel with it. The final leg stays last. */
export function moveLeg(legs: LegDraft[], index: number, delta: -1 | 1): LegDraft[] {
  const target = index + delta;
  if (target < 0 || target >= legs.length || legs[index].isFinal || legs[target].isFinal) return legs;
  const next = [...legs];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export const removeLeg = (legs: LegDraft[], index: number) => legs.filter((_, position) => position !== index);

/** Whether a leg holds anything the Scheduler entered; a default Time Out alone does not count. */
export const legHasContent = (leg: LegDraft) =>
  !!(leg.destinationId || leg.plannedTimeIn || leg.contactName.trim() || leg.contactNumber.trim() || leg.stops.length);

/** Drops stops that no longer belong to a selected request. */
export function keepStops(legs: LegDraft[], allowed: Set<string>): LegDraft[] {
  return legs.map((leg) =>
    leg.stops.every((stop) => allowed.has(stop)) ? leg : { ...leg, stops: leg.stops.filter((stop) => allowed.has(stop)) },
  );
}

export function unassignedStops(stops: StopInfo[], legs: LegDraft[]): StopInfo[] {
  const used = new Set(legs.flatMap((leg) => leg.stops));
  return stops.filter((stop) => !used.has(stop.id));
}

/** Stops a leg may serve: its destination, not already served by another leg. */
export function candidatesForLeg(legs: LegDraft[], index: number, stops: StopInfo[]): StopInfo[] {
  const leg = legs[index];
  if (leg.isFinal || !leg.destinationId) return [];
  const elsewhere = new Set(legs.flatMap((other, position) => (position === index ? [] : other.stops)));
  return stops.filter((stop) => stop.destinationId === leg.destinationId && !elsewhere.has(stop.id));
}

/**
 * Sets a leg's destination and clears stops for the old one. A lone
 * matching stop is ticked for convenience; when several requests share the
 * destination, none are, so combining them is always the Scheduler's call.
 */
export function setLegDestination(legs: LegDraft[], index: number, destinationId: string, stops: StopInfo[]): LegDraft[] {
  const next = legs.map((leg, position) => (position === index ? { ...leg, destinationId, stops: [] } : leg));
  const candidates = candidatesForLeg(next, index, stops);
  if (candidates.length === 1) next[index] = { ...next[index], stops: [candidates[0].id] };
  return next;
}

/** Destinations shared by two or more selected stops, for the Scheduler to review. */
export function matchingDestinations(stops: StopInfo[]): Array<{ destinationId: string; destinationName: string; stops: StopInfo[] }> {
  const groups = new Map<string, StopInfo[]>();
  for (const stop of stops) groups.set(stop.destinationId, [...(groups.get(stop.destinationId) ?? []), stop]);
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([destinationId, group]) => ({ destinationId, destinationName: group[0].destinationName, stops: group }));
}

const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/**
 * Problems that stop a save (the server needs a vehicle, requests and
 * valid times on every leg) and, separately, what else must be done
 * before the Trip Record can be submitted for approval.
 */
export function tripProblems(input: {
  plate: string;
  requestIds: string[];
  legs: LegDraft[];
  stops: StopInfo[];
}): { save: string[]; submit: string[] } {
  const save: string[] = [];
  const submit: string[] = [];
  if (!input.plate) save.push("Select a vehicle.");
  if (!input.requestIds.length) save.push("Select at least one request.");
  if (!input.legs.length) save.push("Add at least one leg.");
  if (input.legs.length > MAX_LEGS) save.push(`A schedule can have at most ${MAX_LEGS} legs, including the final leg.`);

  let previousIn = "";
  input.legs.forEach((leg, index) => {
    const label = `Leg ${index + 1}`;
    if (!leg.isFinal && !leg.destinationId) save.push(`${label}: choose a destination.`);
    if (!validTime(leg.plannedTimeOut) || !validTime(leg.plannedTimeIn)) {
      save.push(`${label}: enter planned Time Out and Time In.`);
      previousIn = "";
      return;
    }
    if (leg.plannedTimeIn <= leg.plannedTimeOut) save.push(`${label}: planned Time In must be after Time Out.`);
    if (previousIn && leg.plannedTimeOut < previousIn) {
      save.push(`${label}: planned Time Out can't be before the previous leg's Time In.`);
    }
    previousIn = leg.plannedTimeIn;
  });

  if (!hasFinal(input.legs)) submit.push("Add the final leg back to ANONANG.");
  for (const stop of unassignedStops(input.stops, input.legs)) {
    submit.push(`Put ${stop.requester}'s ${stop.destinationName} (${stop.purposeName}) on a leg.`);
  }
  return { save, submit };
}

/**
 * What is still wrong with each leg, in leg order, so the form can show it on
 * the leg itself. An unplaced stop lands on the first leg going to its
 * destination; one with no such leg shows only in the checklist.
 */
export function legWarnings(legs: LegDraft[], stops: StopInfo[]): string[][] {
  const warnings = legs.map(() => [] as string[]);
  const { save } = tripProblems({ plate: "-", requestIds: ["-"], legs, stops });
  for (const problem of save) {
    const match = /^Leg (\d+): (.*)$/.exec(problem);
    if (match) warnings[Number(match[1]) - 1]?.push(match[2].charAt(0).toUpperCase() + match[2].slice(1));
  }
  for (const stop of unassignedStops(stops, legs)) {
    const index = legs.findIndex((leg) => !leg.isFinal && leg.destinationId === stop.destinationId);
    if (index >= 0) warnings[index].push(`Tick ${stop.requester}'s ${stop.purposeName} under "Requests served here".`);
  }
  return warnings;
}

export type ChecklistItem = { label: string; done: boolean; detail?: string };

/**
 * What the Scheduler still has to do, as a checklist that fills in as the
 * form does. It is derived from tripProblems, so it can never disagree with
 * the rules that enable Save draft (the first four items) and Submit (all
 * six). A missing item's detail names the legs or stops to fix.
 */
export function tripChecklist(input: {
  plate: string;
  hasDriver: boolean;
  requestIds: string[];
  legs: LegDraft[];
  stops: StopInfo[];
}): ChecklistItem[] {
  const { save, submit } = tripProblems(input);
  const about = (problems: string[], pattern: RegExp) => problems.filter((problem) => pattern.test(problem));
  const detail = (problems: string[]) => (problems.length ? problems.join(" ") : undefined);
  const destinations = about(save, /choose a destination/);
  const times = about(save, /Time (In|Out)/);
  const stops = about(submit, /^Put /);
  return [
    { label: "Choose at least one request", done: input.requestIds.length > 0 },
    {
      label: "Choose a vehicle that has a Driver",
      done: !!input.plate && input.hasDriver,
      detail: input.plate && !input.hasDriver ? "This vehicle has no active Driver. An Admin assigns one in Settings." : undefined,
    },
    { label: "Choose a destination for every leg", done: input.legs.length > 0 && !destinations.length, detail: detail(destinations) },
    { label: "Enter Time Out and Time In for every leg", done: input.legs.length > 0 && !times.length, detail: detail(times) },
    { label: "Put every requested stop on a leg", done: input.stops.length > 0 && !stops.length, detail: detail(stops) },
    { label: "End with the leg back to ANONANG", done: hasFinal(input.legs) },
  ];
}

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

export type Commitment = {
  scheduleId: string;
  plate: string;
  driverId: string;
  driverName: string;
  start: string;
  end: string;
  state: ScheduleState;
};

/**
 * Time already held on a date, per live version: a pending revision and
 * the published version it would replace both hold time until approval.
 */
export function commitmentsOn(date: string, schedules: Schedule[], excludeScheduleId?: string): Commitment[] {
  return schedules
    .filter((schedule) => schedule.date === date && schedule.status === "ACTIVE" && schedule.id !== excludeScheduleId)
    .flatMap((schedule) =>
      schedule.revisions.flatMap((revision) => {
        const window = tripWindow(revision.legs);
        return window
          ? [{
              scheduleId: schedule.id,
              plate: revision.plate,
              driverId: revision.driverId,
              driverName: revision.driverName,
              ...window,
              state: scheduleState(schedule),
            }]
          : [];
      }),
    )
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** Commitments that would collide with a window on the same vehicle or Driver. */
export function conflictsWith(
  window: { start: string; end: string } | null,
  plate: string,
  driverId: string,
  commitments: Commitment[],
): Commitment[] {
  if (!window) return [];
  return commitments.filter(
    (item) =>
      (item.plate === plate || item.driverId === driverId) && item.start < window.end && window.start < item.end,
  );
}

export function legsFromRevision(revision: ScheduleRevision): LegDraft[] {
  return revision.legs.map((leg) => ({
    key: nextKey(),
    destinationId: leg.destinationId ?? "",
    plannedTimeOut: leg.plannedTimeOut,
    plannedTimeIn: leg.plannedTimeIn,
    contactName: leg.contactName,
    contactNumber: leg.contactNumber,
    stops: leg.stops,
    isFinal: leg.isFinal,
  }));
}

export function toScheduleInput(date: string, plate: string, requestIds: string[], legs: LegDraft[]): ScheduleInput {
  return {
    date,
    plate,
    requestIds,
    legs: legs.map((leg) => ({
      destinationId: leg.isFinal ? undefined : leg.destinationId || undefined,
      plannedTimeOut: leg.plannedTimeOut,
      plannedTimeIn: leg.plannedTimeIn,
      contactName: leg.contactName.trim(),
      contactNumber: leg.contactNumber.trim(),
      stops: leg.isFinal ? [] : leg.stops,
      isFinal: leg.isFinal,
    })),
  };
}
