import { describe, expect, it } from "vitest";
import { toBookingOption, toBookingOptions, toProblemReport, toSchedule, toTransportRequest, toTripAttendance, toTripCompletion } from "@/lib/supabase/mappers";

describe("toBookingOptions", () => {
  it("groups rows by their group column", () => {
    const options = toBookingOptions([
      { group: "projects", id: "p1", name: "Project 1", status: "Active", is_other_stop: false },
      { group: "destinations", id: "d1", name: "Warehouse", status: "Active", is_other_stop: false },
      { group: "purposes", id: "u1", name: "Delivery", status: "Inactive", is_other_stop: false },
      { group: "projects", id: "p2", name: "Project 2", status: "Inactive", is_other_stop: false },
    ]);
    expect(options).toEqual({
      projects: [
        { id: "p1", name: "Project 1", status: "Active", isOtherStop: false },
        { id: "p2", name: "Project 2", status: "Inactive", isOtherStop: false },
      ],
      destinations: [{ id: "d1", name: "Warehouse", status: "Active", isOtherStop: false }],
      purposes: [{ id: "u1", name: "Delivery", status: "Inactive", isOtherStop: false }],
    });
  });

  it("returns empty groups for no rows", () => {
    expect(toBookingOptions([])).toEqual({ projects: [], destinations: [], purposes: [] });
  });
});

describe("toBookingOption", () => {
  it("maps a single row", () => {
    expect(toBookingOption({ id: "p1", name: "Project 1", status: "Active", is_other_stop: false })).toEqual({ id: "p1", name: "Project 1", status: "Active", isOtherStop: false });
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
    sent_back_at: null,
    sent_back_reason: "",
    request_destinations: [
      {
        id: "rd2",
        position: 2,
        destination_id: "d2",
        destination_name: "Port Office",
        destination_is_other: false,
        purpose_id: "p2",
        purpose_name: "Delivery",
        purpose_is_other: false,
      },
      {
        id: "rd1",
        position: 1,
        destination_id: "d1",
        destination_name: "City Hall",
        destination_is_other: false,
        purpose_id: "p1",
        purpose_name: "Inspection",
        purpose_is_other: false,
      },
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

  it("maps a send-back, and defaults its progress to SENT_BACK", () => {
    const sent = toTransportRequest({ ...row, sent_back_at: "2026-10-01T03:00:00Z", sent_back_reason: "All vehicles full" });
    expect(sent.sentBack).toEqual({ at: "2026-10-01T03:00:00Z", reason: "All vehicles full" });
    expect(sent.progress).toBe("SENT_BACK");
    expect(toTransportRequest(row).sentBack).toBeUndefined();
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

  it("maps a draft leg with no times yet to empty times", () => {
    const draft = {
      ...row,
      schedule_revisions: [
        {
          ...row.schedule_revisions[0],
          schedule_legs: [{ ...row.schedule_revisions[0].schedule_legs[0], planned_time_out: null, planned_time_in: null }],
        },
      ],
    };
    expect(toSchedule(draft).revisions[0].legs[0]).toMatchObject({ plannedTimeOut: "", plannedTimeIn: "" });
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
      fullTank: null,
      fleetCardUsed: null,
      gasReceiptAttached: null,
    });
  });

  it("maps the return-confirmation fields of a completion", () => {
    const completion = toTripCompletion({
      id: "c1",
      schedule_id: "s1",
      revision_id: "v1",
      driver_id: "d1",
      start_odometer: 1000,
      end_odometer: 1042,
      distance: 42,
      submitted_at: "2026-10-05T10:00:00Z",
      status: "SUBMITTED",
      full_tank: true,
      fleet_card_used: true,
      gas_receipt_attached: false,
    });
    expect(completion.fullTank).toBe(true);
    expect(completion.fleetCardUsed).toBe(true);
    expect(completion.gasReceiptAttached).toBe(false);
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
      handlingNote: "",
    });
  });

  it("maps the Done fields of a completion", () => {
    const done = toTripCompletion({
      id: "c1",
      schedule_id: "s1",
      revision_id: "v1",
      driver_id: "d1",
      start_odometer: 1000,
      end_odometer: 1042,
      distance: 42,
      submitted_at: "2026-10-05T10:00:00Z",
      status: "DONE",
      done_at: "2026-10-06T09:00:00Z",
      done_by_account_id: "a1",
    });
    expect(done.doneAt).toBe("2026-10-06T09:00:00Z");
    expect(done.doneByAccountId).toBe("a1");
  });

  it("maps the handling fields of a problem report", () => {
    const handled = toProblemReport({
      id: "p1",
      schedule_id: "s1",
      revision_id: "v1",
      driver_id: "d1",
      note: "Flat tyre",
      created_at: "2026-10-05T08:30:00Z",
      status: "HANDLED",
      handled_at: "2026-10-06T09:00:00Z",
      handled_by_account_id: "a1",
      handling_note: "Tyre replaced",
      follow_up_schedule_id: "s2",
    });
    expect(handled).toMatchObject({
      handledAt: "2026-10-06T09:00:00Z",
      handledByAccountId: "a1",
      handlingNote: "Tyre replaced",
      followUpScheduleId: "s2",
    });
  });
});

describe("toTripAttendance", () => {
  const row = {
    id: "a1",
    schedule_id: "s1",
    revision_id: "v1",
    driver_id: "d1",
    start_at: "2026-10-07T00:05:00Z",
    start_lat: 16.103769,
    start_lng: 120.436222,
    start_accuracy_m: 12,
    start_distance_m: 0,
    start_address: "Mabato, Anonang, Pangasinan",
    start_recorded_by_account_id: "d1",
    end_at: null,
    end_lat: null,
    end_lng: null,
    end_accuracy_m: null,
    end_distance_m: null,
    end_recorded_by_account_id: null,
  };

  it("maps a started trip, with no End yet", () => {
    expect(toTripAttendance(row)).toEqual({
      id: "a1",
      scheduleId: "s1",
      revisionId: "v1",
      driverId: "d1",
      start: {
        at: "2026-10-07T00:05:00Z",
        recordedByAccountId: "d1",
        location: { lat: 16.103769, lng: 120.436222, accuracyM: 12, distanceM: 0, address: "Mabato, Anonang, Pangasinan" },
      },
      end: undefined,
    });
  });

  it("maps an End tap the phone gave no position for", () => {
    const attendance = toTripAttendance({ ...row, end_at: "2026-10-07T09:00:00Z", end_recorded_by_account_id: "admin" });
    expect(attendance.end).toEqual({ at: "2026-10-07T09:00:00Z", recordedByAccountId: "admin", location: null });
  });
});
