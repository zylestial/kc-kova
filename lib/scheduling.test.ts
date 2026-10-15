import { describe, expect, it } from "vitest";
import type { Account, RequestGroup, Schedule, ScheduleRevision, TransportRequest, Vehicle } from "@/lib/kova-api";
import { dayCounts, placeGroups, schedulingHref, toPlan, tripState, vehicleRows, weekStops } from "@/lib/scheduling";

const group = (patch: Partial<RequestGroup> = {}): RequestGroup => ({
  id: "g",
  number: 52,
  ownerAccountId: "o",
  ownerName: "Ana",
  form: "DAILY",
  date: "2026-10-14",
  siteOfficer: "",
  siteCompany: "",
  rowVersion: 1,
  createdAt: "",
  ...patch,
});
const stop = (id: string, patch: Partial<TransportRequest> = {}, destinationId = "wilcon"): TransportRequest => ({
  id,
  group: group(),
  stopLetter: id.toUpperCase(),
  details: "",
  flexibility: "DAY",
  contact: "",
  ownerAccountId: "o",
  ownerName: "Ana",
  date: "2026-10-14",
  requestType: "REGULAR",
  projectName: "Riverside",
  projectIsOther: false,
  status: "ACTIVE",
  rowVersion: 1,
  createdAt: "2026-10-10T00:00:00Z",
  updatedAt: "",
  progress: "NOT_YET_SCHEDULED",
  cancellationPending: false,
  destinations: [{ id: "rd-" + id, position: 1, destinationId, destinationName: destinationId, destinationIsOther: false, purposeName: "Pick up", purposeIsOther: false }],
  ...patch,
});

describe("what's to plan", () => {
  const requests = [
    stop("a"),
    stop("b", { requestType: "URGENT" }),
    stop("c", { flexibility: "FIXED", fixedTime: "11:00" }),
    stop("d", { flexibility: "WEEK", date: "2026-10-16" }),
    stop("e", { progress: "SCHEDULING" }),
    stop("f", { date: "2026-10-15" }),
  ];

  it("lists the day's waiting stops, urgent first, then fixed times; any-day-that-week stops apart", () => {
    expect(toPlan(requests, "2026-10-14").map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(weekStops(requests, "2026-10-14").map((item) => item.id)).toEqual(["d"]);
    expect(weekStops(requests, "2026-10-20")).toEqual([]);
    expect(dayCounts(requests, "2026-10-14")).toEqual({ toPlan: 3, urgent: 1 });
    const company = stop("x", { group: group({ form: "COMPANY", vehiclePlate: "NBC-4821" }) });
    expect(toPlan([...requests, company], "2026-10-14", "COMPANY").map((item) => item.id)).toEqual(["x"]);
    expect(dayCounts([...requests, company], "2026-10-14", "DAILY")).toEqual({ toPlan: 3, urgent: 1 });
  });

  it("groups stops at the same place, but a Company stop only with its own vehicle's", () => {
    const company = stop("x", { group: group({ form: "COMPANY", vehiclePlate: "NBC-4821" }) });
    const groups = placeGroups([stop("a"), stop("b", {}, "bir"), stop("c", { requestType: "URGENT" }), company]);
    expect(groups.map((item) => item.map((request) => request.id))).toEqual([["c", "a"], ["b"], ["x"]]);
  });
});

const revision = (status: ScheduleRevision["status"], id = "r-" + status): ScheduleRevision => ({
  id,
  version: 1,
  status,
  plate: "V1",
  driverId: "d1",
  driverName: "Mario",
  rowVersion: 1,
  createdAt: "",
  updatedAt: "",
  decisionComment: "",
  requestIds: [],
  legs: [],
});
const schedule = (revisions: ScheduleRevision[], publishedRevisionId?: string): Schedule => ({
  id: "s",
  date: "2026-10-14",
  kind: "DAILY",
  createdByAccountId: "",
  status: "ACTIVE",
  publishedRevisionId,
  createdAt: "",
  updatedAt: "",
  revisions,
});

describe("trips", () => {
  it("names where a trip stands, including changes to an approved one", () => {
    expect(tripState(schedule([revision("DRAFT")]), false)).toBe("DRAFT");
    expect(tripState(schedule([revision("SUBMITTED")]), false)).toBe("SUBMITTED");
    expect(tripState(schedule([revision("APPROVED", "p")], "p"), false)).toBe("APPROVED");
    expect(tripState(schedule([revision("APPROVED", "p")], "p"), true)).toBe("ON_THE_ROAD");
    expect(tripState(schedule([revision("APPROVED", "p"), revision("DRAFT")], "p"), false)).toBe("CHANGES");
    expect(tripState(schedule([revision("APPROVED", "p"), revision("SUBMITTED")], "p"), false)).toBe("CHANGES_SUBMITTED");
  });

  it("lists Daily vehicles first with their Driver, then vehicles for company trips", () => {
    const vehicles: Vehicle[] = [
      { plate: "NBC", name: "Mirage", status: "Active", companyTrips: true },
      { plate: "V1", name: "Van 1", status: "Active", assignedDriverId: "d1", companyTrips: false },
      { plate: "OLD", name: "Old van", status: "Inactive", companyTrips: false },
    ];
    const accounts = [{ id: "d1", name: "Mario", role: "Driver", status: "Active" }] as Account[];
    const rows = vehicleRows(vehicles, accounts, [schedule([revision("DRAFT")])], "2026-10-14");
    expect(rows.map((row) => [row.vehicle.plate, row.kind, row.driver?.name, row.trips.length])).toEqual([
      ["V1", "DAILY", "Mario", 1],
      ["NBC", "COMPANY", undefined, 0],
    ]);
  });
});

describe("links", () => {
  it("opens Scheduling on a day and kind", () => {
    expect(schedulingHref()).toBe("/scheduling");
    expect(schedulingHref("2026-10-15")).toBe("/scheduling?date=2026-10-15");
    expect(schedulingHref("2026-10-15", "COMPANY")).toBe("/scheduling?date=2026-10-15&type=COMPANY");
    expect(schedulingHref("2026-10-15", "DAILY", "s1")).toBe("/scheduling?date=2026-10-15&type=DAILY&trip=s1");
  });
});
