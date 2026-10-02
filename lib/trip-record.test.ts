import { describe, expect, it } from "vitest";
import type { Schedule, TransportRequest } from "@/lib/kova-api";
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
  isOtherStopLeg,
  keepStops,
  legHasContent,
  legOrigins,
  moveLeg,
  newLeg,
  pickLegDestination,
  poolDestinationChoices,
  poolOrder,
  reflowFinalLegTimeOut,
  scheduleState,
  servedRequestIds,
  setLegTimeIn,
  splitOffs,
  toScheduleInput,
  tripChecklist,
  tripProblems,
  tripWindow,
  unplacedUrgentRequestIds,
  type LegDraft,
  type StopInfo,
} from "@/lib/trip-record";

const names: Record<string, string> = { d1: "City Hall", d2: "Port Office" };
const destinationName = (leg: LegDraft) => names[leg.destinationId] ?? "";

// Juan and Maria both need City Hall, for different purposes; Maria also
// needs the Port Office.
const stops: StopInfo[] = [
  { id: "juan-ch", requestId: "juan", requester: "Juan", destinationId: "d1", destinationName: "City Hall", destinationIsOther: false, purposeName: "Inspection" },
  { id: "maria-ch", requestId: "maria", requester: "Maria", destinationId: "d1", destinationName: "City Hall", destinationIsOther: false, purposeName: "Document delivery" },
  { id: "maria-po", requestId: "maria", requester: "Maria", destinationId: "d2", destinationName: "Port Office", destinationIsOther: false, purposeName: "Inspection" },
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

describe("pool destination choices", () => {
  it("offers every destination with an unplaced pool stop", () => {
    expect(poolDestinationChoices(stops, [])).toEqual([
      { id: "d1", name: "City Hall", urgent: false },
      { id: "d2", name: "Port Office", urgent: false },
    ]);
  });

  it("drops a destination once every stop needing it is placed", () => {
    const legs = [leg({ destinationId: "d1", stops: ["juan-ch", "maria-ch"] })];
    expect(poolDestinationChoices(stops, legs)).toEqual([{ id: "d2", name: "Port Office", urgent: false }]);
  });

  it("lists destinations an unplaced Urgent stop needs first", () => {
    const urgentStops = stops.map((stop) => (stop.id === "maria-po" ? { ...stop, urgent: true } : stop));
    expect(poolDestinationChoices(urgentStops, []).map((choice) => [choice.id, choice.urgent])).toEqual([
      ["d2", true],
      ["d1", false],
    ]);
  });
});

describe("Urgent requests", () => {
  const request = (patch: Partial<TransportRequest>) =>
    ({ id: "r", ownerName: "Juan", createdAt: "2026-10-01T00:00:00Z", requestType: "REGULAR", ...patch }) as TransportRequest;

  it("sorts the pool Urgent first, then by requester and creation time", () => {
    const pool = [
      request({ id: "a", ownerName: "Ana" }),
      request({ id: "z", ownerName: "Zed", requestType: "URGENT" }),
      request({ id: "b2", ownerName: "Ben", createdAt: "2026-10-02T00:00:00Z" }),
      request({ id: "b1", ownerName: "Ben" }),
    ];
    expect(pool.sort(poolOrder).map((item) => item.id)).toEqual(["z", "a", "b1", "b2"]);
  });

  it("lists Urgent requests that still have a stop off the route", () => {
    const urgentStops = stops.map((stop) => (stop.requestId === "maria" ? { ...stop, urgent: true } : stop));
    expect(unplacedUrgentRequestIds(urgentStops, [])).toEqual(["maria"]);
    expect(unplacedUrgentRequestIds(urgentStops, [leg({ destinationId: "d1", stops: ["maria-ch"] })])).toEqual(["maria"]);
    expect(unplacedUrgentRequestIds(urgentStops, [leg({ stops: ["maria-ch", "maria-po"] })])).toEqual([]);
  });
});

describe("pickLegDestination", () => {
  it("fills an already-added blank leg with every unplaced stop for that pool destination", () => {
    const legs = pickLegDestination([leg({}), finalLeg()], 0, "d1", stops, new Set());
    expect(legs[0]).toMatchObject({ destinationId: "d1", stops: ["juan-ch", "maria-ch"] });
    expect(legs[1].isFinal).toBe(true);
  });

  it("merges into an existing request-linked leg and drops the now-redundant blank one", () => {
    const legs = [leg({ destinationId: "d1", stops: ["juan-ch"] }), leg({}), finalLeg()];
    const next = pickLegDestination(legs, 1, "d1", stops, new Set());
    expect(next).toHaveLength(2);
    expect(next[0].stops).toEqual(["juan-ch", "maria-ch"]);
    expect(next[1].isFinal).toBe(true);
  });

  it("never merges into a stop-less (fuel/errand) leg", () => {
    const legs = [leg({ destinationId: "d1", stops: [] }), leg({}), finalLeg()];
    const next = pickLegDestination(legs, 1, "d1", stops, new Set());
    expect(next).toHaveLength(3);
    expect(next[0].stops).toEqual([]);
    expect(next[1]).toMatchObject({ destinationId: "d1", stops: ["juan-ch", "maria-ch"] });
  });

  it("does nothing once every stop for that destination is already placed", () => {
    const legs = [leg({ destinationId: "d1", stops: ["juan-ch", "maria-ch"] }), leg({}), finalLeg()];
    expect(pickLegDestination(legs, 1, "d1", stops, new Set())).toBe(legs);
  });

  it("sets a fixed (fuel/errand) destination directly, with no stops", () => {
    const legs = pickLegDestination([leg({}), finalLeg()], 0, "shell", stops, new Set(["shell"]));
    expect(legs[0]).toMatchObject({ destinationId: "shell", stops: [] });
  });
});

describe("Other-destination pool stops", () => {
  const otherStops: StopInfo[] = [
    ...stops,
    { id: "juan-wh", requestId: "juan", requester: "Juan", destinationName: "Warehouse X", destinationIsOther: true, purposeName: "Delivery" },
    { id: "maria-wh", requestId: "maria", requester: "Maria", destinationName: "Warehouse X", destinationIsOther: true, purposeName: "Pickup" },
    { id: "juan-other2", requestId: "juan", requester: "Juan", destinationName: "Different Site", destinationIsOther: true, purposeName: "Errand" },
  ];

  it("groups Other stops by their free text, not by (absent) id", () => {
    expect(poolDestinationChoices(otherStops, [])).toEqual(
      expect.arrayContaining([
        { id: "other:Warehouse X", name: "Warehouse X", urgent: false },
        { id: "other:Different Site", name: "Different Site", urgent: false },
      ]),
    );
  });

  it("builds a leg from an Other group key with no destinationId", () => {
    const legs = pickLegDestination([leg({}), finalLeg()], 0, "other:Warehouse X", otherStops, new Set());
    expect(legs[0]).toMatchObject({ destinationId: "", destinationOther: "Warehouse X", stops: ["juan-wh", "maria-wh"] });
  });

  it("never merges two Other stops with different text onto one leg", () => {
    const withWarehouse = pickLegDestination([leg({}), finalLeg()], 0, "other:Warehouse X", otherStops, new Set());
    const withBlank = addLeg(withWarehouse);
    const next = pickLegDestination(withBlank, 1, "other:Different Site", otherStops, new Set());
    expect(next).toHaveLength(3);
    expect(next[0].destinationOther).toBe("Warehouse X");
    expect(next[1].destinationOther).toBe("Different Site");
  });

  it("candidatesForLeg matches an Other leg only to stops with the same text", () => {
    const legs = pickLegDestination([leg({}), finalLeg()], 0, "other:Warehouse X", otherStops, new Set());
    expect(candidatesForLeg(legs, 0, otherStops).map((stop) => stop.id).sort()).toEqual(["juan-wh", "maria-wh"]);
  });

  it("legOrigins and legHasContent recognise an Other-destination leg", () => {
    const legs = pickLegDestination([leg({}), finalLeg()], 0, "other:Warehouse X", otherStops, new Set());
    expect(legOrigins(legs, (l) => (l.isFinal ? "ANONANG" : l.destinationOther))).toEqual(["ANONANG", "Warehouse X"]);
    expect(legHasContent(legs[0])).toBe(true);
  });

  it("tripProblems accepts a fully-stopped Other leg and flags an emptied one", () => {
    const filled = pickLegDestination([leg({}), finalLeg()], 0, "other:Warehouse X", otherStops, new Set());
    const filledProblems = tripProblems({ plate: "V1", requestIds: ["juan", "maria"], legs: filled, stops: otherStops });
    expect(filledProblems.save).not.toContain("Leg 1: choose a destination.");

    const emptied = filled.map((item, index) => (index === 0 ? { ...item, stops: [] } : item));
    const emptiedProblems = tripProblems({ plate: "V1", requestIds: [], legs: emptied, stops: otherStops });
    expect(emptiedProblems.save).toContain("Leg 1: this stop has no request on it. Remove it.");
  });
});

describe("isOtherStopLeg", () => {
  it("is true only for a non-final leg whose destination is flagged", () => {
    const otherStopIds = new Set(["shell"]);
    expect(isOtherStopLeg(leg({ destinationId: "shell" }), otherStopIds)).toBe(true);
    expect(isOtherStopLeg(leg({ destinationId: "d1" }), otherStopIds)).toBe(false);
    expect(isOtherStopLeg({ ...finalLeg(), destinationId: "shell" }, otherStopIds)).toBe(false);
  });
});

describe("shared stops", () => {
  it("doesn't offer a stop another leg already serves", () => {
    const legs = [leg({ destinationId: "d1", stops: ["juan-ch"] }), leg({ destinationId: "d1" })];
    expect(candidatesForLeg(legs, 1, stops).map((stop) => stop.id)).toEqual(["maria-ch"]);
  });

  it("drops stops of a request that is deselected", () => {
    const legs = [leg({ destinationId: "d1", stops: ["juan-ch", "maria-ch"] })];
    expect(keepStops(legs, new Set(["juan-ch"]))[0].stops).toEqual(["juan-ch"]);
  });
});

describe("servedRequestIds", () => {
  it("lists a request once any of its stops is on a leg", () => {
    const legs = [leg({ destinationId: "d1", stops: ["juan-ch"] }), finalLeg()];
    expect(servedRequestIds(legs, stops)).toEqual(["juan"]);
  });

  it("is empty when nothing has been placed yet", () => {
    expect(servedRequestIds([finalLeg()], stops)).toEqual([]);
  });
});

describe("reflowFinalLegTimeOut", () => {
  it("fills the final leg's empty Time Out from the leg before it", () => {
    const legs = [leg({ destinationId: "d1", plannedTimeOut: "08:00", plannedTimeIn: "09:00" }), finalLeg()];
    expect(reflowFinalLegTimeOut(legs)[1].plannedTimeOut).toBe("09:00");
  });

  it("fixes a final Time Out left stale by a leg inserted after it was set", () => {
    // The final leg's Time Out was copied from the old previous leg (09:00);
    // a new leg lands before it with a later Time In (09:30).
    const legs = [
      leg({ destinationId: "d1", plannedTimeOut: "08:00", plannedTimeIn: "09:00" }),
      leg({ destinationId: "d2", plannedTimeOut: "09:00", plannedTimeIn: "09:30" }),
      { ...finalLeg(), plannedTimeOut: "09:00" },
    ];
    expect(reflowFinalLegTimeOut(legs)[2].plannedTimeOut).toBe("09:30");
  });

  it("leaves an already-consistent final Time Out alone", () => {
    const legs = [leg({ destinationId: "d1", plannedTimeOut: "08:00", plannedTimeIn: "09:00" }), { ...finalLeg(), plannedTimeOut: "10:00" }];
    expect(reflowFinalLegTimeOut(legs)).toBe(legs);
  });

  it("does nothing when the leg before the final one has no Time In yet", () => {
    const legs = [leg({ destinationId: "d1" }), finalLeg()];
    expect(reflowFinalLegTimeOut(legs)).toBe(legs);
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

  it("doesn't require times to save a draft, only to submit it", () => {
    const legs = [leg({ destinationId: "d1", stops: ["juan-ch"] })];
    expect(legs[0].plannedTimeOut).toBe("");
    const problems = tripProblems({ ...base, legs });
    expect(problems.save).not.toContain("Leg 1: enter planned Time Out and Time In.");
    expect(problems.submit).toContain("Leg 1: enter planned Time Out and Time In.");
  });

  it("blocks a half-entered time at save, not just at submit", () => {
    const legs = [leg({ destinationId: "d1", stops: ["juan-ch"], plannedTimeOut: "08:00" })];
    expect(tripProblems({ ...base, legs }).save).toContain("Leg 1: enter planned Time Out and Time In.");
  });

  it("rejects a leg with no request stops unless its destination is an other stop", () => {
    const legs = [leg({ destinationId: "shell", plannedTimeOut: "08:00", plannedTimeIn: "09:00" })];
    const blocked = tripProblems({ ...base, legs, requestIds: ["juan"], stops: [] });
    expect(blocked.save).toContain(
      "Leg 1: this stop has no request on it. Remove it, or mark its destination as a fuel/errand stop in Settings.",
    );
    const allowed = tripProblems({
      ...base,
      legs,
      requestIds: ["juan"],
      stops: [],
      otherStopDestinationIds: new Set(["shell"]),
    });
    expect(allowed.save).toEqual([]);
  });

  it("flags times that run backwards", () => {
    const legs = [
      leg({ destinationId: "d1", stops: ["juan-ch"], plannedTimeOut: "09:00", plannedTimeIn: "08:00" }),
      leg({ destinationId: "d2", stops: ["maria-po"], plannedTimeOut: "07:00", plannedTimeIn: "10:00" }),
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
    expect(problems.submit).toEqual(["Add the final leg back to ANONANG."]);
  });

  it("doesn't require pool requests this route doesn't serve", () => {
    const legs = [
      leg({ destinationId: "d1", stops: ["juan-ch"], plannedTimeOut: "08:00", plannedTimeIn: "09:00" }),
      { ...finalLeg(), plannedTimeOut: "09:30", plannedTimeIn: "10:30" },
    ];
    expect(tripProblems({ ...base, legs }).submit).toEqual([]);
  });

  it("doesn't block a request that is only partly on the route; its other stops are split off", () => {
    const legs = [
      leg({ destinationId: "d1", stops: ["juan-ch", "maria-ch"], plannedTimeOut: "08:00", plannedTimeIn: "09:00" }),
      { ...finalLeg(), plannedTimeOut: "09:30", plannedTimeIn: "10:30" },
    ];
    expect(tripProblems({ ...base, legs }).submit).toEqual([]);
    expect(splitOffs(stops, legs)).toEqual([
      { requestId: "maria", requester: "Maria", urgent: false, stopIds: ["maria-po"], destinations: ["Port Office"] },
    ]);
  });

  it("splits nothing off a request with no stop on the route, or every stop on it", () => {
    expect(splitOffs(stops, [leg({ destinationId: "d1", stops: ["juan-ch"] })])).toEqual([]);
    expect(splitOffs(stops, [leg({ stops: ["maria-ch", "maria-po"] })])).toEqual([]);
  });

  it("requires a vehicle and a request", () => {
    expect(tripProblems({ plate: "", requestIds: [], stops: [], legs: complete }).save).toEqual([
      "Select a vehicle.",
      "Serve at least one request.",
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
    expect(done({ ...base, legs: complete })).toEqual([true, true, true, true, true]);
  });

  it("leaves everything to do on a brand-new Trip Record", () => {
    const items = tripChecklist({ plate: "", hasDriver: false, requestIds: [], legs: initialLegs(), stops: [] });
    expect(items.map((item) => item.done)).toEqual([false, false, false, false, true]);
  });

  it("leaves missing times to the leg, with no checklist detail", () => {
    const legs = [{ ...complete[0], plannedTimeIn: "" }, complete[1], complete[2]];
    const times = tripChecklist({ ...base, legs })[3];
    expect(times.done).toBe(false);
    expect(times.detail).toBeUndefined();
  });

  it("explains a vehicle with no Driver", () => {
    const item = tripChecklist({ ...base, hasDriver: false, legs: complete })[1];
    expect(item.done).toBe(false);
    expect(item.detail).toMatch(/Admin assigns one in Settings/);
  });

  it("agrees with tripProblems: the first four items are Save draft, all five are Submit", () => {
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
