import type { ScheduleInput, ScheduleLeg } from "@/lib/kova-api";
import { DAY_END, type legTimer, type WorkLeg } from "@/lib/scheduling-plan";
import { MAX_LEGS } from "@/lib/trip-record";
import { hhmmLabel } from "@/lib/stop-times";
import { toMinutes } from "@/lib/trip-estimate";

/**
 * Editing a trip's legs on the Scheduling page (prototype leg cards): type
 * a Time Out or Time In, move a leg, change its destination or remove it.
 * Times the Scheduler set stay; every other leg is estimated again from
 * the one before. Saved times don't say who set them, so a saved time that
 * differs from its estimate counts as set.
 */

type Timer = ReturnType<typeof legTimer>;

export type EditLeg = WorkLeg & {
  key: string;
  destinationName: string;
  timeOut: string;
  timeIn: string;
  /** The Scheduler set this leg's times; estimates leave it alone. */
  set: boolean;
};

const pinned = (leg: EditLeg): WorkLeg => (leg.set ? leg : { ...leg, timeOut: undefined, timeIn: undefined });

/** Times every leg: set legs keep theirs, the rest follow the leg before. Leg 1 leaves at its Time Out. */
export function retime(legs: EditLeg[], timer: Timer): EditLeg[] {
  if (!legs.length) return legs;
  const start = legs[0].timeOut;
  const times = timer.timed(legs.map(pinned), start);
  return legs.map((leg, index) => ({ ...leg, timeOut: times[index].timeOut, timeIn: times[index].timeIn }));
}

/** A saved trip's legs, with which ones the Scheduler set (they differ from their estimate). */
export function editLegs(legs: ScheduleLeg[], timer: Timer, start: string): EditLeg[] {
  const saved: EditLeg[] = legs.map((leg) => ({
    key: leg.id,
    destinationId: leg.destinationId,
    destinationName: leg.isFinal ? "ANONANG" : leg.destinationName,
    stops: leg.stops,
    isFinal: leg.isFinal,
    contactName: leg.contactName,
    contactNumber: leg.contactNumber,
    timeOut: leg.plannedTimeOut,
    timeIn: leg.plannedTimeIn,
    set: true,
  }));
  if (saved.some((leg) => !leg.timeOut || !leg.timeIn)) {
    // A draft saved without times: estimate them all.
    return retime(
      saved.map((leg, index) => ({ ...leg, set: false, timeOut: index === 0 ? leg.timeOut || start : "" })),
      timer,
    );
  }
  return saved.map((leg, index) => {
    const estimate = timer.timed(
      saved.slice(0, index + 1).map((item, position) => (position === index ? { ...item, timeOut: undefined, timeIn: undefined } : item)),
      saved[0].timeOut,
    )[index];
    return { ...leg, set: (index > 0 && estimate.timeOut !== leg.timeOut) || estimate.timeIn !== leg.timeIn };
  });
}

/** Sets one leg's Time Out and Time In; later legs follow. */
export function setLegTimes(legs: EditLeg[], index: number, timeOut: string, timeIn: string, timer: Timer): EditLeg[] {
  return retime(
    legs.map((leg, position) => (position === index ? { ...leg, timeOut, timeIn, set: true } : leg)),
    timer,
  );
}

/** Moves a leg; the return to ANONANG stays last. Moved legs lose the times set on them. */
export function moveLeg(legs: EditLeg[], from: number, to: number, timer: Timer): EditLeg[] {
  if (from === to || legs[from]?.isFinal || legs[to]?.isFinal) return legs;
  const next = [...legs];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  const [low, high] = [Math.min(from, to), Math.max(from, to)];
  return retime(
    next.map((leg, index) => (index >= low && index <= high ? { ...leg, set: false, timeOut: index === 0 ? legs[0].timeOut : leg.timeOut } : leg)),
    timer,
  );
}

/** Removes a leg; the one after it is estimated again. */
export function removeLeg(legs: EditLeg[], index: number, timer: Timer): EditLeg[] {
  const next = legs.filter((_, position) => position !== index);
  return retime(
    next.map((leg, position) => (position === index ? { ...leg, set: false, timeOut: position === 0 ? legs[0].timeOut : leg.timeOut } : leg)),
    timer,
  );
}

/** Sends a leg somewhere else, serving these stops; it and the leg after are estimated again. */
export function changeDestination(
  legs: EditLeg[],
  index: number,
  destination: { id: string; name: string; stops: string[] },
  timer: Timer,
): EditLeg[] {
  return retime(
    legs.map((leg, position) => {
      if (position === index)
        return { ...leg, destinationId: destination.id, destinationName: destination.name, stops: destination.stops, set: false };
      return position === index + 1 ? { ...leg, set: false } : leg;
    }),
    timer,
  );
}

/** What save_schedule_draft takes for these legs: every request with a stop on them. */
export function editInput(date: string, plate: string, legs: EditLeg[], requestIdOf: (stopId: string) => string | undefined): ScheduleInput {
  return {
    date,
    plate,
    requestIds: [...new Set(legs.flatMap((leg) => leg.stops.map(requestIdOf)).filter((id): id is string => !!id))],
    legs: legs.map((leg) => ({
      destinationId: leg.isFinal ? undefined : leg.destinationId,
      plannedTimeOut: leg.timeOut,
      plannedTimeIn: leg.timeIn,
      contactName: leg.contactName,
      contactNumber: leg.contactNumber,
      stops: leg.isFinal ? [] : leg.stops,
      isFinal: leg.isFinal,
    })),
  };
}

/**
 * What's wrong with a trip, shown under the vehicle (prototype "checks"):
 * Submit is refused until these are fixed. A Daily trip must end at
 * ANONANG; a Company trip ends at its last stop.
 */
export function tripChecks(legs: EditLeg[], timer: Timer, company: boolean, nameOf: (requestId: string) => string): string[] {
  const problems: string[] = [];
  if (!legs.length) return problems;
  if (legs.length > MAX_LEGS) problems.push(`Over ${MAX_LEGS} legs: this trip has ${legs.length}`);
  const end = legs.at(-1)!.timeIn;
  if (end > DAY_END) problems.push(`Ends ${hhmmLabel(end)}, after the Driver's day ends at 6:00 PM`);
  legs.forEach((_, index) => problems.push(...legProblems(legs, index, timer, nameOf).map((problem) => `Leg ${index + 1}: ${problem}`)));
  if (!company && !legs.at(-1)!.isFinal) problems.push(`Must end at ANONANG: the last leg goes to ${legs.at(-1)!.destinationName}`);
  return problems;
}

/**
 * What's wrong with one leg, with the times involved: too little time to
 * drive there, leaving before it arrives from the stop before, and each
 * fixed-time stop it reaches more than 5 minutes off.
 */
export function legProblems(legs: EditLeg[], index: number, timer: Timer, nameOf: (requestId: string) => string): string[] {
  const leg = legs[index];
  const problems: string[] = [];
  const wait = timer.waitAt(legs, index);
  if (wait < 0) problems.push(`Time In ${hhmmLabel(leg.timeIn)} is too soon to drive to ${leg.destinationName}`);
  const before = legs[index - 1];
  if (before && toMinutes(leg.timeOut) < toMinutes(before.timeIn))
    problems.push(`Time Out ${hhmmLabel(leg.timeOut)} is before it arrives at ${before.destinationName} at ${hhmmLabel(before.timeIn)}`);
  for (const stopId of leg.stops) {
    const request = timer.requestOf(stopId);
    if (request?.flexibility !== "FIXED" || !request.fixedTime) continue;
    if (Math.abs(toMinutes(leg.timeIn) - toMinutes(request.fixedTime)) <= 5) continue;
    problems.push(`${nameOf(request.id)} asked for ${hhmmLabel(request.fixedTime)}; it arrives ${hhmmLabel(leg.timeIn)}`);
  }
  return problems;
}
