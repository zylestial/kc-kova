/**
 * KOVA backend adapter.
 *
 * The browser never stores authoritative application data or passwords.
 * Authentication is expected to use a secure HttpOnly session cookie issued by
 * the backend. All permissions and conflict checks must also be enforced there.
 */
import { friendlyErrorMessage, NETWORK_ERROR } from "@/lib/error-messages";
import { ALL_TIME } from "@/lib/bootstrap-window";

export type Role ="Requester" | "Scheduler" | "Admin" | "Driver";
export type Account = {
  id: string;
  name: string;
  username: string;
  role: Role;
  status: "Active" | "Inactive";
  /** Prints on the Company Trip Form; required to request company trips (0051). */
  position: string;
  /** Drivers only: a Truck driver can never make requests (0051). */
  driverType?: DriverType;
  /** Drivers only: an Admin allowed this Driver to make Daily requests. */
  canRequestDaily: boolean;
  /** An Admin allowed this account to request company trips. */
  canRequestCompany: boolean;
};
export const DRIVER_TYPES = ["Truck", "Company car"] as const;
export type DriverType = (typeof DRIVER_TYPES)[number];
export type Vehicle = {
  plate: string;
  name: string;
  status: "Active" | "Inactive";
  assignedDriverId?: string | null;
  /** "Can be requested for company trips": offered on the Company Trip form (0051). */
  companyTrips: boolean;
};
export type BookingOption = {
  id: string;
  name: string;
  status: "Active" | "Inactive";
  /** Destinations only: a non-request stop (e.g. fuel, an errand) the Planner may add on its own. */
  isOtherStop?: boolean;
  /** Destinations only: where it is, to check a Driver's Arrived/Leaving taps there (0044). */
  location?: { lat: number; lng: number } | null;
};
export type RequestProgress =
  | "NOT_YET_SCHEDULED"
  | "SENT_BACK"
  | "SCHEDULING"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "COMPLETED"
  | "DONE"
  | "CANCELLED";
export type RequestDestination = {
  id: string;
  position: number;
  destinationId?: string;
  destinationName: string;
  destinationIsOther: boolean;
  purposeId?: string;
  purposeName: string;
  purposeIsOther: boolean;
};
export type RequestForm = "DAILY" | "COMPANY";
/** How flexible a stop is: any time that day, a fixed time, or any day that week (0052). */
export type StopFlexibility = "DAY" | "FIXED" | "WEEK";
/**
 * A request as the requester sent it: its form, date and, for a Company
 * Trip, the trip's fields (0052). Each stop is its own TransportRequest.
 */
export type RequestGroup = {
  id: string;
  number: number;
  ownerAccountId: string;
  ownerName: string;
  form: RequestForm;
  date: string;
  startingPoint?: { id: string; name: string };
  department?: { id: string; name: string };
  vehiclePlate?: string;
  driver?: { id: string; name: string };
  supervisor?: { id: string; name: string };
  head?: { id: string; name: string };
  siteOfficer: string;
  siteCompany: string;
  rowVersion: number;
  createdAt: string;
};
/**
 * A v2 transport request: one stop of a RequestGroup (52-A), or a request
 * made before groups (no group, possibly several destinations).
 */
export type TransportRequest = {
  /** Missing on requests made before groups (0052). */
  group?: RequestGroup;
  /** A, B, ... within its group; "" before groups. */
  stopLetter: string;
  /** Set on an Urgent stop; its name also shows as the destination's purpose. */
  urgentReason?: { id?: string; name: string };
  /** What exactly, e.g. "40 bags cement, PO 2231". */
  details: string;
  flexibility: StopFlexibility;
  /** "HH:MM" for a fixed-time stop. */
  fixedTime?: string;
  contact: string;
  /** Company Trip only. */
  supplier?: { id: string; name: string };
  id: string;
  ownerAccountId: string;
  ownerName: string;
  date: string;
  requestType: "REGULAR" | "URGENT";
  projectId?: string;
  projectName: string;
  projectIsOther: boolean;
  /** The plate the requester chose (0050); missing on requests made before that. */
  vehiclePlate?: string;
  status: "ACTIVE" | "CANCELLED";
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  destinations: RequestDestination[];
  progress: RequestProgress;
  /** Set when a Scheduler sent it back unplaced; cleared once its date changes. */
  sentBack?: { at: string; reason: string };
  /** Set when a Scheduler moved this "any day that week" stop to another day of its week (0053). */
  movedAt?: string;
  cancellationPending: boolean;
};
/** A Requester's ask to cancel a request a schedule holds; an Admin decides. */
export type CancellationRequest = {
  id: string;
  requestId: string;
  requestedByAccountId: string;
  requestedAt: string;
  reason: string;
  status: "PENDING" | "CONFIRMED" | "DECLINED";
  decidedAt?: string;
  decisionNote: string;
};
/** A Driver's submitted odometer pair for a whole schedule (0017, 0029). */
export type TripCompletion = {
  id: string;
  scheduleId: string;
  revisionId: string;
  driverId: string;
  startOdometer: number;
  endOdometer: number;
  distance: number;
  submittedAt: string;
  status: "SUBMITTED" | "DONE";
  doneAt?: string;
  doneByAccountId?: string;
  /** Optional final-return checks (0037); null means not answered. */
  fullTank: boolean | null;
  fleetCardUsed: boolean | null;
  gasReceiptAttached: boolean | null;
};
/** Optional final-return checks a Driver may answer alongside odometers. */
export type ReturnChecks = { fullTank?: boolean | null; fleetCardUsed?: boolean | null; gasReceiptAttached?: boolean | null };
/** Where the phone was at a Start/End tap, how far that is from ANONANG, and roughly what address (0043; null when the lookup found nothing). */
export type AttendanceLocation = { lat: number; lng: number; accuracyM: number | null; distanceM: number; address: string | null };
/** One Start or End tap: server time, who tapped, and the position if the phone shared it. */
export type AttendanceTap = { at: string; recordedByAccountId: string; location: AttendanceLocation | null };
/** A Driver's Start and End taps for a whole schedule, their attendance that day (0042). */
export type TripAttendance = {
  id: string;
  scheduleId: string;
  revisionId: string;
  driverId: string;
  start: AttendanceTap;
  end?: AttendanceTap;
};
/** What a Start/End tap sends: the phone's position, or null when it wouldn't share it. */
export type AttendanceInput = { kind: "START" | "END"; location: { lat: number; lng: number; accuracyM: number | null } | null };
/** Where the phone was at an Arrived/Leaving tap; distanceM is null when the destination has no saved position. */
export type StopTapLocation = Omit<AttendanceLocation, "distanceM"> & { distanceM: number | null };
/**
 * An Arrived or Leaving tap at one leg's destination (0045). Arrived is that
 * leg's TIME IN on the printed form; Leaving is the next leg's TIME OUT.
 */
export type StopTap = {
  id: string;
  scheduleId: string;
  revisionId: string;
  legId: string;
  driverId: string;
  kind: "ARRIVE" | "LEAVE";
  at: string;
  recordedByAccountId: string;
  location: StopTapLocation | null;
};
/** A requester's record of their Company trip: Start and End trip, each with the odometer (0055). */
export type CompanyTripRun = {
  id: string;
  scheduleId: string;
  revisionId: string;
  startAt: string;
  startOdometer: number;
  endAt?: string;
  endOdometer?: number;
};
/** What Start trip / End trip on a Company trip sends. */
export type CompanyRunInput = { kind: "START" | "END"; odometer: number; location: AttendanceInput["location"] };
/** What an Arrived/Leaving tap sends. */
export type StopTapInput = { legId: string; kind: StopTap["kind"]; location: AttendanceInput["location"] };
/** An Admin's TIME OUT or TIME IN for one leg of a submitted trip (0046); it prints in place of the tap. */
export type TripTimeCorrection = {
  id: string;
  scheduleId: string;
  revisionId: string;
  legId: string;
  field: "OUT" | "IN";
  /** Manila wall-clock time, "HH:MM". */
  time: string;
  correctedByAccountId: string;
  correctedAt: string;
};
/** What filling in a time sends; a null time clears the Admin's entry. */
export type TripTimeInput = { legId: string; field: TripTimeCorrection["field"]; time: string | null };
/** A Driver's note that a trip couldn't go as planned (0017, 0029). */
export type ProblemReport = {
  id: string;
  scheduleId: string;
  revisionId: string;
  driverId: string;
  note: string;
  createdAt: string;
  status: "OPEN" | "HANDLED";
  handledAt?: string;
  handledByAccountId?: string;
  handlingNote: string;
  followUpScheduleId?: string;
};
/** An in-app notification of one event for one recipient (0035). */
export type NotificationType =
  | "REQUEST_SCHEDULED"
  | "REQUEST_RETURNED"
  | "REQUEST_SENT_BACK"
  | "REQUEST_SPLIT"
  | "REQUEST_MOVED"
  | "REQUEST_CANCELLED"
  | "CANCELLATION_DECLINED"
  | "CANCELLATION_REQUESTED"
  | "PROBLEM_REPORTED"
  | "SCHEDULE_SUBMITTED"
  | "SCHEDULE_RETURNED"
  | "TRIP_PUBLISHED";
export type Notification = {
  id: string;
  type: NotificationType;
  message: string;
  relatedRequestId?: string;
  relatedScheduleId?: string;
  createdAt: string;
  readAt?: string;
};
/** One stop as the request forms send it (0052); "id" when editing an existing stop. */
export type RequestStopInput = {
  id?: string;
  projectId: string;
  projectOther: string;
  destinationId: string;
  destinationOther: string;
  purposeId: string;
  purposeOther: string;
  urgentReasonId: string;
  details: string;
  flexibility: StopFlexibility;
  fixedTime: string;
  contact: string;
  supplierId: string;
};
/** What the Daily and Company Trip forms send (0052). The Company Trip fields are blank on a Daily request. */
export type RequestGroupInput = {
  date: string;
  stops: RequestStopInput[];
  startingPointId: string;
  departmentId: string;
  vehiclePlate: string;
  driverId: string;
  supervisorId: string;
  headId: string;
  siteOfficer: string;
  siteCompany: string;
};
/** What the New request form and the Edit modal send. The server sets the type from the date. */
export type RequestInput = {
  date: string;
  projectId: string;
  projectOther: string;
  /** Company Trips only (the Company Trip form, later): a vehicle that can be requested for company trips. */
  vehiclePlate?: string;
  destinations: Array<{ destinationId: string; destinationOther: string; purposeId: string; purposeOther: string }>;
};
export type ScheduleRevisionStatus = "DRAFT" | "SUBMITTED" | "RETURNED" | "APPROVED" | "SUPERSEDED" | "DISCARDED";
/** One Trip Record leg. Origins are derived by the server. */
export type ScheduleLeg = {
  id: string;
  legNo: number;
  origin: string;
  destinationId?: string;
  destinationName: string;
  plannedTimeOut: string;
  plannedTimeIn: string;
  contactName: string;
  contactNumber: string;
  isFinal: boolean;
  /** Request destination ids this leg serves; two or more is a shared stop. */
  stops: string[];
};
/** One version of a schedule: its vehicle, Driver, requests and route. */
export type ScheduleRevision = {
  id: string;
  version: number;
  status: ScheduleRevisionStatus;
  plate: string;
  driverId: string;
  driverName: string;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  decidedAt?: string;
  decisionComment: string;
  requestIds: string[];
  legs: ScheduleLeg[];
};
/** A v2 schedule: one vehicle's trip on one date, built by a Scheduler. */
export type Schedule = {
  id: string;
  date: string;
  /** A Daily trip, or a Company trip planned on the Company trip planner (0054). */
  kind: "DAILY" | "COMPANY";
  createdByAccountId: string;
  status: "ACTIVE" | "DISCARDED" | "CANCELLED";
  publishedRevisionId?: string;
  createdAt: string;
  updatedAt: string;
  /** Live versions only: the published one and any open draft. */
  revisions: ScheduleRevision[];
};
/** What Save draft sends. Origins aren't sent; the server derives them. */
export type ScheduleInput = {
  date: string;
  plate: string;
  requestIds: string[];
  legs: Array<{
    destinationId?: string;
    plannedTimeOut: string;
    plannedTimeIn: string;
    contactName: string;
    contactNumber: string;
    stops: string[];
    isFinal: boolean;
  }>;
};
/** Request choices an Admin manages; the last six are for the Company Trip form and per-stop Urgent (0051). */
export const OPTION_GROUPS = [
  "projects",
  "destinations",
  "purposes",
  "departments",
  "suppliers",
  "supervisors",
  "heads",
  "starting_points",
  "urgent_reasons",
] as const;
export type OptionGroup = (typeof OPTION_GROUPS)[number];
export type BookingOptions = Record<OptionGroup, BookingOption[]>;
export const emptyOptions = (): BookingOptions =>
  Object.fromEntries(OPTION_GROUPS.map((group) => [group, []])) as unknown as BookingOptions;
export type BootstrapData = {
  /** Records from this date on are loaded (plus older ones still needing someone); "" before the first load. */
  since: string;
  accounts: Account[];
  vehicles: Vehicle[];
  options: BookingOptions;
  requests: TransportRequest[];
  schedules: Schedule[];
  cancellations: CancellationRequest[];
  completions: TripCompletion[];
  attendance: TripAttendance[];
  stopTaps: StopTap[];
  companyRuns: CompanyTripRun[];
  timeCorrections: TripTimeCorrection[];
  problems: ProblemReport[];
  notifications: Notification[];
};

const apiBase = (process.env.NEXT_PUBLIC_KOVA_API_BASE_URL || "").replace(/\/$/, "");
let sessionAccount: Account | null = null;
const emptyData: BootstrapData = {
  since: "",
  accounts: [],
  vehicles: [],
  options: emptyOptions(),
  requests: [],
  schedules: [],
  cancellations: [],
  completions: [],
  attendance: [],
  stopTaps: [],
  companyRuns: [],
  timeCorrections: [],
  problems: [],
  notifications: [],
};
// Replaced (never mutated) on every load, so a changed reference means new data.
let cache: BootstrapData = emptyData;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...init.headers,
      },
    });
  } catch {
    throw Error(NETWORK_ERROR);
  }
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as { message?: unknown };
  if (!response.ok) {
    const message = typeof body?.message === "string" ? body.message : "";
    throw Error(friendlyErrorMessage(response.status, message));
  }
  return body as T;
}

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("kova-data-update"));
}

/** For useKovaData (lib/use-kova-data.ts): the current cache, and a way to hear when it changes. */
export const getKovaData = () => cache;
export const getEmptyKovaData = () => emptyData;
export function subscribeKovaData(listener: () => void) {
  window.addEventListener("kova-data-update", listener);
  return () => window.removeEventListener("kova-data-update", listener);
}

// Set once someone asks for older records, so every later reload keeps them.
let requestedSince: string | null = null;

export async function hydrateKovaData() {
  cache = await request<BootstrapData>(requestedSince ? `/api/bootstrap?since=${requestedSince}` : "/api/bootstrap");
  notify();
  return cache;
}

/** Loads every request, schedule and trip, not just the recent window. */
export async function loadOlderRecords() {
  requestedSince = ALL_TIME;
  return hydrateKovaData();
}

export async function restoreSession() {
  const result = await request<{ account: Account | null }>("/api/auth/session");
  sessionAccount = result.account;
  if (sessionAccount) await hydrateKovaData();
  return sessionAccount;
}

export async function signIn(username: string, password: string) {
  const result = await request<{ account: Account }>("/api/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  sessionAccount = result.account;
  await hydrateKovaData();
  return sessionAccount;
}

export async function signOut() {
  await request<void>("/api/auth/sign-out", { method: "POST" });
  sessionAccount = null;
  requestedSince = null;
  cache = emptyData;
  notify();
}

export const currentAccount = () => sessionAccount;
export const getSchedules = () => cache.schedules;

// Lighter than hydrateKovaData(): used after marking a notification read and
// by the poller (lib/notifications-poll.ts), so neither has to refetch
// every other table just to update the bell.
export async function refreshNotifications() {
  cache = { ...cache, notifications: await request<Notification[]>("/api/notifications") };
  notify();
  return cache.notifications;
}

export async function markNotificationRead(id: string) {
  await request<void>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
  await refreshNotifications();
}

export async function markAllNotificationsRead() {
  await request<void>("/api/notifications/read-all", { method: "POST" });
  await refreshNotifications();
}

async function refreshAfter<T>(operation: Promise<T>) {
  const result = await operation;
  await hydrateKovaData();
  return result;
}

export const saveAccount = (account: Account & { password?: string }) => refreshAfter(request<Account>(account.id ? `/api/accounts/${encodeURIComponent(account.id)}` : "/api/accounts", { method: account.id ? "PUT" : "POST", body: JSON.stringify(account) }));
export const changeAccountPassword = (accountId: string, password: string) => request<void>(`/api/accounts/${encodeURIComponent(accountId)}/password`, { method: "POST", body: JSON.stringify({ password }) });
export const saveVehicle = (vehicle: Vehicle, originalPlate?: string) => refreshAfter(request<Vehicle>(originalPlate ? `/api/vehicles/${encodeURIComponent(originalPlate)}` : "/api/vehicles", { method: originalPlate ? "PUT" : "POST", body: JSON.stringify(vehicle) }));
export const saveBookingOption = (group: OptionGroup, option: BookingOption) => refreshAfter(request<BookingOption>(`/api/booking-options/${group}/${encodeURIComponent(option.id)}`, { method: "PUT", body: JSON.stringify(option) }));
export const createRequest = (input: RequestInput) => refreshAfter(request<TransportRequest>("/api/requests", { method: "POST", body: JSON.stringify(input) }));
/** Returns the group's stops, A first. */
export const createRequestGroup = (form: RequestForm, input: RequestGroupInput) =>
  refreshAfter(request<TransportRequest[]>("/api/request-groups", { method: "POST", body: JSON.stringify({ ...input, form }) }));
export const updateRequestGroup = (id: string, rowVersion: number, input: RequestGroupInput) =>
  refreshAfter(request<TransportRequest[]>(`/api/request-groups/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ ...input, rowVersion }) }));
export const updateRequest = (id: string, rowVersion: number, input: RequestInput) => refreshAfter(request<TransportRequest>(`/api/requests/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ ...input, rowVersion }) }));
export const cancelRequest = (id: string) => refreshAfter(request<TransportRequest>(`/api/requests/${encodeURIComponent(id)}/cancel`, { method: "POST" }));
export const sendBackRequests = (requestIds: string[], reason: string) => refreshAfter(request<TransportRequest[]>("/api/requests/send-back", { method: "POST", body: JSON.stringify({ requestIds, reason }) }));
export const moveRequestDay = (id: string, date: string) => refreshAfter(request<TransportRequest>(`/api/requests/${encodeURIComponent(id)}/move`, { method: "POST", body: JSON.stringify({ date }) }));
export const requestCancellation =(id: string, reason: string) => refreshAfter(request<CancellationRequest>(`/api/requests/${encodeURIComponent(id)}/cancellation`, { method: "POST", body: JSON.stringify({ reason }) }));
export const confirmCancellation = (id: string) => refreshAfter(request<CancellationRequest>(`/api/cancellations/${encodeURIComponent(id)}/confirm`, { method: "POST" }));
export const declineCancellation = (id: string, note: string) => refreshAfter(request<CancellationRequest>(`/api/cancellations/${encodeURIComponent(id)}/decline`, { method: "POST", body: JSON.stringify({ note }) }));
export const cancelSchedule = (id: string, reason: string) => refreshAfter(request<Schedule>(`/api/schedules/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }));
export const createSchedule = (input: ScheduleInput) => refreshAfter(request<Schedule>("/api/schedules", { method: "POST", body: JSON.stringify(input) }));
/** A new Company trip (0054); edits then go through saveScheduleDraft like any schedule. */
export const createCompanyTrip = (input: ScheduleInput) =>
  refreshAfter(request<Schedule>("/api/schedules", { method: "POST", body: JSON.stringify({ ...input, kind: "COMPANY" }) }));
export const saveScheduleDraft = (id: string, rowVersion: number | null, input: ScheduleInput) => refreshAfter(request<Schedule>(`/api/schedules/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ ...input, rowVersion }) }));
export const submitSchedule = (id: string, rowVersion: number) => refreshAfter(request<Schedule>(`/api/schedules/${encodeURIComponent(id)}/submit`, { method: "POST", body: JSON.stringify({ rowVersion }) }));
export const approveSchedule = (id: string, rowVersion: number) => refreshAfter(request<Schedule>(`/api/schedules/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify({ rowVersion }) }));
export const returnSchedule = (id: string, rowVersion: number, comment: string) => refreshAfter(request<Schedule>(`/api/schedules/${encodeURIComponent(id)}/return`, { method: "POST", body: JSON.stringify({ rowVersion, comment }) }));
export const discardScheduleDraft =(id: string, rowVersion: number) => refreshAfter(request<Schedule>(`/api/schedules/${encodeURIComponent(id)}/discard`, { method: "POST", body: JSON.stringify({ rowVersion }) }));
export const submitCompletion = (id: string, startOdometer: number, endOdometer: number, checks?: ReturnChecks) => refreshAfter(request<TripCompletion>(`/api/schedules/${encodeURIComponent(id)}/completion`, { method: "POST", body: JSON.stringify({ startOdometer, endOdometer, ...checks }) }));
export const recordAttendance = (id: string, input: AttendanceInput) => refreshAfter(request<TripAttendance>(`/api/schedules/${encodeURIComponent(id)}/attendance`, { method: "POST", body: JSON.stringify(input) }));
export const recordCompanyRun = (id: string, input: CompanyRunInput) => refreshAfter(request<CompanyTripRun>(`/api/schedules/${encodeURIComponent(id)}/company-run`, { method: "POST", body: JSON.stringify(input) }));
export const recordCompanyStop = (id: string, input: StopTapInput) => refreshAfter(request<StopTap>(`/api/schedules/${encodeURIComponent(id)}/company-stops`, { method: "POST", body: JSON.stringify(input) }));
export const recordStopTap = (id: string, input: StopTapInput) => refreshAfter(request<StopTap>(`/api/schedules/${encodeURIComponent(id)}/stop-taps`, { method: "POST", body: JSON.stringify(input) }));
export const setTripTime = (id: string, input: TripTimeInput) => refreshAfter(request<TripTimeCorrection | null>(`/api/schedules/${encodeURIComponent(id)}/times`, { method: "PUT", body: JSON.stringify(input) }));
export const reportProblem = (id: string, note: string) => refreshAfter(request<ProblemReport>(`/api/schedules/${encodeURIComponent(id)}/problems`, { method: "POST", body: JSON.stringify({ note }) }));
export const correctCompletion = (id: string, startOdometer: number, endOdometer: number) => refreshAfter(request<TripCompletion>(`/api/schedules/${encodeURIComponent(id)}/completion`, { method: "PATCH", body: JSON.stringify({ startOdometer, endOdometer }) }));
export const markCompletionDone = (id: string) => refreshAfter(request<TripCompletion>(`/api/schedules/${encodeURIComponent(id)}/completion/done`, { method: "POST" }));
export const handleProblem = (id: string, handlingNote: string, followUpScheduleId?: string) => refreshAfter(request<ProblemReport>(`/api/problems/${encodeURIComponent(id)}/handle`, { method: "POST", body: JSON.stringify({ handlingNote, followUpScheduleId }) }));

/**
 * Marks several trips done, one at a time through the same endpoint as a
 * single trip, so each is its own atomic change and a failure on one doesn't
 * stop the rest. Reloads once at the end. Returns the schedule ids it
 * closed and, for the rest, why not.
 */
export async function markCompletionsDone(scheduleIds: string[]) {
  const done: string[] = [];
  const failed: Array<{ scheduleId: string; message: string }> = [];
  for (const id of scheduleIds) {
    try {
      await request<TripCompletion>(`/api/schedules/${encodeURIComponent(id)}/completion/done`, { method: "POST" });
      done.push(id);
    } catch (caught) {
      failed.push({ scheduleId: id, message: caught instanceof Error ? caught.message : "Something went wrong." });
    }
  }
  await hydrateKovaData().catch(() => undefined);
  return { done, failed };
}
