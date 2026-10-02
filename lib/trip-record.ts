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
  /** "" until chosen; always "" on the final leg, and on an Other-destination leg (see destinationOther). */
  destinationId: string;
  /**
   * A free-text "Other" destination this leg serves, instead of a
   * booking_options id — set only for a leg built from an Other-destination
   * pool stop (addPoolLeg), never chosen directly by the Scheduler.
   */
  destinationOther: string;
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
  destinationId?: string;
  destinationName: string;
  destinationIsOther: boolean;
  purposeName: string;
  /** The request is Urgent, so the Scheduler places it before Regular ones. */
  urgent?: boolean;
};

/**
 * What groups a stop or leg by destination: a booking_options id normally,
 * or the free-text name itself for an Other destination (there is no id to
 * group by). Two Other stops only share a leg when their text matches
 * exactly, the same rule an id match already enforces for a normal one.
 */
export const stopGroupKey = (stop: StopInfo) => (stop.destinationIsOther ? `other:${stop.destinationName}` : (stop.destinationId ?? ""));
export const legGroupKey = (leg: LegDraft) => (leg.destinationOther ? `other:${leg.destinationOther}` : leg.destinationId);

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
  destinationOther: "",
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
      destinationIsOther: destination.destinationIsOther,
      purposeName: destination.purposeName,
      urgent: request.requestType === "URGENT",
    })),
  );
}

/** Request pool order: Urgent first, then by requester and when they asked. */
export function poolOrder(a: TransportRequest, b: TransportRequest): number {
  const urgency = Number(b.requestType === "URGENT") - Number(a.requestType === "URGENT");
  return urgency || a.ownerName.localeCompare(b.ownerName) || a.createdAt.localeCompare(b.createdAt);
}

/** Leg 1 starts at ANONANG; every later leg starts where the previous one ended. */
export function legOrigins(legs: LegDraft[], destinationName: (leg: LegDraft) => string): string[] {
  return legs.map((_, index) => {
    if (index === 0) return BASE;
    const previous = legs[index - 1];
    return previous.isFinal ? BASE : destinationName(previous) || "—";
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
  !!(
    leg.destinationId ||
    leg.destinationOther ||
    leg.plannedTimeIn ||
    leg.contactName.trim() ||
    leg.contactNumber.trim() ||
    leg.stops.length
  );

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
  const key = legGroupKey(leg);
  if (leg.isFinal || !key) return [];
  const elsewhere = new Set(legs.flatMap((other, position) => (position === index ? [] : other.stops)));
  return stops.filter((stop) => stopGroupKey(stop) === key && !elsewhere.has(stop.id));
}

export const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/**
 * The destinations the Scheduler can add a stop for: the request pool's
 * destinations that still have at least one unplaced stop. A destination
 * drops out once every request needing it is on a leg. Destinations an
 * unplaced Urgent stop needs come first, so they get placed first.
 */
export function poolDestinationChoices(
  poolStops: StopInfo[],
  legs: LegDraft[],
): Array<{ id: string; name: string; urgent: boolean }> {
  const choices = new Map<string, { id: string; name: string; urgent: boolean }>();
  for (const stop of unassignedStops(poolStops, legs)) {
    const key = stopGroupKey(stop);
    const choice = choices.get(key) ?? { id: key, name: stop.destinationName, urgent: false };
    choices.set(key, { ...choice, urgent: choice.urgent || !!stop.urgent });
  }
  return [...choices.values()].sort((a, b) => Number(b.urgent) - Number(a.urgent));
}

/** Urgent requests in the pool with a stop not yet on any leg. */
export function unplacedUrgentRequestIds(poolStops: StopInfo[], legs: LegDraft[]): string[] {
  return [...new Set(unassignedStops(poolStops, legs).filter((stop) => stop.urgent).map((stop) => stop.requestId))];
}

/**
 * Sets an already-added blank leg's destination, picked from one combined
 * list: a pool destination (attaches every currently unplaced request stop
 * for it, since sharing is automatic) or a fixed destination (e.g. a
 * fuel/errand stop flagged in Settings, which carries no request stops).
 * A pool destination that another leg already serves merges into that leg
 * instead, since a destination shouldn't appear on the route twice, and
 * this now-redundant blank leg is dropped rather than left empty.
 */
export function pickLegDestination(
  legs: LegDraft[],
  index: number,
  key: string,
  poolStops: StopInfo[],
  fixedDestinationIds: Set<string>,
): LegDraft[] {
  if (fixedDestinationIds.has(key)) {
    return legs.map((leg, position) => (position === index ? { ...leg, destinationId: key, destinationOther: "" } : leg));
  }
  const matching = unassignedStops(poolStops, legs).filter((stop) => stopGroupKey(stop) === key);
  if (!matching.length) return legs;
  const stopIds = matching.map((stop) => stop.id);
  const isOther = matching[0].destinationIsOther;
  const destinationId = isOther ? "" : (matching[0].destinationId ?? "");
  const destinationOther = isOther ? matching[0].destinationName : "";
  const existingIndex = legs.findIndex(
    (leg, position) => position !== index && !leg.isFinal && legGroupKey(leg) === key && leg.stops.length > 0,
  );
  if (existingIndex !== -1) {
    return legs
      .map((leg, position) => (position === existingIndex ? { ...leg, stops: [...leg.stops, ...stopIds] } : leg))
      .filter((_, position) => position !== index);
  }
  return legs.map((leg, position) => (position === index ? { ...leg, destinationId, destinationOther, stops: stopIds } : leg));
}

/** True for a leg the Scheduler added by hand rather than one the pool built, e.g. a fuel stop. */
export const isOtherStopLeg = (leg: LegDraft, otherStopDestinationIds: Set<string>) =>
  !leg.isFinal && !!leg.destinationId && otherStopDestinationIds.has(leg.destinationId);

/**
 * Keeps the final leg's Time Out in step after a leg is added, removed or
 * reordered: if it is empty or now earlier than the leg before it, it is
 * set from that leg's Time In (the vehicle leaves when it arrives), the
 * same rule setLegTimeIn already applies as the Scheduler types.
 */
export function reflowFinalLegTimeOut(legs: LegDraft[]): LegDraft[] {
  const finalIndex = legs.findIndex((leg) => leg.isFinal);
  if (finalIndex <= 0) return legs;
  const previous = legs[finalIndex - 1];
  if (!validTime(previous.plannedTimeIn)) return legs;
  const final = legs[finalIndex];
  if (validTime(final.plannedTimeOut) && final.plannedTimeOut >= previous.plannedTimeIn) return legs;
  return legs.map((leg, index) => (index === finalIndex ? { ...leg, plannedTimeOut: previous.plannedTimeIn } : leg));
}

/** Every request with at least one stop currently on a leg; what the schedule actually serves. */
export function servedRequestIds(legs: LegDraft[], poolStops: StopInfo[]): string[] {
  const placed = new Set(legs.flatMap((leg) => leg.stops));
  return [...new Set(poolStops.filter((stop) => placed.has(stop.id)).map((stop) => stop.requestId))];
}

/**
 * Unplaced stops of requests this route already serves. A request is served
 * once any of its stops is on a leg, and then all of them must be (as
 * assert_revision_complete requires). Pool requests with no stop placed are
 * not missing: they can go on another vehicle's schedule or be sent back.
 */
export function missingStops(stops: StopInfo[], legs: LegDraft[]): StopInfo[] {
  const served = new Set(servedRequestIds(legs, stops));
  return unassignedStops(stops, legs).filter((stop) => served.has(stop.requestId));
}

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
  otherStopDestinationIds?: Set<string>;
}): { save: string[]; submit: string[] } {
  const save: string[] = [];
  const submit: string[] = [];
  const otherStopIds = input.otherStopDestinationIds ?? new Set<string>();
  if (!input.plate) save.push("Select a vehicle.");
  if (!input.requestIds.length) save.push("Serve at least one request.");
  if (!input.legs.length) save.push("Add at least one leg.");
  if (input.legs.length > MAX_LEGS) save.push(`A schedule can have at most ${MAX_LEGS} legs, including the final leg.`);

  let previousIn = "";
  input.legs.forEach((leg, index) => {
    const label = `Leg ${index + 1}`;
    if (!leg.isFinal && !leg.destinationId && !leg.destinationOther) save.push(`${label}: choose a destination.`);
    if (!leg.isFinal && leg.destinationId && !leg.stops.length && !otherStopIds.has(leg.destinationId)) {
      save.push(`${label}: this stop has no request on it. Remove it, or mark its destination as a fuel/errand stop in Settings.`);
    }
    if (!leg.isFinal && leg.destinationOther && !leg.stops.length) {
      save.push(`${label}: this stop has no request on it. Remove it.`);
    }
    // Times aren't required to save a draft — a Scheduler can pin down the
    // route first and fill them in later — but are needed before Submit.
    if (!leg.plannedTimeOut && !leg.plannedTimeIn) {
      submit.push(`${label}: enter planned Time Out and Time In.`);
      previousIn = "";
      return;
    }
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
  for (const stop of missingStops(input.stops, input.legs)) {
    submit.push(`Put ${stop.requester}'s ${stop.destinationName} (${stop.purposeName}) on a leg.`);
  }
  return { save, submit };
}

/**
 * What is still wrong with each leg, in leg order, so the form can show it on
 * the leg itself. An unplaced stop lands on the first leg going to its
 * destination; one with no such leg shows only in the checklist.
 */
export function legWarnings(legs: LegDraft[], stops: StopInfo[], otherStopDestinationIds?: Set<string>): string[][] {
  const warnings = legs.map(() => [] as string[]);
  const { save } = tripProblems({ plate: "-", requestIds: ["-"], legs, stops, otherStopDestinationIds });
  for (const problem of save) {
    const match = /^Leg (\d+): (.*)$/.exec(problem);
    if (match) warnings[Number(match[1]) - 1]?.push(match[2].charAt(0).toUpperCase() + match[2].slice(1));
  }
  for (const stop of missingStops(stops, legs)) {
    const index = legs.findIndex((leg) => !leg.isFinal && legGroupKey(leg) === stopGroupKey(stop));
    if (index >= 0) warnings[index].push(`Tick ${stop.requester}'s ${stop.purposeName} under "Requests served here".`);
  }
  return warnings;
}

export type ChecklistItem = { label: string; done: boolean; detail?: string };

/**
 * What the Scheduler still has to do, as a checklist that fills in as the
 * form does. It is derived from tripProblems, so it can never disagree with
 * the rules that enable Save draft (the first four items) and Submit (all
 * six). Problems on a leg show on that leg; an item's detail covers only what no leg can show.
 */
export function tripChecklist(input: {
  plate: string;
  hasDriver: boolean;
  requestIds: string[];
  legs: LegDraft[];
  stops: StopInfo[];
  otherStopDestinationIds?: Set<string>;
}): ChecklistItem[] {
  const { save, submit } = tripProblems(input);
  const about = (problems: string[], pattern: RegExp) => problems.filter((problem) => pattern.test(problem));
  // Both an empty destination and a destination with no request on it (and
  // not flagged as a fuel/errand stop) are the same checklist item: the leg's
  // destination row isn't settled yet.
  const destinations = about(save, /choose a destination|has no request on it/);
  const times = about([...save, ...submit], /Time (In|Out)/);
  const stops = about(submit, /^Put /);
  // Stops that have a leg to go on are flagged on that leg; only the rest need a detail here.
  const homeless = missingStops(input.stops, input.legs).filter(
    (stop) => !input.legs.some((leg) => !leg.isFinal && legGroupKey(leg) === stopGroupKey(stop)),
  );
  return [
    { label: "Serve at least one request", done: input.requestIds.length > 0 },
    {
      label: "Choose a vehicle that has a Driver",
      done: !!input.plate && input.hasDriver,
      detail: input.plate && !input.hasDriver ? "This vehicle has no active Driver. An Admin assigns one in Settings." : undefined,
    },
    { label: "Choose a destination for every leg", done: input.legs.length > 0 && !destinations.length },
    { label: "Enter Time Out and Time In for every leg", done: input.legs.length > 0 && !times.length },
    {
      label: "Put all stops of each request you serve on a leg",
      done: input.requestIds.length > 0 && !stops.length,
      detail: homeless.length ? `Add a leg to ${[...new Set(homeless.map((stop) => stop.destinationName))].join(", ")}.` : undefined,
    },
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
    // A non-final leg with stops but no destinationId is an Other-destination
    // leg (see 0036): the server derives it from the stops, so its free text
    // only ever appears as destinationName.
    destinationOther: !leg.isFinal && !leg.destinationId && leg.stops.length > 0 ? leg.destinationName : "",
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
