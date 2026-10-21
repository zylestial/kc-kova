/**
 * KOVA backend adapter.
 *
 * The browser never stores authoritative application data or passwords.
 * Authentication is expected to use a secure HttpOnly session cookie issued by
 * the backend. All permissions and conflict checks must also be enforced there.
 */
import { friendlyErrorMessage, NETWORK_ERROR } from "@/lib/error-messages";
import { ALL_TIME } from "@/lib/bootstrap-window";
import { loadSavedTaps, storeSavedTaps, withSavedTaps, type SavedTap } from "@/lib/saved-taps";

export type Role ="Requester" | "Scheduler" | "Admin" | "Driver" | "Finance";
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
  /** Off for a vehicle with no odometer: its trips record no readings (0078). */
  hasOdometer: boolean;
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
  /** Set when it was missed on the road and taken off the trip (0065); it may then move to any day. */
  missedAt?: string;
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
  /** The readings and distance are null for a vehicle without an odometer (0078). */
  startOdometer: number | null;
  endOdometer: number | null;
  distance: number | null;
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
export type AttendanceTap = {
  at: string;
  recordedByAccountId: string;
  location: AttendanceLocation | null;
  /** Tapped with no signal and still on the phone, waiting to send (0077). */
  saved?: boolean;
};
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
export type AttendanceInput = {
  kind: "START" | "END";
  location: { lat: number; lng: number; accuracyM: number | null } | null;
  /** When it was tapped, for a tap saved on the phone without signal (0077). */
  tappedAt?: string;
};
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
  /** Tapped with no signal and still on the phone, waiting to send (0077). */
  saved?: boolean;
};
/** A requester's record of their Company trip: Start and End trip, each with the odometer (0055). */
export type CompanyTripRun = {
  id: string;
  scheduleId: string;
  revisionId: string;
  startAt: string;
  /** Null for a vehicle without an odometer (0078), and so is the end. */
  startOdometer: number | null;
  endAt?: string;
  endOdometer?: number | null;
  /** Start or End trip was tapped with no signal and is still on the phone (0077). */
  saved?: boolean;
};
/** What Start trip / End trip on a Company trip sends. */
/** odometer is null for a vehicle without one (0078). */
export type CompanyRunInput = { kind: "START" | "END"; odometer: number | null; location: AttendanceInput["location"]; tappedAt?: string };
/** What an Arrived/Leaving tap sends. */
export type StopTapInput = { legId: string; kind: StopTap["kind"]; location: AttendanceInput["location"]; tappedAt?: string };
/** A problem at one stop (0061); `skip` skips a blocked road instead of waiting. */
/** requestIds: some of the requests at the stop, for Not available or Wrong address (0067); left out for all of them. */
export type StopReportInput = {
  legId: string;
  kind: StopReportKind;
  note: string;
  location: AttendanceInput["location"];
  requestIds?: string[];
};
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
  /** A stop report (0061): the stop, what happened, and whether the stop was missed. */
  legId?: string;
  kind: StopReportKind;
  missed: boolean;
  /** Missed for just these requests at the stop (0067); the stop itself was reached. */
  requestIds?: string[];
  /** The Scheduler's or Admin's answer (0068); none yet while the trip is held for it. */
  decision?: StopDecision;
  decidedAt?: string;
  reportedByAccountId?: string;
};
/** What can happen at a stop (0061); OTHER is also every whole-trip problem report. */
/** A Scheduler's answer to a stop report (0068): skip it, wait there, end the trip, change the route. */
export type StopDecision = "SKIP" | "WAIT" | "END" | "CHANGE";
/** NOT_REACHED is never chosen: End trip files it for the stops left (0066). */
export type StopReportKind = "NOT_AVAILABLE" | "WRONG_ADDRESS" | "ROAD_BLOCKED" | "VEHICLE_PROBLEM" | "OTHER" | "NOT_REACHED";
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
  | "TRIP_PUBLISHED"
  | "TRIP_CHANGED"
  | "STOP_REPORTED"
  | "STOP_MISSED"
  | "STOP_ANSWERED";
/** An Admin's open invite (0072): sent, not yet accepted or cancelled. */
export type Invite = {
  id: string;
  email: string;
  role: Role;
  driverType?: DriverType;
  canRequestDaily: boolean;
  canRequestCompany: boolean;
  sentAt: string;
  /** Its link no longer works; Resend makes a new one. */
  expired: boolean;
};

/** What a batch of invites did, email by email. */
export type InviteResult = {
  sent: string[];
  skipped: Array<{ email: string; reason: string }>;
  invalid: string[];
  failed: string[];
};

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
  /** Draft changes to a trip on the road: the leg of the Driver's route this one came from (0060). */
  sourceLegId?: string;
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
  /** The Scheduler (or Admin) who drafted this version. */
  createdByAccountId?: string;
  /** Who submitted it for approval. */
  submittedByAccountId?: string;
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
  /** Paused for a Vehicle problem until Resume trip (0061). */
  pausedAt?: string;
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
    /** A leg already saved keeps its id (0060); a new leg has none. */
    id?: string;
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
    throw Object.assign(Error(NETWORK_ERROR), { status: 0 });
  }
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => ({}))) as { message?: unknown };
  if (!response.ok) {
    const message = typeof body?.message === "string" ? body.message : "";
    throw Object.assign(Error(friendlyErrorMessage(response.status, message)), { status: response.status });
  }
  return body as T;
}

/** The HTTP status a request failed with; 0 when it never reached KOVA. */
const failedStatus = (caught: unknown) => (caught as { status?: number }).status;

// The cache with this phone's saved taps laid over it (lib/saved-taps.ts),
// rebuilt whenever either changes; what useKovaData reads.
let view: BootstrapData = emptyData;
let savedTaps: SavedTap[] | null = null;
const getSavedTaps = () => (savedTaps ??= typeof window === "undefined" ? [] : loadSavedTaps());

function notify() {
  view = withSavedTaps(cache, getSavedTaps(), sessionAccount?.id);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("kova-data-update"));
}

/** For useKovaData (lib/use-kova-data.ts): the current data, and a way to hear when it changes. */
export const getKovaData = () => view;
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
  if (sessionAccount) {
    await hydrateKovaData();
    void sendSavedTaps();
  }
  return sessionAccount;
}

export async function signIn(username: string, password: string) {
  const result = await request<{ account: Account }>("/api/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  sessionAccount = result.account;
  await hydrateKovaData();
  void sendSavedTaps();
  return sessionAccount;
}

export async function signOut() {
  await request<void>("/api/auth/sign-out", { method: "POST" });
  sessionAccount = null;
  requestedSince = null;
  cache = emptyData;
  notify();
}

/**
 * What an invite link is for (/join): its email, role, what it allows in a
 * few words, and whether Join asks for a Position. An error when the link
 * no longer works.
 */
export const lookUpInvite = (token: string) =>
  request<{ email: string; role: Role; access: string; position: "required" | "optional" | "none" }>(
    `/api/auth/invite?token=${encodeURIComponent(token)}`,
  );

/** Sets up the invited account and signs in as it (null when the sign-in itself failed). */
export async function acceptInvite(input: { token: string; name: string; username: string; position: string; password: string }) {
  const result = await request<{ account: Account | null }>("/api/auth/accept-invite", { method: "POST", body: JSON.stringify(input) });
  sessionAccount = result.account;
  if (sessionAccount) await hydrateKovaData();
  return sessionAccount;
}

/** Emails a reset link if that username or email has one; the answer is the same either way. */
export const forgotPassword = (login: string) =>
  request<{ message: string }>("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ login }) });
/** Who a reset link is for, or an error when it no longer works. */
export const lookUpReset = (token: string) => request<{ username: string }>(`/api/auth/reset-password?token=${encodeURIComponent(token)}`);
export const resetPassword = (token: string, password: string) =>
  request<void>("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });

/** The signed-in account's email (0072): confirmed, and a new one waiting for its link. */
export type EmailStatus = { email: string | null; pendingEmail: string | null };
export const getMyEmail = () => request<EmailStatus>("/api/me/email");
/** Sends a confirm link to `email`; replacing a confirmed email needs the current password. */
export const setMyEmail = (email: string, currentPassword = "") =>
  request<EmailStatus>("/api/me/email", { method: "POST", body: JSON.stringify({ email, currentPassword }) });
/** My account: a new username, with the current password. */
export async function changeMyUsername(username: string, currentPassword: string) {
  const account = await request<Account>("/api/me/username", { method: "PUT", body: JSON.stringify({ username, currentPassword }) });
  sessionAccount = account;
  return account;
}
/** My account: a new password, with the current one. */
export const changeMyPassword = (currentPassword: string, newPassword: string) =>
  request<void>("/api/me/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
export const confirmEmailLink = (token: string) =>
  request<{ email: string }>("/api/auth/confirm-email", { method: "POST", body: JSON.stringify({ token }) });

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

/** This device gets phone notifications for the signed-in account (0069). */
export async function savePushSubscription(subscription: PushSubscriptionJSON) {
  await request<void>("/api/push/subscription", { method: "POST", body: JSON.stringify(subscription) });
}

/** This device stops getting them. */
export async function removePushSubscription(endpoint: string) {
  await request<void>("/api/push/subscription", { method: "DELETE", body: JSON.stringify({ endpoint }) });
}

/** On signing out: this device stops getting them until the next sign-in (0071). */
export async function pausePushSubscription(endpoint: string) {
  await request<void>("/api/push/pause", { method: "POST", body: JSON.stringify({ endpoint }) });
}

/** A test notification to each of the signed-in account's devices; how many it reached. */
/** A test push to this device only (its endpoint), never the account's other devices. */
export async function sendTestPush(endpoint: string) {
  return request<{ sent: number; removed: number }>("/api/push/test", { method: "POST", body: JSON.stringify({ endpoint }) });
}

async function refreshAfter<T>(operation: Promise<T>) {
  const result = await operation;
  await hydrateKovaData();
  return result;
}

/** Saves an Admin's changes to an account; new accounts come from invites (0072). */
export const saveAccount = (account: Account & { email?: string }) => refreshAfter(request<Account>(`/api/accounts/${encodeURIComponent(account.id)}`, { method: "PUT", body: JSON.stringify(account) }));
export const changeAccountPassword = (accountId: string, password: string) => request<void>(`/api/accounts/${encodeURIComponent(accountId)}/password`, { method: "POST", body: JSON.stringify({ password }) });
/** Every account's email (Admin only, 0072). */
export const listAccountEmails = () => request<Array<{ accountId: string } & EmailStatus>>("/api/account-emails");
/** Sends an account's waiting email its confirm link again. */
export const resendEmailLink = (accountId: string) =>
  request<void>(`/api/accounts/${encodeURIComponent(accountId)}/email-link`, { method: "POST" });
export const listInvites = () => request<Invite[]>("/api/invites");
export const sendInvites = (input: { emails: string; role: Role; driverType?: DriverType; canRequestDaily: boolean; canRequestCompany: boolean }) =>
  request<InviteResult>("/api/invites", { method: "POST", body: JSON.stringify(input) });
export const resendInvite = (id: string) => request<Invite>(`/api/invites/${encodeURIComponent(id)}/resend`, { method: "POST" });
export const cancelInvite = (id: string) => request<void>(`/api/invites/${encodeURIComponent(id)}`, { method: "DELETE" });
export const saveVehicle =(vehicle: Vehicle, originalPlate?: string) => refreshAfter(request<Vehicle>(originalPlate ? `/api/vehicles/${encodeURIComponent(originalPlate)}` : "/api/vehicles", { method: originalPlate ? "PUT" : "POST", body: JSON.stringify(vehicle) }));
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
/** Readings are null for a vehicle without an odometer (0078). */
export const submitCompletion = (id: string, startOdometer: number | null, endOdometer: number | null, checks?: ReturnChecks) => refreshAfter(request<TripCompletion>(`/api/schedules/${encodeURIComponent(id)}/completion`, { method: "POST", body: JSON.stringify({ startOdometer, endOdometer, ...checks }) }));
/**
 * Records a trip tap, or keeps it on the phone when there's no signal
 * (lib/saved-taps.ts, 0077): "saved" means it shows as done and sends
 * later with `tappedAt`, the moment the Driver tapped. A trip with taps
 * still waiting saves this one behind them, so they reach KOVA in order.
 */
async function recordTap(
  path: SavedTap["path"],
  scheduleId: string,
  input: AttendanceInput | StopTapInput | CompanyRunInput,
  tappedAt: string,
): Promise<"sent" | "saved"> {
  const accountId = sessionAccount?.id ?? "";
  if (!getSavedTaps().some((tap) => tap.accountId === accountId && tap.scheduleId === scheduleId)) {
    try {
      await refreshAfter(request(`/api/schedules/${encodeURIComponent(scheduleId)}/${path}`, { method: "POST", body: JSON.stringify(input) }));
      return "sent";
    } catch (caught) {
      if (failedStatus(caught) !== 0) throw caught;
    }
  }
  const tap = { id: crypto.randomUUID(), accountId, scheduleId, path, body: { ...input, tappedAt } } as SavedTap;
  storeTaps([...getSavedTaps(), tap]);
  void sendSavedTaps();
  return "saved";
}

/** Each takes the moment of the tap, before the phone's position was read; "saved" when kept for later. */
export const recordAttendance = (id: string, input: AttendanceInput, tappedAt = new Date().toISOString()) =>
  recordTap("attendance", id, input, tappedAt);
export const recordCompanyRun = (id: string, input: CompanyRunInput, tappedAt = new Date().toISOString()) =>
  recordTap("company-run", id, input, tappedAt);
export const recordCompanyStop = (id: string, input: StopTapInput, tappedAt = new Date().toISOString()) =>
  recordTap("company-stops", id, input, tappedAt);
export const recordStopTap = (id: string, input: StopTapInput, tappedAt = new Date().toISOString()) =>
  recordTap("stop-taps", id, input, tappedAt);

function storeTaps(list: SavedTap[]) {
  savedTaps = list;
  storeSavedTaps(list);
  notify();
}

/** Saved taps KOVA refused (say, the trip was cancelled meanwhile), as lines for the trip screens; cleared once read. */
let refusedTaps: string[] = [];
export const getRefusedTaps = () => refusedTaps;
export function clearRefusedTaps() {
  refusedTaps = [];
  notify();
}

/** How many of the signed-in account's taps are waiting on this phone. */
export const savedTapCount = () => getSavedTaps().filter((tap) => tap.accountId === sessionAccount?.id).length;

const TAP_NAMES = { START: "Start trip", END: "End trip", ARRIVE: "Arrived", LEAVE: "Leaving" } as const;
const tapLine = (tap: SavedTap, why: string) =>
  `${TAP_NAMES[tap.body.kind]} at ${new Date(tap.body.tappedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" })}: ${why}`;

/** Worth trying again later: no signal, signed out, or KOVA busy. Anything else is KOVA saying no. */
const tryLater = (status: number | undefined) => !status || status === 401 || status === 408 || status === 429 || status >= 500;

let sending: Promise<void> | null = null;

/**
 * Sends the signed-in account's saved taps, oldest first, stopping at the
 * first that can't get through (it and the rest wait for the next try). A
 * tap KOVA refuses is dropped and listed in getRefusedTaps; one it already
 * has (sent before, the answer lost) is simply accepted again.
 */
export function sendSavedTaps(): Promise<void> {
  // Cleared in a .finally on the promise, never inside it: with nothing to
  // send the body finishes at once, before `sending` is even assigned.
  sending ??= sendEachSavedTap().finally(() => {
    sending = null;
  });
  return sending;
}

async function sendEachSavedTap() {
  let sent = false;
  for (const tap of getSavedTaps().filter((item) => item.accountId === sessionAccount?.id)) {
    try {
      await request(`/api/schedules/${encodeURIComponent(tap.scheduleId)}/${tap.path}`, { method: "POST", body: JSON.stringify(tap.body) });
    } catch (caught) {
      if (tryLater(failedStatus(caught))) break;
      refusedTaps = [...refusedTaps, tapLine(tap, (caught as Error).message)];
    }
    storeTaps(getSavedTaps().filter((item) => item.id !== tap.id));
    sent = true;
  }
  if (sent) await hydrateKovaData().catch(() => undefined);
}

// Try again whenever the phone says it's back online, and every 30 seconds
// while any wait (the online event alone isn't reliable on phones).
if (typeof window !== "undefined") {
  window.addEventListener("online", () => void sendSavedTaps());
  setInterval(() => {
    if (savedTapCount() && sessionAccount) void sendSavedTaps();
  }, 30_000);
}
export const setTripTime = (id: string, input: TripTimeInput) => refreshAfter(request<TripTimeCorrection | null>(`/api/schedules/${encodeURIComponent(id)}/times`, { method: "PUT", body: JSON.stringify(input) }));
export const reportStop = (id: string, input: StopReportInput) =>
  refreshAfter(request<ProblemReport>(`/api/schedules/${encodeURIComponent(id)}/stop-reports`, { method: "POST", body: JSON.stringify(input) }));
export const reportProblem = (id: string, note: string) => refreshAfter(request<ProblemReport>(`/api/schedules/${encodeURIComponent(id)}/problems`, { method: "POST", body: JSON.stringify({ note }) }));
export const correctCompletion = (id: string, startOdometer: number, endOdometer: number) => refreshAfter(request<TripCompletion>(`/api/schedules/${encodeURIComponent(id)}/completion`, { method: "PATCH", body: JSON.stringify({ startOdometer, endOdometer }) }));
export const markCompletionDone = (id: string) => refreshAfter(request<TripCompletion>(`/api/schedules/${encodeURIComponent(id)}/completion/done`, { method: "POST" }));
export const handleProblem = (id: string, handlingNote: string, followUpScheduleId?: string) => refreshAfter(request<ProblemReport>(`/api/problems/${encodeURIComponent(id)}/handle`, { method: "POST", body: JSON.stringify({ handlingNote, followUpScheduleId }) }));
/** Takes a missed stop's requests off its trip (0063): to plan again, or sent back with `reason`. */
export const answerStopReport = (id: string, decision: StopDecision) =>
  refreshAfter(request<ProblemReport>(`/api/problems/${encodeURIComponent(id)}/answer`, { method: "POST", body: JSON.stringify({ decision }) }));
export const releaseMissedStop = (id: string, sendBack: boolean, reason = "") =>
  refreshAfter(request<{ requestIds: string[] }>(`/api/problems/${encodeURIComponent(id)}/missed`, { method: "POST", body: JSON.stringify({ sendBack, reason }) }));

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
