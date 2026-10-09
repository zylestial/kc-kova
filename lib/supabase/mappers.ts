import type {
  BookingOption,
  BookingOptions,
  RequestProgress,
  Schedule,
  TransportRequest,
  CancellationRequest,
  Notification,
  NotificationType,
  ProblemReport,
  StopTap,
  TripAttendance,
  TripCompletion,
  Vehicle,
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

type BookingOptionRow = {
  group: "projects" | "destinations" | "purposes";
  id: string;
  name: string;
  status: "Active" | "Inactive";
  is_other_stop: boolean;
  lat?: number | null;
  lng?: number | null;
};

/** A destination's saved position (0044); absent when it has none. */
function optionLocation(row: { lat?: number | null; lng?: number | null }): BookingOption["location"] {
  return row.lat == null || row.lng == null ? undefined : { lat: row.lat, lng: row.lng };
}

export function toBookingOptions(rows: BookingOptionRow[]): BookingOptions {
  const options: BookingOptions = { projects: [], destinations: [], purposes: [] };
  for (const row of rows) {
    options[row.group].push({ id: row.id, name: row.name, status: row.status, isOtherStop: row.is_other_stop, location: optionLocation(row) });
  }
  return options;
}

export function toBookingOption(row: Omit<BookingOptionRow, "group">): BookingOption {
  return { id: row.id, name: row.name, status: row.status, isOtherStop: row.is_other_stop, location: optionLocation(row) };
}

type RequestDestinationRow = {
  id: string;
  position: number;
  destination_id: string | null;
  destination_name: string;
  destination_is_other: boolean;
  purpose_id: string | null;
  purpose_name: string;
  purpose_is_other: boolean;
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
  sent_back_at: string | null;
  sent_back_reason: string;
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
        destinationId: destination.destination_id ?? undefined,
        destinationName: destination.destination_name,
        destinationIsOther: destination.destination_is_other,
        purposeId: destination.purpose_id ?? undefined,
        purposeName: destination.purpose_name,
        purposeIsOther: destination.purpose_is_other,
      })),
    progress: progressRow?.progress ?? (row.status === "CANCELLED" ? "CANCELLED" : row.sent_back_at ? "SENT_BACK" : "NOT_YET_SCHEDULED"),
    cancellationPending: progressRow?.cancellation_pending ?? false,
    sentBack: row.sent_back_at ? { at: row.sent_back_at, reason: row.sent_back_reason } : undefined,
  };
}

type CancellationRow = {
  id: string;
  request_id: string;
  requested_by_account_id: string;
  requested_at: string;
  reason: string;
  status: CancellationRequest["status"];
  decided_at: string | null;
  decision_note: string;
};

export function toCancellationRequest(row: CancellationRow): CancellationRequest {
  return {
    id: row.id,
    requestId: row.request_id,
    requestedByAccountId: row.requested_by_account_id,
    requestedAt: row.requested_at,
    reason: row.reason,
    status: row.status,
    decidedAt: row.decided_at ?? undefined,
    decisionNote: row.decision_note,
  };
}

type CompletionRow = {
  id: string;
  schedule_id: string;
  revision_id: string;
  driver_id: string;
  start_odometer: number;
  end_odometer: number;
  distance: number;
  submitted_at: string;
  status: TripCompletion["status"];
  done_at?: string | null;
  done_by_account_id?: string | null;
  full_tank?: boolean | null;
  fleet_card_used?: boolean | null;
  gas_receipt_attached?: boolean | null;
};

export function toTripCompletion(row: CompletionRow): TripCompletion {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    revisionId: row.revision_id,
    driverId: row.driver_id,
    startOdometer: row.start_odometer,
    endOdometer: row.end_odometer,
    distance: row.distance,
    submittedAt: row.submitted_at,
    status: row.status,
    doneAt: row.done_at ?? undefined,
    doneByAccountId: row.done_by_account_id ?? undefined,
    fullTank: row.full_tank ?? null,
    fleetCardUsed: row.fleet_card_used ?? null,
    gasReceiptAttached: row.gas_receipt_attached ?? null,
  };
}

type AttendanceRow = {
  id: string;
  schedule_id: string;
  revision_id: string;
  driver_id: string;
  start_at: string;
  start_lat: number | null;
  start_lng: number | null;
  start_accuracy_m: number | null;
  start_distance_m: number | null;
  start_address?: string | null;
  start_recorded_by_account_id: string;
  end_at: string | null;
  end_lat: number | null;
  end_lng: number | null;
  end_accuracy_m: number | null;
  end_distance_m: number | null;
  end_address?: string | null;
  end_recorded_by_account_id: string | null;
};

function toAttendanceLocation(
  lat: number | null,
  lng: number | null,
  accuracyM: number | null,
  distanceM: number | null,
  address: string | null | undefined,
) {
  return lat === null || lng === null || distanceM === null ? null : { lat, lng, accuracyM, distanceM, address: address ?? null };
}

export function toTripAttendance(row: AttendanceRow): TripAttendance {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    revisionId: row.revision_id,
    driverId: row.driver_id,
    start: {
      at: row.start_at,
      recordedByAccountId: row.start_recorded_by_account_id,
      location: toAttendanceLocation(row.start_lat, row.start_lng, row.start_accuracy_m, row.start_distance_m, row.start_address),
    },
    end:
      row.end_at && row.end_recorded_by_account_id
        ? {
            at: row.end_at,
            recordedByAccountId: row.end_recorded_by_account_id,
            location: toAttendanceLocation(row.end_lat, row.end_lng, row.end_accuracy_m, row.end_distance_m, row.end_address),
          }
        : undefined,
  };
}

type StopTapRow = {
  id: string;
  schedule_id: string;
  revision_id: string;
  leg_id: string;
  driver_id: string;
  kind: "ARRIVE" | "LEAVE";
  at: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  distance_m: number | null;
  address: string | null;
  recorded_by_account_id: string;
};

export function toStopTap(row: StopTapRow): StopTap {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    revisionId: row.revision_id,
    legId: row.leg_id,
    driverId: row.driver_id,
    kind: row.kind,
    at: row.at,
    recordedByAccountId: row.recorded_by_account_id,
    location:
      row.lat === null || row.lng === null
        ? null
        : { lat: row.lat, lng: row.lng, accuracyM: row.accuracy_m, distanceM: row.distance_m, address: row.address },
  };
}

type ProblemRow = {
  id: string;
  schedule_id: string;
  revision_id: string;
  driver_id: string;
  note: string;
  created_at: string;
  status: ProblemReport["status"];
  handled_at?: string | null;
  handled_by_account_id?: string | null;
  handling_note?: string | null;
  follow_up_schedule_id?: string | null;
};

export function toProblemReport(row: ProblemRow): ProblemReport {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    revisionId: row.revision_id,
    driverId: row.driver_id,
    note: row.note,
    createdAt: row.created_at,
    status: row.status,
    handledAt: row.handled_at ?? undefined,
    handledByAccountId: row.handled_by_account_id ?? undefined,
    handlingNote: row.handling_note ?? "",
    followUpScheduleId: row.follow_up_schedule_id ?? undefined,
  };
}

type NotificationRow = {
  id: string;
  type: NotificationType;
  message: string;
  related_request_id: string | null;
  related_schedule_id: string | null;
  created_at: string;
  read_at: string | null;
};

export function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    relatedRequestId: row.related_request_id ?? undefined,
    relatedScheduleId: row.related_schedule_id ?? undefined,
    createdAt: row.created_at,
    readAt: row.read_at ?? undefined,
  };
}

type ScheduleLegRow = {
  id: string;
  leg_no: number;
  origin: string;
  destination_id: string | null;
  destination_name: string;
  /** Both null on a draft leg whose times aren't set yet (0033). */
  planned_time_out: string | null;
  planned_time_in: string | null;
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
const hhmm = (value: string | null) => value?.slice(0, 5) ?? "";

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

/**
 * Select for toSchedule. Pair with liveRevisionStatuses on schedule_revisions.
 * schedules and schedule_revisions are linked twice (revision.schedule_id and
 * schedule.published_revision_id), so the embed names the foreign key.
 */
export const scheduleSelect =
  "*, schedule_revisions:schedule_revisions!schedule_revisions_schedule_id_fkey(*, revision_requests(request_id), schedule_legs(*, leg_stops(request_destination_id)))";
/** The versions the app works with; superseded and discarded ones are history. */
export const liveRevisionStatuses = ["DRAFT", "SUBMITTED", "RETURNED", "APPROVED"];
