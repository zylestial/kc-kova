import { describe, expect, it } from "vitest";
import type { RequestGroup, TransportRequest } from "@/lib/kova-api";
import { canShareTrip, companyTripSteps } from "@/lib/company-trips";

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

describe("canShareTrip", () => {
  it("needs the same vehicle, Driver, department and starting point", () => {
    expect(canShareTrip(stop("a"), stop("b", { group: group("other") }))).toBe(true);
    expect(canShareTrip(stop("a"), stop("b", { group: group("o", { department: { id: "proc", name: "Procurement" } }) }))).toBe(false);
    expect(canShareTrip(stop("a"), stop("b", { group: group("o", { driver: { id: "ben", name: "Ben" } }) }))).toBe(false);
  });
});

describe("companyTripSteps", () => {
  const legs = [
    { id: "l1", origin: "Main Office", destinationName: "BIR" },
    { id: "l2", origin: "BIR", destinationName: "BDO" },
  ];

  it("starts at the starting point and ends on arriving at the last stop", () => {
    expect(companyTripSteps(legs, undefined, []).map((step) => step.label)).toEqual([
      "Start trip at Main Office",
      "Arrived at BIR",
      "Leaving BIR",
      "Arrived at BDO · End trip",
    ]);
  });

  it("marks what was tapped", () => {
    const steps = companyTripSteps(legs, { startAt: "t0" }, [{ legId: "l1", kind: "ARRIVE", at: "t1" }]);
    expect(steps.map((step) => step.at)).toEqual(["t0", "t1", undefined, undefined]);
  });

  it("passes over a stop reported missed (0061)", () => {
    const steps = companyTripSteps(legs, { startAt: "t0" }, [], new Set(["l1"]));
    expect(steps.map((step) => !!step.missed)).toEqual([false, true, true, false]);
  });
});
