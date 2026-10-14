import { describe, expect, it } from "vitest";
import type { RequestGroup, TransportRequest } from "@/lib/kova-api";
import {
  canShareTrip,
  estimateLegs,
  legProblems,
  linkedRuns,
  overlaps,
  timelinePercent,
  tripInput,
  tripSpan,
  waitingStops,
} from "@/lib/company-trips";

const group = (id: string, patch: Partial<RequestGroup> = {}): RequestGroup => ({
  id,
  number: 52,
  ownerAccountId: "o",
  ownerName: "Rhea",
  form: "COMPANY",
  date: "2026-10-20",
  vehiclePlate: "NBC-4821",
  driver: { id: "jun", name: "Jun Reyes" },
  department: { id: "acc", name: "Accounting" },
  startingPoint: { id: "main", name: "Main Office" },
  siteOfficer: "",
  siteCompany: "",
  rowVersion: 1,
  createdAt: "",
  ...patch,
});
const stop = (id: string, patch: Partial<TransportRequest> = {}): TransportRequest => ({
  id,
  group: group("g"),
  stopLetter: id.toUpperCase(),
  details: "",
  flexibility: "DAY",
  contact: "Teller",
  ownerAccountId: "o",
  ownerName: "Rhea",
  date: "2026-10-20",
  requestType: "REGULAR",
  projectName: "Head office",
  projectIsOther: false,
  status: "ACTIVE",
  rowVersion: 1,
  createdAt: "2026-10-10T00:00:00Z",
  updatedAt: "",
  progress: "NOT_YET_SCHEDULED",
  cancellationPending: false,
  destinations: [
    { id: "rd-" + id, position: 1, destinationId: "d-" + id, destinationName: "BDO", destinationIsOther: false, purposeName: "Errand", purposeIsOther: false },
  ],
  ...patch,
});

describe("planning order", () => {
  it("lists waiting stops most urgent first, and keeps stops requested together side by side", () => {
    const waiting = waitingStops([
      stop("a", { flexibility: "WEEK" }),
      stop("b", { requestType: "URGENT" }),
      stop("c", { progress: "SCHEDULING" }),
      stop("d", { flexibility: "FIXED", fixedTime: "10:00", group: group("other") }),
    ]);
    expect(waiting.map((item) => item.id)).toEqual(["b", "d", "a"]);
    expect(linkedRuns([stop("a"), stop("b"), stop("x", { group: group("other") })]).map((run) => run.length)).toEqual([2, 1]);
  });
});

describe("canShareTrip", () => {
  it("needs the same vehicle, Driver, department and starting point", () => {
    expect(canShareTrip(stop("a"), stop("b", { group: group("other") }))).toBe(true);
    expect(canShareTrip(stop("a"), stop("b", { group: group("o", { department: { id: "proc", name: "Procurement" } }) }))).toBe(false);
    expect(canShareTrip(stop("a"), stop("b", { group: group("o", { driver: { id: "ben", name: "Ben" } }) }))).toBe(false);
  });
});

describe("estimateLegs", () => {
  it("starts at 8 AM with half an hour to drive and half an hour at each stop", () => {
    expect(estimateLegs([stop("a"), stop("b")])).toEqual([
      { requestId: "a", plannedTimeOut: "08:00", plannedTimeIn: "08:30" },
      { requestId: "b", plannedTimeOut: "09:00", plannedTimeIn: "09:30" },
    ]);
  });

  it("arrives at a fixed-time stop on time", () => {
    const legs = estimateLegs([stop("a"), stop("b", { flexibility: "FIXED", fixedTime: "13:00" })]);
    expect(legs[1]).toEqual({ requestId: "b", plannedTimeOut: "12:30", plannedTimeIn: "13:00" });
    expect(legs[0].plannedTimeOut).toBe("11:30");
  });
});

describe("tripInput and checks", () => {
  it("sends one leg per stop with its destination and contact, and no leg back to ANONANG", () => {
    const stops = [stop("a"), stop("b")];
    const input = tripInput("2026-10-20", "NBC-4821", stops, estimateLegs(stops));
    expect(input.requestIds).toEqual(["a", "b"]);
    expect(input.legs[1]).toMatchObject({ destinationId: "d-b", stops: ["rd-b"], contactName: "Teller", isFinal: false });
  });

  it("names missing or backwards times", () => {
    const stops = [stop("a"), stop("b")];
    expect(legProblems([{ requestId: "a", plannedTimeOut: "09:00", plannedTimeIn: "08:00" }, { requestId: "b", plannedTimeOut: "", plannedTimeIn: "" }], stops)).toEqual([
      "52-A: Time In must be after Time Out.",
      "52-B: enter Time Out and Time In.",
    ]);
    expect(legProblems(estimateLegs(stops), stops)).toEqual([]);
  });

  it("works out a trip's span and overlaps on the timeline", () => {
    const span = tripSpan(estimateLegs([stop("a"), stop("b")]))!;
    expect(span).toEqual({ start: "08:00", end: "09:30" });
    expect(overlaps(span, { start: "09:30", end: "10:00" })).toBe(false);
    expect(overlaps(span, { start: "09:00", end: "10:00" })).toBe(true);
    expect(timelinePercent("06:00")).toBe(0);
    expect(timelinePercent("20:00")).toBe(100);
  });
});
