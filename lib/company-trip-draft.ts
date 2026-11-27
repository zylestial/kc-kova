import type {
  CompanyTripBooking,
  CompanyTripInput,
  CompanyTripPassenger,
  CompanyTripStatus,
  RequestGroup,
  TransportRequest,
} from "@/lib/kova-api";

/**
 * The Company trip form's state, its checks and what it sends (Company
 * trip v2, prototype "KOVA Company Trip Flow v2"). The request is the
 * trip: the requester picks the vehicle and Driver and enters the times,
 * and sending it goes straight to the Admin (0094 request_company_trip).
 * The checks mirror that function so the form can say what's missing; the
 * database decides for real.
 */

export const PURPOSE_MAX = 300;
export const COMPANY_STOPS_MAX = 8;
export const PASSENGERS_MAX = 15;

export type CompanyStopDraft = {
  key: string;
  destinationId: string;
  /** For every destination but the last: when you get there and leave. The last one's arrival is Time In. */
  arriveAt: string;
  leaveAt: string;
};

export type CompanyTripDraft = {
  date: string;
  priority: "REGULAR" | "URGENT";
  urgentReasonId: string;
  /** A company trip vehicle, or the requester's own. */
  vehicleKind: "company" | "personal";
  vehiclePlate: string;
  driverId: string;
  /** Leaving the Main Office. */
  timeOut: string;
  /** Arriving at the last destination: the trip ends there. */
  timeIn: string;
  stops: CompanyStopDraft[];
  purpose: string;
  departmentId: string;
  fleetCard: string;
  passengers: CompanyTripPassenger[];
};

export const emptyCompanyStop = (): CompanyStopDraft => ({ key: crypto.randomUUID(), destinationId: "", arriveAt: "", leaveAt: "" });

export function emptyCompanyTripDraft(date: string, me: { id: string; canDrive: boolean }): CompanyTripDraft {
  return {
    date,
    priority: "REGULAR",
    urgentReasonId: "",
    vehicleKind: "company",
    vehiclePlate: "",
    driverId: me.canDrive ? me.id : "",
    timeOut: "",
    timeIn: "",
    stops: [emptyCompanyStop()],
    purpose: "",
    departmentId: "",
    fleetCard: "",
    passengers: [],
  };
}

/** A saved request's form: its group, its active stops (A first) and where its trip is (0096). */
export function companyDraftFromGroup(
  group: RequestGroup,
  stops: TransportRequest[],
  status: CompanyTripStatus | undefined,
  personalPlate: string | undefined,
): CompanyTripDraft {
  const active = stops.filter((stop) => stop.status === "ACTIVE");
  const legs = status?.legs ?? [];
  return {
    date: group.date,
    priority: group.priority,
    urgentReasonId: group.urgentReason?.id ?? "",
    vehicleKind: personalPlate && group.vehiclePlate === personalPlate ? "personal" : "company",
    vehiclePlate: group.vehiclePlate ?? "",
    driverId: group.driver?.id ?? "",
    timeOut: legs[0]?.out ?? "",
    timeIn: legs.at(-1)?.in ?? "",
    stops: active.map((stop, index) => ({
      key: stop.id,
      destinationId: stop.destinations[0]?.destinationId ?? "",
      arriveAt: index < active.length - 1 ? (legs[index]?.in ?? "") : "",
      leaveAt: index < active.length - 1 ? (legs[index + 1]?.out ?? "") : "",
    })),
    purpose: group.purpose,
    departmentId: group.department?.id ?? "",
    fleetCard: group.fleetCard,
    passengers: status?.passengers ?? [],
  };
}

export function companyDraftToInput(draft: CompanyTripDraft, personalPlate?: string): CompanyTripInput {
  const last = draft.stops.length - 1;
  return {
    date: draft.date,
    departmentId: draft.departmentId,
    vehiclePlate: draft.vehicleKind === "personal" ? (personalPlate ?? "") : draft.vehiclePlate,
    driverId: draft.vehicleKind === "personal" ? "" : draft.driverId,
    purpose: draft.purpose.trim(),
    fleetCard: draft.fleetCard.trim(),
    priority: draft.priority,
    urgentReasonId: draft.priority === "URGENT" ? draft.urgentReasonId : "",
    timeOut: draft.timeOut,
    stops: draft.stops.map((stop, index) => ({
      destinationId: stop.destinationId,
      arriveAt: index === last ? draft.timeIn : stop.arriveAt,
      leaveAt: index === last ? "" : stop.leaveAt,
    })),
    passengers: draft.passengers,
  };
}

const minutes = (time: string) => {
  const [hours, mins] = time.split(":").map(Number);
  return hours * 60 + mins;
};

/** The trip's times in order: Time Out, then arrive / leave at each destination but the last, then Time In. */
function timeline(draft: CompanyTripDraft): Array<{ label: string; time: string }> {
  const last = draft.stops.length - 1;
  return [
    { label: "Time Out", time: draft.timeOut },
    ...draft.stops.slice(0, last).flatMap((stop, index) => [
      { label: `the time you arrive at destination ${index + 1}`, time: stop.arriveAt },
      { label: `the time you leave destination ${index + 1}`, time: stop.leaveAt },
    ]),
    { label: "Time In", time: draft.timeIn },
  ];
}

export type CompanyTripErrors = Partial<
  Record<
    "date" | "urgentReason" | "vehicle" | "driver" | "timeOut" | "timeIn" | "purpose" | "department" | "fleetCard" | "times",
    string
  >
> & {
  /** Per destination, by index. */
  stops?: Record<number, { destination?: string; arriveAt?: string; leaveAt?: string }>;
};

/** What the form still needs, as the message under each field. */
export function companyTripErrors(draft: CompanyTripDraft, personalPlate?: string): CompanyTripErrors {
  const errors: CompanyTripErrors = {};
  if (!draft.date) errors.date = "Select the date.";
  if (draft.priority === "URGENT" && !draft.urgentReasonId) errors.urgentReason = "Select a reason, or set the request to Regular.";
  if (draft.vehicleKind === "company" && !draft.vehiclePlate) errors.vehicle = "Select a vehicle.";
  if (draft.vehicleKind === "personal" && !personalPlate) errors.vehicle = "No personal vehicle is registered to your account. Select a company vehicle.";
  if (draft.vehicleKind === "company" && !draft.driverId) errors.driver = "Select the driver.";
  if (!draft.timeOut) errors.timeOut = "Enter the Time Out.";
  if (!draft.timeIn) errors.timeIn = "Enter the Time In.";
  const last = draft.stops.length - 1;
  draft.stops.forEach((stop, index) => {
    const own: { destination?: string; arriveAt?: string; leaveAt?: string } = {};
    if (!stop.destinationId) own.destination = "Select a destination.";
    if (index < last && !stop.arriveAt) own.arriveAt = "Enter the arrival time.";
    if (index < last && !stop.leaveAt) own.leaveAt = "Enter the departure time.";
    if (Object.keys(own).length) errors.stops = { ...errors.stops, [index]: own };
  });
  // Each time must come after the one before it.
  const times = timeline(draft);
  for (let index = 1; index < times.length; index++) {
    const [before, after] = [times[index - 1], times[index]];
    if (before.time && after.time && minutes(after.time) <= minutes(before.time)) {
      errors.times = `${after.label[0].toUpperCase() + after.label.slice(1)} must be after ${before.label}.`;
      break;
    }
  }
  if (!draft.purpose.trim()) errors.purpose = "Enter the purpose of the trip.";
  if (!draft.departmentId) errors.department = "Select the department or project site.";
  if (!/^\d{4}$/.test(draft.fleetCard.trim())) errors.fleetCard = "Enter the last 4 digits of the Fleet Card.";
  return errors;
}

const ERROR_NAMES: Record<Exclude<keyof CompanyTripErrors, "stops">, string> = {
  date: "Date",
  urgentReason: "Reason it's urgent",
  vehicle: "Vehicle",
  driver: "Driver",
  timeOut: "Time Out",
  timeIn: "Time In",
  times: "Times in order",
  purpose: "Purpose",
  department: "Department / Project Site",
  fleetCard: "Fleet Card No.",
};

/** Everything still missing, e.g. ["Vehicle", "Destination 2"]. */
export function companyTripMissing(errors: CompanyTripErrors): string[] {
  const missing = (Object.keys(ERROR_NAMES) as Array<keyof typeof ERROR_NAMES>).filter((key) => errors[key]).map((key) => ERROR_NAMES[key]);
  for (const index of Object.keys(errors.stops ?? {})) missing.push(`Destination ${Number(index) + 1}`);
  return missing;
}

/** Bookings that overlap Time Out to Time In. */
export function overlapping(bookings: CompanyTripBooking[], timeOut: string, timeIn: string) {
  if (!timeOut || !timeIn || minutes(timeIn) <= minutes(timeOut)) return [];
  return bookings.filter((item) => minutes(item.startsAt) < minutes(timeIn) && minutes(timeOut) < minutes(item.endsAt));
}

/** The vehicle's bookings that overlap the trip. */
export function vehicleClashes(bookings: CompanyTripBooking[], plate: string, timeOut: string, timeIn: string) {
  return overlapping(bookings, timeOut, timeIn).filter((item) => item.plate === plate);
}

/** The booking a person is already on at the trip's time, if any. */
export function personBusy(bookings: CompanyTripBooking[], accountId: string, timeOut: string, timeIn: string) {
  return overlapping(bookings, timeOut, timeIn).find((item) => item.accountIds.includes(accountId));
}

/** "8:05 AM" for "08:05". */
export function clock(time: string) {
  if (!time) return "—";
  const [hours, mins] = time.split(":").map(Number);
  return `${hours % 12 || 12}:${String(mins).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

/** Whether a new form holds anything the requester entered. */
export function companyDraftHasContent(draft: CompanyTripDraft) {
  return !!(
    draft.vehiclePlate ||
    draft.timeOut ||
    draft.timeIn ||
    draft.purpose.trim() ||
    draft.departmentId ||
    draft.fleetCard.trim() ||
    draft.passengers.length ||
    draft.stops.some((stop) => stop.destinationId || stop.arriveAt || stop.leaveAt)
  );
}
