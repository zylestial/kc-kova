import { describe, expect, it } from "vitest";
import type { Account, BookingOption, RequestGroup, Schedule, ScheduleLeg, TransportRequest } from "@/lib/kova-api";
import { planOn, planOptions, type PlanContext } from "@/lib/scheduling-plan";
import type { VehicleRow } from "@/lib/scheduling";

const group = (patch: Partial<RequestGroup> = {}): RequestGroup => ({
  id: "g",
  number: 52,
  ownerAccountId: "o",
  ownerName: "Ana",
  form: "DAILY",
  date: "2026-10-20",
  siteOfficer: "",
  siteCompany: "",
  rowVersion: 1,
  createdAt: "",
  ...patch,
});
const stop = (id: string, destinationId: string, patch: Partial<TransportRequest> = {}): TransportRequest => ({
  id,
  group: group(),
  stopLetter: "A",
  details: "",
  flexibility: "DAY",
  contact: "Liza",
  ownerAccountId: "o",
  ownerName: "Ana",
  date: "2026-10-20",
  requestType: "REGULAR",
  projectName: "Riverside",
  projectIsOther: false,
  status: "ACTIVE",
  rowVersion: 1,
  createdAt: "",
  updatedAt: "",
  progress: "NOT_YET_SCHEDULED",
  cancellationPending: false,
  destinations: [{ id: "rd-" + id, position: 1, destinationId, destinationName: destinationId, destinationIsOther: false, purposeName: "Pick up", purposeIsOther: false }],
  ...patch,
});
// No saved locations: every drive is 30 minutes; a Pick up stays 30.
const destinations: BookingOption[] = [];
const context = (requests: TransportRequest[], patch: Partial<PlanContext> = {}): PlanContext => ({
  requests,
  destinations,
  day: "2026-10-20",
  isToday: false,
  now: "09:00",
  started: () => false,
  reached: () => 0,
  ...patch,
});
const driver = { id: "d1", name: "Mario", role: "Driver", status: "Active" } as Account;
const row = (trips: VehicleRow["trips"] = [], patch: Partial<VehicleRow> = {}): VehicleRow => ({
  vehicle: { plate: "V1", name: "Van 1", status: "Active", assignedDriverId: "d1", companyTrips: false },
  kind: "DAILY",
  driver,
  trips,
  ...patch,
});
const leg = (no: number, destinationId: string | undefined, out: string, inn: string, stops: string[], isFinal = false): ScheduleLeg => ({
  id: "l" + no,
  legNo: no,
  origin: "",
  destinationId,
  destinationName: destinationId ?? "ANONANG",
  plannedTimeOut: out,
  plannedTimeIn: inn,
  contactName: "",
  contactNumber: "",
  isFinal,
  stops,
});
const trip = (legs: ScheduleLeg[], requestIds: string[], status: "DRAFT" | "SUBMITTED" | "APPROVED" = "DRAFT"): VehicleRow["trips"][number] => {
  const revision = { id: "r1", version: 1, status, plate: "V1", driverId: "d1", driverName: "Mario", rowVersion: 3, createdAt: "", updatedAt: "", decisionComment: "", requestIds, legs };
  const schedule: Schedule = {
    id: "s1",
    date: "2026-10-20",
    kind: "DAILY",
    createdByAccountId: "",
    status: "ACTIVE",
    publishedRevisionId: status === "APPROVED" ? "r1" : undefined,
    createdAt: "",
    updatedAt: "",
    revisions: [revision],
  };
  return { schedule, revision };
};

describe("a new trip", () => {
  it("leaves ANONANG at 8 AM, goes to the stop and comes back", () => {
    const wilcon = stop("a", "wilcon");
    const option = planOn([wilcon], row(), context([wilcon]));
    expect(option.blocked).toBe("");
    expect(option.label).toBe("Free · new trip");
    expect(option.input.legs.map((item) => [item.destinationId, item.plannedTimeOut, item.plannedTimeIn, item.isFinal])).toEqual([
      ["wilcon", "08:00", "08:30", false],
      [undefined, "09:00", "09:30", true],
    ]);
    expect(option.input.legs[0]).toMatchObject({ stops: ["rd-a"], contactName: "Liza" });
    expect([option.arrive, option.end, option.extra]).toEqual(["08:30", "09:30", 90]);
  });

  it("can't go on a vehicle without a Driver", () => {
    expect(planOn([stop("a", "wilcon")], row([], { driver: undefined }), context([])).blocked).toBe("No Driver assigned");
  });
});

describe("joining a trip", () => {
  const a = stop("a", "wilcon");
  const b = stop("b", "bir");
  const existing = trip(
    [leg(1, "wilcon", "08:00", "08:30", ["rd-a"]), leg(2, undefined, "09:00", "09:30", [], true)],
    ["a"],
  );

  it("shares the leg when the trip already goes there", () => {
    const again = stop("c", "wilcon");
    const option = planOn([again], row([existing]), context([a, again]));
    expect(option.label).toBe("Combine with the wilcon stop");
    expect(option.input.legs[0].stops).toEqual(["rd-a", "rd-c"]);
    expect(option.input.requestIds).toEqual(["a", "c"]);
    expect(option.rowVersion).toBe(3);
  });

  it("doesn't make an any-time stop wait with a fixed-time stop there", () => {
    const fixed = stop("f", "wilcon", { flexibility: "FIXED", fixedTime: "13:00" });
    const atOne = trip([leg(1, "wilcon", "08:00", "13:00", ["rd-f"]), leg(2, undefined, "13:30", "14:00", [], true)], ["f"]);
    const again = stop("c", "wilcon");
    const option = planOn([again], row([atOne]), context([fixed, again]));
    expect(option.input.legs.map((item) => [item.destinationId, item.stops])).toEqual([
      ["wilcon", ["rd-c"]],
      ["wilcon", ["rd-f"]],
      [undefined, []],
    ]);
    expect(option.arrive).toBe("08:30");
  });

  it("shares a fixed-time leg the vehicle reaches about on time", () => {
    const fixed = stop("f", "wilcon", { flexibility: "FIXED", fixedTime: "08:45" });
    const soon = trip([leg(1, "wilcon", "08:00", "08:45", ["rd-f"]), leg(2, undefined, "09:15", "09:45", [], true)], ["f"]);
    const again = stop("c", "wilcon");
    const option = planOn([again], row([soon]), context([fixed, again]));
    expect(option.label).toBe("Combine with the wilcon stop");
    expect(option.input.legs[0].stops).toEqual(["rd-f", "rd-c"]);
  });

  it("goes where the trip ends soonest, before the leg back to ANONANG", () => {
    const option = planOn([b], row([existing]), context([a, b]));
    expect(option.input.legs.map((item) => item.destinationId)).toEqual(["wilcon", "bir", undefined]);
    expect(option.label).toBe("After wilcon");
    expect([option.arrive, option.extra]).toEqual(["09:30", 60]);
  });

  it("goes into draft changes on an approved trip", () => {
    const approved = trip(existing.revision.legs, ["a"], "APPROVED");
    expect(planOn([b], row([approved]), context([a, b]))).toMatchObject({ needsAdmin: true, rowVersion: null });
  });

  it("goes into draft changes on a trip on the road, after the legs the Driver has reached", () => {
    const approved = trip(existing.revision.legs, ["a"], "APPROVED");
    const option = planOn([b], row([approved]), context([a, b], { started: () => true, reached: () => 1 }));
    expect(option).toMatchObject({ blocked: "", needsAdmin: true, rowVersion: null });
    expect(option.input.legs.map((item) => [item.id, item.destinationId])).toEqual([
      ["l1", "wilcon"],
      [undefined, "bir"],
      ["l2", undefined],
    ]);
  });

  it("can still go on a trip waiting for Admin, which stays waiting", () => {
    const waiting = trip(existing.revision.legs, ["a"], "SUBMITTED");
    expect(planOn([b], row([waiting]), context([a, b]))).toMatchObject({ blocked: "", needsAdmin: false, rowVersion: 3 });
  });

  it("names a fixed-time stop it would make late", () => {
    // Nothing reaches a 7:30 stop from an 8:00 start.
    const fixed = stop("f", "city-hall", { flexibility: "FIXED", fixedTime: "07:30" });
    const late = planOn([fixed], row([existing]), context([a, fixed]));
    expect(late.late).toEqual(["f"]);
  });
});

describe("planOptions", () => {
  it("lists vehicles that can take it first", () => {
    const a = stop("a", "wilcon");
    const options = planOptions([a], [row([], { driver: undefined }), row()], context([a]));
    expect(options.map((option) => option.blocked)).toEqual(["", "No Driver assigned"]);
  });

  it("offers a Company stop only on the vehicle the requester asked for", () => {
    const c = stop("c", "bdo", { group: group({ form: "COMPANY", vehiclePlate: "NBC" }) });
    const company = row([], { kind: "COMPANY", driver: undefined, vehicle: { plate: "NBC", name: "Mirage", status: "Active", companyTrips: true } });
    const other = row([], { kind: "COMPANY", driver: undefined, vehicle: { plate: "XYZ", name: "Vios", status: "Active", companyTrips: true } });
    const [first, second] = planOptions([c], [other, company], context([c]));
    expect(first.row.vehicle.plate).toBe("NBC");
    expect(first.input.legs).toHaveLength(1);
    expect(second.blocked).toBe("Asked for NBC");
  });

  it("keeps a Company request's stops in the order the requester gave", () => {
    const companyGroup = group({ form: "COMPANY", vehiclePlate: "NBC" });
    // A Delivery stays 45 and a Pick up 30, so B first would end sooner.
    const a = stop("a", "wilcon", { group: companyGroup, destinations: [{ ...stop("a", "wilcon").destinations[0], purposeName: "Delivery" }] });
    const b = stop("b", "bir", { group: companyGroup, stopLetter: "B" });
    const first = trip([leg(1, "wilcon", "08:00", "08:30", ["rd-a"])], ["a"]);
    first.schedule.kind = "COMPANY";
    const company = row([first], { kind: "COMPANY", driver: undefined, vehicle: { plate: "NBC", name: "Mirage", status: "Active", companyTrips: true } });
    const option = planOn([b], company, context([a, b]));
    expect(option.input.legs.map((item) => item.destinationId)).toEqual(["wilcon", "bir"]);
  });

  it("starts a new Company trip after one already on the road", () => {
    const companyGroup = group({ form: "COMPANY", vehiclePlate: "NBC" });
    const a = stop("a", "wilcon", { group: companyGroup });
    const c = stop("c", "bir", { group: group({ id: "g2", number: 53, form: "COMPANY", vehiclePlate: "NBC" }) });
    const first = trip([leg(1, "wilcon", "08:00", "08:30", ["rd-a"])], ["a"], "APPROVED");
    first.schedule.kind = "COMPANY";
    const company = row([first], { kind: "COMPANY", driver: undefined, vehicle: { plate: "NBC", name: "Mirage", status: "Active", companyTrips: true } });
    const option = planOn([c], company, context([a, c], { started: () => true }));
    expect(option).toMatchObject({ blocked: "", arrive: "09:15" });
    expect(option.trip).toBeUndefined();
  });
});
