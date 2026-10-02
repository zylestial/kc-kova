/**
 * KOVA backend adapter.
 *
 * The browser never stores authoritative application data or passwords.
 * Authentication is expected to use a secure HttpOnly session cookie issued by
 * the backend. All permissions and conflict checks must also be enforced there.
 */
import { friendlyErrorMessage, NETWORK_ERROR } from "@/lib/error-messages";

export type Role ="Requester" | "Scheduler" | "Admin" | "Driver";
export type Account = {
  id: string;
  name: string;
  username: string;
  role: Role;
  status: "Active" | "Inactive";
  project?: string;
};
export type Vehicle = {
  plate: string;
  name: string;
  status: "Active" | "Inactive";
  assignedDriverId?: string | null;
};
export type BookingOption = {
  id: string;
  name: string;
  status: "Active" | "Inactive";
  /** Destinations only: a non-request stop (e.g. fuel, an errand) the Planner may add on its own. */
  isOtherStop?: boolean;
};
export type Person = {
  id: string;
  name: string;
  projectIds: string[];
  status: "Active" | "Inactive";
  accountId?: string;
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
/** A v2 transport request: a date and destinations, no vehicle or time. */
export type TransportRequest = {
  id: string;
  ownerAccountId: string;
  ownerName: string;
  date: string;
  requestType: "REGULAR" | "URGENT";
  projectId?: string;
  projectName: string;
  projectIsOther: boolean;
  status: "ACTIVE" | "CANCELLED";
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  destinations: RequestDestination[];
  progress: RequestProgress;
  /** Set when a Scheduler sent it back unplaced; cleared once its date changes. */
  sentBack?: { at: string; reason: string };
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
/** What the New request form and the Edit modal send. */
export type RequestInput = {
  date: string;
  requestType: "REGULAR" | "URGENT";
  projectId: string;
  projectOther: string;
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
export type BookingOptions = {
  projects: BookingOption[];
  destinations: BookingOption[];
  purposes: BookingOption[];
};
export type BootstrapData = {
  accounts: Account[];
  vehicles: Vehicle[];
  options: BookingOptions;
  people: Person[];
  requests: TransportRequest[];
  schedules: Schedule[];
  cancellations: CancellationRequest[];
  completions: TripCompletion[];
  problems: ProblemReport[];
  notifications: Notification[];
};

const apiBase = (process.env.NEXT_PUBLIC_KOVA_API_BASE_URL || "").replace(/\/$/, "");
let sessionAccount: Account | null = null;
let cache: BootstrapData = {
  accounts: [],
  vehicles: [],
  options: { projects: [], destinations: [], purposes: [] },
  people: [],
  requests: [],
  schedules: [],
  cancellations: [],
  completions: [],
  problems: [],
  notifications: [],
};

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

export async function hydrateKovaData() {
  cache = await request<BootstrapData>("/api/bootstrap");
  notify();
  return cache;
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
  cache = { accounts: [], vehicles: [], options: { projects: [], destinations: [], purposes: [] }, people: [], requests: [], schedules: [], cancellations: [], completions: [], problems: [], notifications: [] };
  notify();
}

export const currentAccount = () => sessionAccount;
export const getAccounts = () => cache.accounts;
export const getVehicles = () => cache.vehicles;
export const getBookingOptions = () => cache.options;
export const getPeople = () => cache.people;
export const getRequests = () => cache.requests;
export const getMyRequests = (accountId: string) => cache.requests.filter((item) => item.ownerAccountId === accountId);
export const getSchedules = () => cache.schedules;
export const getCancellations = () => cache.cancellations;
export const getPendingCancellations = () => cache.cancellations.filter((item) => item.status === "PENDING");
export const getCompletions = () => cache.completions;
export const getProblems = () => cache.problems;
export const getNotifications = () => cache.notifications;
export const getUnreadNotificationCount = () => cache.notifications.filter((item) => !item.readAt).length;

// Lighter than hydrateKovaData(): used after marking a notification read and
// after the live stream (lib/notifications-stream.ts) signals a new one, so
// neither has to refetch every other table just to update the bell.
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
export const saveBookingOption = (group: "projects" | "destinations" | "purposes", option: BookingOption) => refreshAfter(request<BookingOption>(`/api/booking-options/${group}/${encodeURIComponent(option.id)}`, { method: "PUT", body: JSON.stringify(option) }));
export const savePerson = (person: Person) => refreshAfter(request<Person>(`/api/booking-options/people/${encodeURIComponent(person.id)}`, { method: "PUT", body: JSON.stringify(person) }));
export const createRequest = (input: RequestInput) => refreshAfter(request<TransportRequest>("/api/requests", { method: "POST", body: JSON.stringify(input) }));
export const updateRequest = (id: string, rowVersion: number, input: RequestInput) => refreshAfter(request<TransportRequest>(`/api/requests/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ ...input, rowVersion }) }));
export const cancelRequest = (id: string) => refreshAfter(request<TransportRequest>(`/api/requests/${encodeURIComponent(id)}/cancel`, { method: "POST" }));
export const requestCancellation = (id: string, reason: string) => refreshAfter(request<CancellationRequest>(`/api/requests/${encodeURIComponent(id)}/cancellation`, { method: "POST", body: JSON.stringify({ reason }) }));
export const confirmCancellation = (id: string) => refreshAfter(request<CancellationRequest>(`/api/cancellations/${encodeURIComponent(id)}/confirm`, { method: "POST" }));
export const declineCancellation = (id: string, note: string) => refreshAfter(request<CancellationRequest>(`/api/cancellations/${encodeURIComponent(id)}/decline`, { method: "POST", body: JSON.stringify({ note }) }));
export const cancelSchedule = (id: string, reason: string) => refreshAfter(request<Schedule>(`/api/schedules/${encodeURIComponent(id)}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }));
export const createSchedule = (input: ScheduleInput) => refreshAfter(request<Schedule>("/api/schedules", { method: "POST", body: JSON.stringify(input) }));
export const saveScheduleDraft = (id: string, rowVersion: number | null, input: ScheduleInput) => refreshAfter(request<Schedule>(`/api/schedules/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ ...input, rowVersion }) }));
export const submitSchedule = (id: string, rowVersion: number) => refreshAfter(request<Schedule>(`/api/schedules/${encodeURIComponent(id)}/submit`, { method: "POST", body: JSON.stringify({ rowVersion }) }));
export const approveSchedule = (id: string, rowVersion: number) => refreshAfter(request<Schedule>(`/api/schedules/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify({ rowVersion }) }));
export const returnSchedule = (id: string, rowVersion: number, comment: string) => refreshAfter(request<Schedule>(`/api/schedules/${encodeURIComponent(id)}/return`, { method: "POST", body: JSON.stringify({ rowVersion, comment }) }));
export const discardScheduleDraft =(id: string, rowVersion: number) => refreshAfter(request<Schedule>(`/api/schedules/${encodeURIComponent(id)}/discard`, { method: "POST", body: JSON.stringify({ rowVersion }) }));
export const submitCompletion = (id: string, startOdometer: number, endOdometer: number, checks?: ReturnChecks) => refreshAfter(request<TripCompletion>(`/api/schedules/${encodeURIComponent(id)}/completion`, { method: "POST", body: JSON.stringify({ startOdometer, endOdometer, ...checks }) }));
export const reportProblem = (id: string, note: string) => refreshAfter(request<ProblemReport>(`/api/schedules/${encodeURIComponent(id)}/problems`, { method: "POST", body: JSON.stringify({ note }) }));
export const correctCompletion = (id: string, startOdometer: number, endOdometer: number) => refreshAfter(request<TripCompletion>(`/api/schedules/${encodeURIComponent(id)}/completion`, { method: "PATCH", body: JSON.stringify({ startOdometer, endOdometer }) }));
export const markCompletionDone = (id: string) => refreshAfter(request<TripCompletion>(`/api/schedules/${encodeURIComponent(id)}/completion/done`, { method: "POST" }));
export const handleProblem = (id: string, handlingNote: string, followUpScheduleId?: string) => refreshAfter(request<ProblemReport>(`/api/problems/${encodeURIComponent(id)}/handle`, { method: "POST", body: JSON.stringify({ handlingNote, followUpScheduleId }) }));
