import { describe, expect, it } from "vitest";
import { toBooking, toBookingOption, toBookingOptions, toPerson, toVehicleRecord } from "@/lib/supabase/mappers";

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
