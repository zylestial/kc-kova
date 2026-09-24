import type {
  Booking,
  BookingOption,
  BookingOptions,
  Person,
  RequestProgress,
  TransportRequest,
  Vehicle,
  VehicleRecord,
} from "@/lib/kova-api";

type VehicleRow = { plate: string; name: string; status: "Active" | "Inactive"; assigned_driver_id: string | null };

export function toVehicle(row: VehicleRow): Vehicle {
  return {
    plate: row.plate,
    name: row.name,
    status: row.status,
    assignedDriverId: row.assigned_driver_id ?? undefined,
  };
}

type BookingRow = {
  id: string;
  date: string;
  plate: string;
  start_hour: number;
  end_hour: number;
  driver_id: string;
  driver_name: string;
  project: string;
  requested_by_account_id: string;
  requested_by_name: string;
  destination: string;
  purpose: string;
  notes: string;
  created_by_account_id: string;
  created_at: string;
  status: "PENDING" | "SCHEDULED" | "REJECTED" | "CANCELLED";
  booking_type: "REGULAR" | "URGENT";
  urgent_reason: string;
};

export function toBooking(row: BookingRow): Booking {
  return {
    id: row.id,
    date: row.date,
    plate: row.plate,
    start: row.start_hour,
    end: row.end_hour,
    driver: row.driver_name,
    driverId: row.driver_id,
    project: row.project,
    requestedById: row.requested_by_account_id,
    requestedByAccountId: row.requested_by_account_id,
    requestedBy: row.requested_by_name,
    destination: row.destination,
    purpose: row.purpose,
    notes: row.notes,
    // create_booking/update_booking always set created_by_account_id to the
    // requester, so the requester's name is also the creator's display name.
    createdBy: row.requested_by_name,
    createdByAccountId: row.created_by_account_id,
    createdAt: row.created_at,
    status: row.status,
    bookingType: row.booking_type,
    urgentReason: row.urgent_reason,
  };
}

type VehicleRecordRow = {
  id: string;
  date: string;
  plate: string;
  data: Record<string, unknown>;
};

export function toVehicleRecord(row: VehicleRecordRow): VehicleRecord {
  return {
    ...row.data,
    id: row.id,
    date: row.date,
    plate: row.plate,
  } as VehicleRecord;
}

type BookingOptionRow = { group: "projects" | "destinations" | "purposes"; id: string; name: string; status: "Active" | "Inactive" };

export function toBookingOptions(rows: BookingOptionRow[]): BookingOptions {
  const options: BookingOptions = { projects: [], destinations: [], purposes: [] };
  for (const row of rows) {
    options[row.group].push({ id: row.id, name: row.name, status: row.status });
  }
  return options;
}

export function toBookingOption(row: { id: string; name: string; status: "Active" | "Inactive" }): BookingOption {
  return { id: row.id, name: row.name, status: row.status };
}

type PersonRow = { id: string; name: string; project_ids: string[]; status: "Active" | "Inactive"; account_id: string | null };

export function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    name: row.name,
    projectIds: row.project_ids,
    status: row.status,
    accountId: row.account_id ?? undefined,
  };
}

type RequestDestinationRow = {
  id: string;
  position: number;
  destination_id: string;
  destination_name: string;
  purpose_id: string;
  purpose_name: string;
};

type RequestRow = {
  id: string;
  owner_account_id: string;
  owner_name: string;
  requested_date: string;
  request_type: "REGULAR" | "URGENT";
  project_id: string | null;
  project_name: string;
  project_is_other: boolean;
  status: "ACTIVE" | "CANCELLED";
  row_version: number;
  created_at: string;
  updated_at: string;
  // Embedded by the bootstrap select; absent on a bare RPC result.
  request_destinations?: RequestDestinationRow[];
};

type RequestProgressRow = { progress: RequestProgress | null; cancellation_pending: boolean | null };

export function toTransportRequest(row: RequestRow, progressRow?: RequestProgressRow): TransportRequest {
  return {
    id: row.id,
    ownerAccountId: row.owner_account_id,
    ownerName: row.owner_name,
    date: row.requested_date,
    requestType: row.request_type,
    projectId: row.project_id ?? undefined,
    projectName: row.project_name,
    projectIsOther: row.project_is_other,
    status: row.status,
    rowVersion: row.row_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    destinations: [...(row.request_destinations ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((destination) => ({
        id: destination.id,
        position: destination.position,
        destinationId: destination.destination_id,
        destinationName: destination.destination_name,
        purposeId: destination.purpose_id,
        purposeName: destination.purpose_name,
      })),
    progress: progressRow?.progress ?? (row.status === "CANCELLED" ? "CANCELLED" : "NOT_YET_SCHEDULED"),
    cancellationPending: progressRow?.cancellation_pending ?? false,
  };
}
