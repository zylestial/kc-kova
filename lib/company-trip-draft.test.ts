import { describe, expect, it } from "vitest";
import type { CompanyTripBooking, RequestGroup, TransportRequest } from "@/lib/kova-api";
import {
  companyDraftFromGroup,
  companyDraftToInput,
  companyTripErrors,
  companyTripMissing,
  emptyCompanyTripDraft,
  personBusy,
  vehicleClashes,
  type CompanyTripDraft,
} from "@/lib/company-trip-draft";

const filled = (patch: Partial<CompanyTripDraft> = {}): CompanyTripDraft => ({
  ...emptyCompanyTripDraft("2026-12-02", { id: "me", canDrive: true }),
  vehiclePlate: "NBC-4821",
  timeOut: "08:00",
  timeIn: "09:50",
  stops: [
    { key: "a", destinationId: "dest-hardware", arriveAt: "08:40", leaveAt: "09:10" },
    { key: "b", destinationId: "dest-warehouse", arriveAt: "", leaveAt: "" },
  ],
  purpose: "Pick up rebar",
  departmentId: "proj-bridge",
  fleetCard: "4821",
  ...patch,
});

describe("companyTripErrors", () => {
  it("passes a complete trip", () => {
    expect(companyTripErrors(filled())).toEqual({});
  });

  it("starts with me as the Driver only when I can drive", () => {
    expect(emptyCompanyTripDraft("2026-12-02", { id: "me", canDrive: true }).driverId).toBe("me");
    expect(emptyCompanyTripDraft("2026-12-02", { id: "me", canDrive: false }).driverId).toBe("");
  });

  it("needs the fleet card's 4 digits and an urgent reason", () => {
    const errors = companyTripErrors(filled({ fleetCard: "48a1", priority: "URGENT" }));
    expect(errors.fleetCard).toBeTruthy();
    expect(errors.urgentReason).toBeTruthy();
  });

  it("needs each time after the one before", () => {
    expect(companyTripErrors(filled({ timeOut: "08:50" })).times).toBe("The time you arrive at destination 1 must be after Time Out.");
    expect(
      companyTripErrors(filled({ stops: [{ key: "a", destinationId: "d", arriveAt: "08:40", leaveAt: "08:30" }, { key: "b", destinationId: "e", arriveAt: "", leaveAt: "" }] }))
        .times,
    ).toMatch(/leave destination 1/);
    expect(companyTripErrors(filled({ timeIn: "09:00" })).times).toBe("Time In must be after the time you leave destination 1.");
  });

  it("asks for arrive and leave only at destinations before the last", () => {
    const errors = companyTripErrors(filled({ stops: [{ key: "a", destinationId: "", arriveAt: "", leaveAt: "" }, { key: "b", destinationId: "e", arriveAt: "", leaveAt: "" }] }));
    expect(errors.stops).toEqual({ 0: { destination: "Pick a destination.", arriveAt: "Add when you arrive.", leaveAt: "Add when you leave." } });
    expect(companyTripMissing(errors)).toEqual(["Destination 1"]);
  });

  it("needs no Driver with a personal vehicle, but needs the vehicle", () => {
    expect(companyTripErrors(filled({ vehicleKind: "personal", driverId: "" }), "ABC 1234")).toEqual({});
    expect(companyTripErrors(filled({ vehicleKind: "personal" })).vehicle).toBeTruthy();
  });
});

describe("companyDraftToInput", () => {
  it("sends Time In as the last destination's arrival", () => {
    const input = companyDraftToInput(filled());
    expect(input.stops).toEqual([
      { destinationId: "dest-hardware", arriveAt: "08:40", leaveAt: "09:10" },
      { destinationId: "dest-warehouse", arriveAt: "09:50", leaveAt: "" },
    ]);
    expect(input.urgentReasonId).toBe("");
  });

  it("sends the personal vehicle's plate and no Driver", () => {
    const input = companyDraftToInput(filled({ vehicleKind: "personal" }), "ABC 1234");
    expect(input.vehiclePlate).toBe("ABC 1234");
    expect(input.driverId).toBe("");
  });
});

describe("companyDraftFromGroup", () => {
  const group = {
    id: "g",
    number: 7,
    ownerAccountId: "me",
    ownerName: "Grace",
    form: "COMPANY",
    date: "2026-12-02",
    department: { id: "proj-bridge", name: "Bridge" },
    vehiclePlate: "NBC-4821",
    driver: { id: "me", name: "Grace" },
    siteOfficer: "",
    siteCompany: "",
    purpose: "Pick up rebar",
    fleetCard: "4821",
    priority: "URGENT",
    urgentReason: { id: "urg-materials", name: "Materials" },
    rowVersion: 3,
    createdAt: "",
  } satisfies RequestGroup;
  const stop = (id: string, letter: string, destinationId: string) =>
    ({ id, stopLetter: letter, status: "ACTIVE", destinations: [{ destinationId }] }) as unknown as TransportRequest;

  it("reads the times back from the trip's legs", () => {
    const draft = companyDraftFromGroup(
      group,
      [stop("a", "A", "dest-hardware"), stop("b", "B", "dest-warehouse")],
      { groupId: "g", state: "RETURNED", comment: "", legs: [{ out: "08:00", in: "08:40" }, { out: "09:10", in: "09:50" }], passengers: [{ guestName: "Mr. Tan" }], finished: false, odometerStart: null, odometerEnd: null },
      undefined,
    );
    expect(draft).toMatchObject({ timeOut: "08:00", timeIn: "09:50", priority: "URGENT", urgentReasonId: "urg-materials", vehicleKind: "company" });
    expect(draft.stops.map(({ arriveAt, leaveAt }) => [arriveAt, leaveAt])).toEqual([["08:40", "09:10"], ["", ""]]);
    expect(draft.passengers).toEqual([{ guestName: "Mr. Tan" }]);
  });

  it("knows a personal vehicle by its plate", () => {
    expect(companyDraftFromGroup({ ...group, vehiclePlate: "ABC 1234" }, [], undefined, "ABC 1234").vehicleKind).toBe("personal");
  });
});

describe("bookings", () => {
  const bookings: CompanyTripBooking[] = [
    { scheduleId: "s1", plate: "NBC-4821", ownerName: "Paolo", startsAt: "08:30", endsAt: "10:45", accountIds: ["paolo", "mark"] },
    { scheduleId: "s2", plate: "NAB-2290", ownerName: "Ana", startsAt: "11:30", endsAt: "14:00", accountIds: ["ana"] },
  ];

  it("finds a vehicle's overlapping trip, not one that only touches", () => {
    expect(vehicleClashes(bookings, "NBC-4821", "10:00", "11:00")).toHaveLength(1);
    expect(vehicleClashes(bookings, "NBC-4821", "10:45", "11:00")).toHaveLength(0);
    expect(vehicleClashes(bookings, "NAB-2290", "10:00", "11:00")).toHaveLength(0);
  });

  it("finds a person already on a trip then", () => {
    expect(personBusy(bookings, "mark", "09:00", "09:30")?.ownerName).toBe("Paolo");
    expect(personBusy(bookings, "mark", "11:00", "12:00")).toBeUndefined();
    expect(personBusy(bookings, "mark", "", "")).toBeUndefined();
  });
});
