import { describe, expect, it } from "vitest";
import { toBooking, toBookingOption, toBookingOptions, toPerson, toProblemReport, toSchedule, toTransportRequest, toTripCompletion, toVehicleRecord } from "@/lib/supabase/mappers";

describe("toBooking", () => {
  it("maps snake_case columns to the Booking shape", () => {
    const booking = toBooking({
      id: "b1",
      date: "2026-01-01",
      plate: "ABC-123",
      start_hour: 8,
      end_hour: 12,
      driver_id: "d1",
      driver_name: "Driver One",
      project: "Site A",
      requested_by_account_id: "r1",
      requested_by_name: "Requester One",
      destination: "Warehouse",
      purpose: "Delivery",
      notes: "",
      created_by_account_id: "r1",
      created_at: "2026-01-01T00:00:00Z",
      status: "SCHEDULED",
      booking_type: "REGULAR",
      urgent_reason: "",
    });
    expect(booking).toEqual({
      id: "b1",
      date: "2026-01-01",
      plate: "ABC-123",
      start: 8,
      end: 12,
      driver: "Driver One",
      driverId: "d1",
      project: "Site A",
      requestedById: "r1",
      requestedByAccountId: "r1",
      requestedBy: "Requester One",
      destination: "Warehouse",
      purpose: "Delivery",
      notes: "",
      createdBy: "Requester One",
      createdByAccountId: "r1",
      createdAt: "2026-01-01T00:00:00Z",
      status: "SCHEDULED",
      bookingType: "REGULAR",
      urgentReason: "",
    });
  });
});

describe("toVehicleRecord", () => {
  it("spreads the jsonb payload and overlays the authoritative columns", () => {
    const record = toVehicleRecord({
      id: "row-id",
      date: "2026-01-01",
      plate: "ABC-123",
      data: { id: "stale-client-id", date: "stale-date", plate: "stale-plate", status: "SUBMITTED FOR REVIEW" },
    });
    expect(record).toEqual({ id: "row-id", date: "2026-01-01", plate: "ABC-123", status: "SUBMITTED FOR REVIEW" });
  });
});

describe("toBookingOptions", () => {
  it("groups rows by their group column", () => {
    const options = toBookingOptions([
      { group: "projects", id: "p1", name: "Project 1", status: "Active" },
      { group: "destinations", id: "d1", name: "Warehouse", status: "Active" },
      { group: "purposes", id: "u1", name: "Delivery", status: "Inactive" },
      { group: "projects", id: "p2", name: "Project 2", status: "Inactive" },
    ]);
    expect(options).toEqual({
      projects: [
        { id: "p1", name: "Project 1", status: "Active" },
        { id: "p2", name: "Project 2", status: "Inactive" },
      ],
      destinations: [{ id: "d1", name: "Warehouse", status: "Active" }],
      purposes: [{ id: "u1", name: "Delivery", status: "Inactive" }],
    });
  });

  it("returns empty groups for no rows", () => {
    expect(toBookingOptions([])).toEqual({ projects: [], destinations: [], purposes: [] });
  });
});

describe("toBookingOption", () => {
  it("maps a single row", () => {
    expect(toBookingOption({ id: "p1", name: "Project 1", status: "Active" })).toEqual({ id: "p1", name: "Project 1", status: "Active" });
  });
});

describe("toPerson", () => {
  it("maps project_ids to projectIds and account_id to accountId", () => {
    expect(toPerson({ id: "1", name: "Person One", project_ids: ["p1", "p2"], status: "Active", account_id: "acc1" })).toEqual({
      id: "1",
      name: "Person One",
      projectIds: ["p1", "p2"],
      status: "Active",
      accountId: "acc1",
    });
  });

  it("maps a null account_id to undefined", () => {
    const person = toPerson({ id: "1", name: "Person One", project_ids: [], status: "Active", account_id: null });
    expect(person.accountId).toBeUndefined();
  });
});

describe("toTransportRequest", () => {
  const row = {
    id: "r1",
    owner_account_id: "a1",
    owner_name: "Juan",
    requested_date: "2026-10-05",
    request_type: "REGULAR" as const,
    project_id: null,
    project_name: "Barangay 5 hall",
    project_is_other: true,
    status: "ACTIVE" as const,
    row_version: 2,
    created_at: "2026-09-24T01:00:00Z",
    updated_at: "2026-09-24T02:00:00Z",
    request_destinations: [
      { id: "rd2", position: 2, destination_id: "d2", destination_name: "Port Office", purpose_id: "p2", purpose_name: "Delivery" },
      { id: "rd1", position: 1, destination_id: "d1", destination_name: "City Hall", purpose_id: "p1", purpose_name: "Inspection" },
    ],
  };

  it("maps columns and orders destinations by position", () => {
    const request = toTransportRequest(row, { progress: "SCHEDULING", cancellation_pending: false });
    expect(request).toMatchObject({
      id: "r1",
      ownerAccountId: "a1",
      date: "2026-10-05",
      projectId: undefined,
      projectName: "Barangay 5 hall",
      projectIsOther: true,
      rowVersion: 2,
      progress: "SCHEDULING",
    });
    expect(request.destinations.map((destination) => destination.destinationName)).toEqual(["City Hall", "Port Office"]);
  });

  it("defaults progress when no progress row is given", () => {
    expect(toTransportRequest(row).progress).toBe("NOT_YET_SCHEDULED");
    expect(toTransportRequest({ ...row, status: "CANCELLED" }).progress).toBe("CANCELLED");
    expect(toTransportRequest({ ...row, request_destinations: undefined }).destinations).toEqual([]);
  });
});

describe("toSchedule", () => {
  const leg = {
    origin: "ANONANG",
    contact_name: "",
    contact_number: "",
  };
  const row = {
    id: "s1",
    schedule_date: "2026-10-05",
    created_by_account_id: "sched",
    status: "ACTIVE" as const,
    published_revision_id: null,
    created_at: "2026-09-24T01:00:00Z",
    updated_at: "2026-09-24T02:00:00Z",
    schedule_revisions: [
      {
        id: "rev1",
        version: 1,
        status: "DRAFT" as const,
        plate: "V1",
        driver_id: "drv",
        driver_name: "Dan Driver",
        row_version: 3,
        created_at: "2026-09-24T01:00:00Z",
        updated_at: "2026-09-24T02:00:00Z",
        submitted_at: null,
        decided_at: null,
        decision_comment: "",
        revision_requests: [{ request_id: "r1" }, { request_id: "r2" }],
        schedule_legs: [
          { ...leg, id: "l2", leg_no: 2, origin: "City Hall", destination_id: null, destination_name: "ANONANG",
            planned_time_out: "09:30:00", planned_time_in: "10:30:00", is_final: true, leg_stops: [] },
          { ...leg, id: "l1", leg_no: 1, destination_id: "d1", destination_name: "City Hall",
            planned_time_out: "08:15:00", planned_time_in: "09:00:00", is_final: false,
            leg_stops: [{ request_destination_id: "rd1" }, { request_destination_id: "rd2" }] },
        ],
      },
    ],
  };

  it("maps columns, orders legs and trims times to HH:MM", () => {
    const schedule = toSchedule(row);
    expect(schedule).toMatchObject({ id: "s1", date: "2026-10-05", status: "ACTIVE", publishedRevisionId: undefined });
    const [revision] = schedule.revisions;
    expect(revision).toMatchObject({ version: 1, status: "DRAFT", plate: "V1", driverName: "Dan Driver", rowVersion: 3 });
    expect(revision.requestIds).toEqual(["r1", "r2"]);
    expect(revision.legs.map((item) => [item.origin, item.destinationName, item.plannedTimeOut, item.plannedTimeIn])).toEqual([
      ["ANONANG", "City Hall", "08:15", "09:00"],
      ["City Hall", "ANONANG", "09:30", "10:30"],
    ]);
    expect(revision.legs[0].stops).toEqual(["rd1", "rd2"]);
    expect(revision.legs[1]).toMatchObject({ isFinal: true, destinationId: undefined });
  });

  it("tolerates a schedule with no embedded revisions", () => {
    expect(toSchedule({ ...row, schedule_revisions: undefined }).revisions).toEqual([]);
  });
});

describe("toTripCompletion and toProblemReport", () => {
  it("maps a completion row", () => {
    expect(
      toTripCompletion({
        id: "c1",
        schedule_id: "s1",
        revision_id: "v1",
        driver_id: "d1",
        start_odometer: 1000,
        end_odometer: 1042,
        distance: 42,
        submitted_at: "2026-10-05T10:00:00Z",
        status: "SUBMITTED",
      }),
    ).toEqual({
      id: "c1",
      scheduleId: "s1",
      revisionId: "v1",
      driverId: "d1",
      startOdometer: 1000,
      endOdometer: 1042,
      distance: 42,
      submittedAt: "2026-10-05T10:00:00Z",
      status: "SUBMITTED",
    });
  });

  it("maps a problem report row", () => {
    expect(
      toProblemReport({
        id: "p1",
        schedule_id: "s1",
        revision_id: "v1",
        driver_id: "d1",
        note: "Road closed",
        created_at: "2026-10-05T08:30:00Z",
        status: "OPEN",
      }),
    ).toEqual({
      id: "p1",
      scheduleId: "s1",
      revisionId: "v1",
      driverId: "d1",
      note: "Road closed",
      createdAt: "2026-10-05T08:30:00Z",
      status: "OPEN",
    });
  });
});
