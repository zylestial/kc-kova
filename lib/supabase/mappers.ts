import type {
  Booking,
  BookingOption,
  BookingOptions,
  Person,
  RequestProgress,
  Schedule,
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

type ScheduleLegRow = {
  id: string;
  leg_no: number;
  origin: string;
  destination_id: string | null;
  destination_name: string;
  planned_time_out: string;
  planned_time_in: string;
  contact_name: string;
  contact_number: string;
  is_final: boolean;
  leg_stops?: Array<{ request_destination_id: string }>;
};

type ScheduleRevisionRow = {
  id: string;
  version: number;
  status: Schedule["revisions"][number]["status"];
  plate: string;
  driver_id: string;
  driver_name: string;
  row_version: number;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  decided_at: string | null;
  decision_comment: string;
  revision_requests?: Array<{ request_id: string }>;
  schedule_legs?: ScheduleLegRow[];
};

type ScheduleRow = {
  id: string;
  schedule_date: string;
  created_by_account_id: string;
  status: Schedule["status"];
  published_revision_id: string | null;
  created_at: string;
  updated_at: string;
  schedule_revisions?: ScheduleRevisionRow[];
};

// Postgres time(0) comes back as "08:15:00"; the app works in "08:15".
const hhmm = (value: string) => value.slice(0, 5);

export function toSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    date: row.schedule_date,
    createdByAccountId: row.created_by_account_id,
    status: row.status,
    publishedRevisionId: row.published_revision_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revisions: [...(row.schedule_revisions ?? [])]
      .sort((a, b) => a.version - b.version)
      .map((revision) => ({
        id: revision.id,
        version: revision.version,
        status: revision.status,
        plate: revision.plate,
        driverId: revision.driver_id,
        driverName: revision.driver_name,
        rowVersion: revision.row_version,
        createdAt: revision.created_at,
        updatedAt: revision.updated_at,
        submittedAt: revision.submitted_at ?? undefined,
        decidedAt: revision.decided_at ?? undefined,
        decisionComment: revision.decision_comment,
        requestIds: (revision.revision_requests ?? []).map((item) => item.request_id),
        legs: [...(revision.schedule_legs ?? [])]
          .sort((a, b) => a.leg_no - b.leg_no)
          .map((leg) => ({
            id: leg.id,
            legNo: leg.leg_no,
            origin: leg.origin,
            destinationId: leg.destination_id ?? undefined,
            destinationName: leg.destination_name,
            plannedTimeOut: hhmm(leg.planned_time_out),
            plannedTimeIn: hhmm(leg.planned_time_in),
            contactName: leg.contact_name,
            contactNumber: leg.contact_number,
            isFinal: leg.is_final,
            stops: (leg.leg_stops ?? []).map((stop) => stop.request_destination_id),
          })),
      })),
  };
}

/** Select for toSchedule. Pair with liveRevisionStatuses on schedule_revisions. */
export const scheduleSelect =
  "*, schedule_revisions(*, revision_requests(request_id), schedule_legs(*, leg_stops(request_destination_id)))";
/** The versions the app works with; superseded and discarded ones are history. */
export const liveRevisionStatuses = ["DRAFT", "SUBMITTED", "RETURNED", "APPROVED"];
