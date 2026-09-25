import { describe, expect, it } from "vitest";
import type { Schedule } from "@/lib/kova-api";
import {
  MAX_LEGS,
  addLeg,
  canAddFinal,
  canAddLeg,
  candidatesForLeg,
  commitmentsOn,
  conflictsWith,
  finalLeg,
  initialLegs,
  keepStops,
  legHasContent,
  legOrigins,
  matchingDestinations,
  moveLeg,
  newLeg,
  scheduleState,
  setLegDestination,
  setLegTimeIn,
  toScheduleInput,
  tripChecklist,
  tripProblems,
  tripWindow,
  type LegDraft,
  type StopInfo,
} from "@/lib/trip-record";

const names: Record<string, string> = { d1: "City Hall", d2: "Port Office" };
const destinationName = (id: string) => names[id] ?? "";

// Juan and Maria both need City Hall, for different purposes; Maria also
// needs the Port Office.
const stops: StopInfo[] = [
  { id: "juan-ch", requestId: "juan", requester: "Juan", destinationId: "d1", destinationName: "City Hall", purposeName: "Inspection" },
  { id: "maria-ch", requestId: "maria", requester: "Maria", destinationId: "d1", destinationName: "City Hall", purposeName: "Document delivery" },
  { id: "maria-po", requestId: "maria", requester: "Maria", destinationId: "d2", destinationName: "Port Office", purposeName: "Inspection" },
];

const leg = (patch: Partial<LegDraft>): LegDraft => ({ ...newLeg(), ...patch });

describe("route continuity", () => {
  it("starts at ANONANG and takes each origin from the previous destination", () => {
    const legs = [leg({ destinationId: "d1" }), leg({ destinationId: "d2" }), finalLeg()];
    expect(legOrigins(legs, destinationName)).toEqual(["ANONANG", "City Hall", "Port Office"]);
  });

  it("recomputes origins after the legs are reordered", () => {
    const legs = [leg({ destinationId: "d1" }), leg({ destinationId: "d2" }), finalLeg()];
    expect(legOrigins(moveLeg(legs, 1, -1), destinationName)).toEqual(["ANONANG", "Port Office", "City Hall"]);
  });

  it("keeps a leg's stops and times when it moves", () => {
    const legs = [leg({ destinationId: "d1", stops: ["juan-ch"], plannedTimeOut: "08:00" }), leg({ destinationId: "d2", stops: ["maria-po"] })];
    const moved = moveLeg(legs, 0, 1);
    expect(moved[1]).toMatchObject({ destinationId: "d1", stops: ["juan-ch"], plannedTimeOut: "08:00" });
  });

  it("never moves the final leg or moves a leg past it", () => {
    const legs = [leg({ destinationId: "d1" }), finalLeg()];
    expect(moveLeg(legs, 1, -1)).toBe(legs);
    expect(moveLeg(legs, 0, 1)).toBe(legs);
  });
});

describe("add leg / add final leg", () => {
  it("offers the final leg only until it is added, but a leg while there is room", () => {
    const legs = [leg({ destinationId: "d1" })];
    expect(canAddLeg(legs)).toBe(true);
    expect(canAddFinal(legs)).toBe(true);
    const withFinal = [...legs, finalLeg()];
    expect(canAddLeg(withFinal)).toBe(true);
    expect(canAddFinal(withFinal)).toBe(false);
  });

  it("doesn't offer a final leg before any destination leg", () => {
    expect(canAddFinal([])).toBe(false);
  });

  it("stops offering legs when all 8 rows are used, final leg included", () => {
    const seven = Array.from({ length: MAX_LEGS - 1 }, () => leg({ destinationId: "d1" }));
    expect(canAddLeg(seven)).toBe(true);
    expect(canAddLeg([...seven, finalLeg()])).toBe(false);
  });

  it("puts a new leg before the final leg", () => {
    const legs = addLeg([leg({ destinationId: "d1" }), finalLeg()]);
    expect(legs.map((item) => item.isFinal)).toEqual([false, false, true]);
  });

  it("appends a new leg when there is no final leg yet", () => {
    expect(addLeg([leg({ destinationId: "d1" })]).map((item) => item.isFinal)).toEqual([false, false]);
  });

  it("starts a new leg when the previous one arrives", () => {
    const legs = addLeg([leg({ destinationId: "d1", plannedTimeOut: "08:00", plannedTimeIn: "09:30" }), finalLeg()]);
    expect(legs[1].plannedTimeOut).toBe("09:30");
    expect(addLeg([leg({ destinationId: "d1" }), finalLeg()])[1].plannedTimeOut).toBe("");
  });
});

describe("legHasContent", () => {
  it("treats the default Time Out alone as empty", () => {
    expect(legHasContent(initialLegs()[0])).toBe(false);
    expect(legHasContent(initialLegs()[1])).toBe(false);
  });

  it("notices anything the Scheduler entered", () => {
    expect(legHasContent(leg({ destinationId: "d1" }))).toBe(true);
    expect(legHasContent(leg({ plannedTimeIn: "09:00" }))).toBe(true);
    expect(legHasContent(leg({ contactName: "Ana" }))).toBe(true);
    expect(legHasContent(leg({ stops: ["juan-ch"] }))).toBe(true);
    expect(legHasContent(leg({ contactName: "   " }))).toBe(false);
  });
});

describe("new Trip Record defaults", () => {
  it("starts with one destination leg at 08:00 and the return leg", () => {
    const legs = initialLegs();
    expect(legs.map((item) => item.isFinal)).toEqual([false, true]);
    expect(legs[0].plannedTimeOut).toBe("08:00");
    expect(legs[0].plannedTimeIn).toBe("");
    expect(legs[1].plannedTimeOut).toBe("");
  });

  it("copies a Time In into the next leg's empty Time Out", () => {
    const legs = setLegTimeIn(initialLegs(), 0, "09:15");
    expect(legs[0].plannedTimeIn).toBe("09:15");
    expect(legs[1].plannedTimeOut).toBe("09:15");
  });

  it("never overwrites a Time Out that was already entered", () => {
    const legs = setLegTimeIn([leg({}), leg({ plannedTimeOut: "10:00" })], 0, "09:15");
    expect(legs[1].plannedTimeOut).toBe("10:00");
  });

  it("doesn't copy a half-typed time", () => {
    expect(setLegTimeIn(initialLegs(), 0, "09:1")[1].plannedTimeOut).toBe("");
  });

  it("still requires a Time In, so a new Trip Record isn't submittable", () => {
    const problems = tripProblems({ plate: "V1", requestIds: ["a"], legs: initialLegs(), stops: [] });
    expect(problems.save).toContain("Leg 1: choose a destination.");
    expect(problems.save).toContain("Leg 1: enter planned Time Out and Time In.");
  });
});

describe("shared stops", () => {
  it("never combines requests automatically when several share a destination", () => {
    const legs = setLegDestination([newLeg()], 0, "d1", stops);
    expect(legs[0].stops).toEqual([]);
    expect(candidatesForLeg(legs, 0, stops).map((stop) => stop.id)).toEqual(["juan-ch", "maria-ch"]);
  });

  it("ticks a lone matching stop", () => {
    expect(setLegDestination([newLeg()], 0, "d2", stops)[0].stops).toEqual(["maria-po"]);
  });

  it("doesn't offer a stop another leg already serves", () => {
    const legs = [leg({ destinationId: "d1", stops: ["juan-ch"] }), leg({ destinationId: "d1" })];
    expect(candidatesForLeg(legs, 1, stops).map((stop) => stop.id)).toEqual(["maria-ch"]);
  });

  it("groups matching destinations for review", () => {
    expect(matchingDestinations(stops)).toEqual([
      { destinationId: "d1", destinationName: "City Hall", stops: [stops[0], stops[1]] },
    ]);
  });

  it("drops stops of a request that is deselected", () => {
    const legs = [leg({ destinationId: "d1", stops: ["juan-ch", "maria-ch"] })];
    expect(keepStops(legs, new Set(["juan-ch"]))[0].stops).toEqual(["juan-ch"]);
  });
});

describe("tripProblems", () => {
  const complete = [
    leg({ destinationId: "d1", stops: ["juan-ch", "maria-ch"], plannedTimeOut: "08:00", plannedTimeIn: "09:00" }),
    leg({ destinationId: "d2", stops: ["maria-po"], plannedTimeOut: "09:15", plannedTimeIn: "10:00" }),
    { ...finalLeg(), plannedTimeOut: "10:30", plannedTimeIn: "11:30" },
  ];
  const base = { plate: "V1", requestIds: ["juan", "maria"], stops };

  it("accepts a complete Trip Record", () => {
    expect(tripProblems({ ...base, legs: complete })).toEqual({ save: [], submit: [] });
  });

  it("requires times but never fills them in", () => {
    const legs = [leg({ destinationId: "d1", stops: ["juan-ch"] })];
    expect(legs[0].plannedTimeOut).toBe("");
    expect(tripProblems({ ...base, legs }).save).toContain("Leg 1: enter planned Time Out and Time In.");
  });

  it("flags times that run backwards", () => {
    const legs = [
      leg({ destinationId: "d1", plannedTimeOut: "09:00", plannedTimeIn: "08:00" }),
      leg({ destinationId: "d2", plannedTimeOut: "07:00", plannedTimeIn: "10:00" }),
    ];
    expect(tripProblems({ ...base, legs }).save).toEqual([
      "Leg 1: planned Time In must be after Time Out.",
      "Leg 2: planned Time Out can't be before the previous leg's Time In.",
    ]);
  });

  it("allows saving a partial draft but not submitting it", () => {
    const legs = [leg({ destinationId: "d1", stops: ["juan-ch"], plannedTimeOut: "08:00", plannedTimeIn: "09:00" })];
    const problems = tripProblems({ ...base, legs });
    expect(problems.save).toEqual([]);
    expect(problems.submit).toEqual([
      "Add the final leg back to ANONANG.",
      "Put Maria's City Hall (Document delivery) on a leg.",
      "Put Maria's Port Office (Inspection) on a leg.",
    ]);
  });

  it("requires a vehicle and a request", () => {
    expect(tripProblems({ plate: "", requestIds: [], stops: [], legs: complete }).save).toEqual([
      "Select a vehicle.",
      "Select at least one request.",
    ]);
  });
});

describe("commitments", () => {
  const revision = (patch: object) => ({
    id: "rev",
    version: 1,
    status: "DRAFT" as const,
    plate: "V1",
    driverId: "drv1",
    driverName: "Dan",
    rowVersion: 1,
    createdAt: "",
    updatedAt: "",
    decisionComment: "",
    requestIds: [],
    legs: [
      { id: "l1", legNo: 1, origin: "ANONANG", destinationName: "City Hall", plannedTimeOut: "08:00", plannedTimeIn: "09:00", contactName: "", contactNumber: "", isFinal: false, stops: [] },
      { id: "l2", legNo: 2, origin: "City Hall", destinationName: "ANONANG", plannedTimeOut: "09:30", plannedTimeIn: "10:30", contactName: "", contactNumber: "", isFinal: true, stops: [] },
    ],
    ...patch,
  });
  const schedule = (patch: Partial<Schedule>): Schedule => ({
    id: "s1",
    date: "2026-10-05",
    createdByAccountId: "sched",
    status: "ACTIVE",
    createdAt: "",
    updatedAt: "",
    revisions: [revision({})],
    ...patch,
  });

  it("lists time held on the date, skipping the schedule being edited", () => {
    const schedules = [schedule({}), schedule({ id: "s2", date: "2026-10-06" })];
    expect(commitmentsOn("2026-10-05", schedules)).toEqual([
      { scheduleId: "s1", plate: "V1", driverId: "drv1", driverName: "Dan", start: "08:00", end: "10:30", state: "DRAFT" },
    ]);
    expect(commitmentsOn("2026-10-05", schedules, "s1")).toEqual([]);
  });

  it("ignores cancelled schedules", () => {
    expect(commitmentsOn("2026-10-05", [schedule({ status: "CANCELLED" })])).toEqual([]);
  });

  it("finds overlaps on the same vehicle or Driver only", () => {
    const held = commitmentsOn("2026-10-05", [schedule({})]);
    expect(conflictsWith({ start: "10:00", end: "12:00" }, "V1", "other", held)).toHaveLength(1);
    expect(conflictsWith({ start: "10:00", end: "12:00" }, "V2", "drv1", held)).toHaveLength(1);
    expect(conflictsWith({ start: "10:00", end: "12:00" }, "V2", "drv2", held)).toHaveLength(0);
    // Ranges are half-open: leaving as the other trip returns is fine.
    expect(conflictsWith({ start: "10:30", end: "12:00" }, "V1", "drv1", held)).toHaveLength(0);
  });

  it("derives the state shown for a schedule", () => {
    expect(scheduleState(schedule({}))).toBe("DRAFT");
    expect(scheduleState(schedule({ revisions: [revision({ status: "APPROVED" })], publishedRevisionId: "rev" }))).toBe("APPROVED");
    expect(scheduleState(schedule({ status: "CANCELLED" }))).toBe("CANCELLED");
  });

  it("measures the window from first Time Out to last Time In", () => {
    expect(tripWindow(revision({}).legs)).toEqual({ start: "08:00", end: "10:30" });
    expect(tripWindow([])).toBeNull();
  });
});

describe("toScheduleInput", () => {
  it("sends no destination or stops on the final leg and never an origin", () => {
    const input = toScheduleInput("2026-10-05", "V1", ["juan"], [
      leg({ destinationId: "d1", stops: ["juan-ch"], contactName: " Ana ", plannedTimeOut: "08:00", plannedTimeIn: "09:00" }),
      { ...finalLeg(), destinationId: "d1", stops: ["x"], plannedTimeOut: "09:30", plannedTimeIn: "10:30" },
    ]);
    expect(input.legs).toEqual([
      { destinationId: "d1", plannedTimeOut: "08:00", plannedTimeIn: "09:00", contactName: "Ana", contactNumber: "", stops: ["juan-ch"], isFinal: false },
      { destinationId: undefined, plannedTimeOut: "09:30", plannedTimeIn: "10:30", contactName: "", contactNumber: "", stops: [], isFinal: true },
    ]);
  });
});

describe("tripChecklist", () => {
  const complete = [
    leg({ destinationId: "d1", stops: ["juan-ch", "maria-ch"], plannedTimeOut: "08:00", plannedTimeIn: "09:00" }),
    leg({ destinationId: "d2", stops: ["maria-po"], plannedTimeOut: "09:15", plannedTimeIn: "10:00" }),
    { ...finalLeg(), plannedTimeOut: "10:30", plannedTimeIn: "11:30" },
  ];
  const base = { plate: "V1", hasDriver: true, requestIds: ["juan", "maria"], stops };
  const done = (input: Parameters<typeof tripChecklist>[0]) => tripChecklist(input).map((item) => item.done);

  it("ticks everything for a complete Trip Record", () => {
    expect(done({ ...base, legs: complete })).toEqual([true, true, true, true, true, true]);
  });

  it("leaves everything to do on a brand-new Trip Record", () => {
    const items = tripChecklist({ plate: "", hasDriver: false, requestIds: [], legs: initialLegs(), stops: [] });
    expect(items.map((item) => item.done)).toEqual([false, false, false, false, false, true]);
  });

  it("names the legs whose times are missing", () => {
    const legs = [{ ...complete[0], plannedTimeIn: "" }, complete[1], complete[2]];
    const times = tripChecklist({ ...base, legs })[3];
    expect(times.done).toBe(false);
    expect(times.detail).toBe("Leg 1: enter planned Time Out and Time In.");
  });

  it("names a requested stop that is not on any leg", () => {
    const legs = [complete[0], { ...complete[1], stops: [] }, complete[2]];
    const item = tripChecklist({ ...base, legs })[4];
    expect(item.done).toBe(false);
    expect(item.detail).toBe("Put Maria's Port Office (Inspection) on a leg.");
  });

  it("explains a vehicle with no Driver", () => {
    const item = tripChecklist({ ...base, hasDriver: false, legs: complete })[1];
    expect(item.done).toBe(false);
    expect(item.detail).toMatch(/Admin assigns one in Settings/);
  });

  it("agrees with tripProblems: the first four items are Save draft, all six are Submit", () => {
    const cases = [
      complete,
      [complete[0], complete[1]],
      [{ ...complete[0], destinationId: "" }, complete[1], complete[2]],
      [complete[0], { ...complete[1], stops: [] }, complete[2]],
      [{ ...complete[0], plannedTimeOut: "10:00", plannedTimeIn: "09:00" }, complete[1], complete[2]],
    ];
    for (const legs of cases) {
      const problems = tripProblems({ ...base, legs });
      const items = tripChecklist({ ...base, legs });
      expect(items.slice(0, 4).every((item) => item.done)).toBe(problems.save.length === 0);
      expect(items.every((item) => item.done)).toBe(problems.save.length === 0 && problems.submit.length === 0);
    }
  });
});
