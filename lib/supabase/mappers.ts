import type {
  BookingOption,
  BookingOptions,
  RequestProgress,
  Schedule,
  TransportRequest,
  CancellationRequest,
  CompanyTripRun,
  Notification,
  NotificationType,
  ProblemReport,
  StopTap,
  TripTimeCorrection,
  TripAttendance,
  TripCompletion,
  OptionGroup,
  RequestForm,
  RequestGroup,
  StopFlexibility,
  Vehicle,
} from "@/lib/kova-api";
import { emptyOptions } from "@/lib/kova-api";

type VehicleRow = {
  plate: string;
  name: string;
  status: "Active" | "Inactive";
  assigned_driver_id: string | null;
  company_trips: boolean;
  has_odometer: boolean;
};

export function toVehicle(row: VehicleRow): Vehicle {
  return {
    plate: row.plate,
    name: row.name,
    status: row.status,
    assignedDriverId: row.assigned_driver_id ?? undefined,
    companyTrips: row.company_trips,
    hasOdometer: row.has_odometer,
  };
}

type BookingOptionRow = {
  group: OptionGroup;
  id: string;
  name: string;
  status: "Active" | "Inactive";
  is_other_stop: boolean;
};

/** A destination's saved position (destination_locations, 0044). */
export type DestinationLocationRow = { destination_id: string; lat: number; lng: number };

export function toBookingOptions(rows: BookingOptionRow[], locations: DestinationLocationRow[] = []): BookingOptions {
  const options = emptyOptions();
  const locationOf = new Map(locations.map((row) => [row.destination_id, row]));
  for (const row of rows) {
    options[row.group].push(toBookingOption(row, row.group === "destinations" ? locationOf.get(row.id) : undefined));
  }
  return options;
}

/** One option; a destination's position is added when it has one. */
export function toBookingOption(row: Omit<BookingOptionRow, "group">, location?: DestinationLocationRow | null): BookingOption {
  const option: BookingOption = { id: row.id, name: row.name, status: row.status, isOtherStop: row.is_other_stop };
  if (location) option.location = { lat: location.lat, lng: location.lng };
  return option;
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
  vehicle_plate: string | null;
  status: "ACTIVE" | "CANCELLED";
  row_version: number;
  created_at: string;
  updated_at: string;
  sent_back_at: string | null;
  sent_back_reason: string;
  /** 0053: a Scheduler moved this "any day that week" stop to another day. */
  moved_at?: string | null;
  /** 0065: missed on the road and taken off the trip. */
  missed_at?: string | null;
  // 0052; older rows have no group and the defaults.
  group_id?: string | null;
  stop_letter?: string;
  urgent_reason_id?: string | null;
  urgent_reason_name?: string;
  details?: string;
  flexibility?: StopFlexibility;
  fixed_time?: string | null;
  contact?: string;
  supplier_id?: string | null;
  supplier_name?: string;
  // Embedded by the bootstrap select; absent on a bare RPC result.
  request_destinations?: RequestDestinationRow[];
  request_groups?: RequestGroupRow | null;
};

export type RequestGroupRow = {
  id: string;
  number: number;
  owner_account_id: string;
  owner_name: string;
  form_type: RequestForm;
  requested_date: string;
  starting_point_id: string | null;
  starting_point_name: string;
  department_id: string | null;
  department_name: string;
  vehicle_plate: string | null;
  driver_id: string | null;
  driver_name: string;
  supervisor_id: string | null;
  supervisor_name: string;
  head_id: string | null;
  head_name: string;
  site_officer: string;
  site_company: string;
  row_version: number;
  created_at: string;
};

/** An id + name snapshot pair, or undefined when there's no id. */
const choice = (id: string | null | undefined, name: string | undefined) => (id ? { id, name: name ?? "" } : undefined);

export function toRequestGroup(row: RequestGroupRow): RequestGroup {
  return {
    id: row.id,
    number: row.number,
    ownerAccountId: row.owner_account_id,
    ownerName: row.owner_name,
    form: row.form_type,
    date: row.requested_date,
    startingPoint: choice(row.starting_point_id, row.starting_point_name),
    department: choice(row.department_id, row.department_name),
    vehiclePlate: row.vehicle_plate ?? undefined,
    driver: choice(row.driver_id, row.driver_name),
    supervisor: choice(row.supervisor_id, row.supervisor_name),
    head: choice(row.head_id, row.head_name),
    siteOfficer: row.site_officer,
    siteCompany: row.site_company,
    rowVersion: row.row_version,
    createdAt: row.created_at,
  };
}

/** The select every request read uses, so a stop comes with its group (toTransportRequest). */
export const REQUEST_SELECT = "*, request_destinations(*), request_groups(*)";

type RequestProgressRow = { progress: RequestProgress | null; cancellation_pending: boolean | null };

export function toTransportRequest(row: RequestRow, progressRow?: RequestProgressRow): TransportRequest {
  return {
    group: row.request_groups ? toRequestGroup(row.request_groups) : undefined,
    stopLetter: row.stop_letter ?? "",
    urgentReason: row.urgent_reason_name ? { id: row.urgent_reason_id ?? undefined, name: row.urgent_reason_name } : undefined,
    details: row.details ?? "",
    flexibility: row.flexibility ?? "DAY",
    // Postgres returns "08:30:00".
    fixedTime: row.fixed_time ? row.fixed_time.slice(0, 5) : undefined,
    contact: row.contact ?? "",
    supplier: choice(row.supplier_id, row.supplier_name),
    id: row.id,
    ownerAccountId: row.owner_account_id,
    ownerName: row.owner_name,
    date: row.requested_date,
    requestType: row.request_type,
    projectId: row.project_id ?? undefined,
    projectName: row.project_name,
    projectIsOther: row.project_is_other,
    vehiclePlate: row.vehicle_plate ?? undefined,
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
    movedAt: row.moved_at ?? undefined,
    missedAt: row.missed_at ?? undefined,
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
  start_odometer: number | null;
  end_odometer: number | null;
  distance: number | null;
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
  start_sent_at?: string | null;
  end_sent_at?: string | null;
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
      sentAt: row.start_sent_at ?? undefined,
    },
    end:
      row.end_at && row.end_recorded_by_account_id
        ? {
            at: row.end_at,
            recordedByAccountId: row.end_recorded_by_account_id,
            location: toAttendanceLocation(row.end_lat, row.end_lng, row.end_accuracy_m, row.end_distance_m, row.end_address),
            sentAt: row.end_sent_at ?? undefined,
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
  sent_at?: string | null;
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
    sentAt: row.sent_at ?? undefined,
  };
}

type CompanyTripRunRow = {
  id: string;
  schedule_id: string;
  revision_id: string;
  start_at: string;
  start_odometer: number | null;
  start_lat?: number | null;
  start_lng?: number | null;
  start_accuracy_m?: number | null;
  start_address?: string | null;
  started_by_account_id?: string;
  end_at: string | null;
  end_odometer: number | null;
  end_lat?: number | null;
  end_lng?: number | null;
  end_accuracy_m?: number | null;
  end_address?: string | null;
  ended_by_account_id?: string | null;
  start_sent_at?: string | null;
  end_sent_at?: string | null;
};

// A Company trip starts at its own starting point, so its taps aren't
// measured from ANONANG: distanceM is 0 and Attendance never flags them as away.
function companyTap(
  at: string,
  by: string,
  lat?: number | null,
  lng?: number | null,
  accuracyM?: number | null,
  address?: string | null,
  sentAt?: string | null,
) {
  return {
    at,
    recordedByAccountId: by,
    location: lat == null || lng == null ? null : { lat, lng, accuracyM: accuracyM ?? null, distanceM: 0, address: address ?? null },
    sentAt: sentAt ?? undefined,
  };
}

export function toCompanyTripRun(row: CompanyTripRunRow): CompanyTripRun {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    revisionId: row.revision_id,
    startAt: row.start_at,
    startOdometer: row.start_odometer,
    endAt: row.end_at ?? undefined,
    endOdometer: row.end_odometer ?? undefined,
    startTap: companyTap(row.start_at, row.started_by_account_id ?? "", row.start_lat, row.start_lng, row.start_accuracy_m, row.start_address, row.start_sent_at),
    endTap:
      row.end_at && row.ended_by_account_id
        ? companyTap(row.end_at, row.ended_by_account_id, row.end_lat, row.end_lng, row.end_accuracy_m, row.end_address, row.end_sent_at)
        : undefined,
  };
}

type TripTimeCorrectionRow = {
  id: string;
  schedule_id: string;
  revision_id: string;
  leg_id: string;
  field: "OUT" | "IN";
  /** Postgres time(0), "HH:MM:SS". */
  time: string;
  corrected_by_account_id: string;
  corrected_at: string;
};

export function toTripTimeCorrection(row: TripTimeCorrectionRow): TripTimeCorrection {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    revisionId: row.revision_id,
    legId: row.leg_id,
    field: row.field,
    time: row.time.slice(0, 5),
    correctedByAccountId: row.corrected_by_account_id,
    correctedAt: row.corrected_at,
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
  /** 0061; missing on rows from before it. */
  leg_id?: string | null;
  kind?: ProblemReport["kind"];
  missed?: boolean;
  request_ids?: string[] | null;
  decision?: ProblemReport["decision"] | null;
  decided_at?: string | null;
  reported_by_account_id?: string | null;
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
    legId: row.leg_id ?? undefined,
    kind: row.kind ?? "OTHER",
    missed: row.missed ?? false,
    requestIds: row.request_ids ?? undefined,
    decision: row.decision ?? undefined,
    decidedAt: row.decided_at ?? undefined,
    reportedByAccountId: row.reported_by_account_id ?? undefined,
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
  /** The leg of the Driver's route a draft leg came from (0060). */
  source_leg_id?: string | null;
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
  created_by_account_id?: string;
  submitted_by_account_id?: string | null;
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
  /** 0054; missing on rows from before it. */
  kind?: Schedule["kind"];
  /** 0061: paused for a Vehicle problem. */
  paused_at?: string | null;
  schedule_revisions?: ScheduleRevisionRow[];
};

// Postgres time(0) comes back as "08:15:00"; the app works in "08:15".
const hhmm = (value: string | null) => value?.slice(0, 5) ?? "";

export function toSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    date: row.schedule_date,
    kind: row.kind ?? "DAILY",
    createdByAccountId: row.created_by_account_id,
    status: row.status,
    publishedRevisionId: row.published_revision_id ?? undefined,
    pausedAt: row.paused_at ?? undefined,
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
        createdByAccountId: revision.created_by_account_id,
        submittedByAccountId: revision.submitted_by_account_id ?? undefined,
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
            sourceLegId: leg.source_leg_id ?? undefined,
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
