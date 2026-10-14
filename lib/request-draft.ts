import type {
  BookingOption,
  BookingOptions,
  RequestForm,
  RequestGroup,
  RequestGroupInput,
  StopFlexibility,
  TransportRequest,
} from "@/lib/kova-api";

/**
 * The New request form's state (the Daily form now, the Company Trip form
 * next), its checks and what it sends. The checks mirror write_request_stop
 * and resolve_group_fields (supabase/migrations/0052_request_groups.sql) so
 * the form can say what's missing; the database decides for real.
 */

export const DETAILS_MAX = 150;
export const STOPS_MAX = 20;

export type StopDraft = {
  /** Keeps React rows stable while stops are added, moved and removed. */
  key: string;
  /** Set on a stop that's already saved (editing). */
  id?: string;
  /** Its letter once saved: A, B, ... */
  letter?: string;
  /** A saved stop that's scheduled or cancelled: shown but not changed. */
  locked: boolean;
  projectId: string;
  projectOther: string;
  projectOtherMode: boolean;
  destinationId: string;
  destinationOther: string;
  destinationOtherMode: boolean;
  purposeId: string;
  purposeOther: string;
  purposeOtherMode: boolean;
  urgent: boolean;
  urgentReasonId: string;
  details: string;
  flexibility: StopFlexibility;
  fixedTime: string;
  contact: string;
  supplierId: string;
};

export type RequestDraft = {
  form: RequestForm;
  date: string;
  /** One project for every stop, or one per stop. */
  projectMode: "one" | "multi";
  /** The single project, in "one" mode. */
  projectId: string;
  projectOther: string;
  projectOtherMode: boolean;
  stops: StopDraft[];
  // Company Trip only.
  startingPointId: string;
  departmentId: string;
  vehiclePlate: string;
  driverId: string;
  supervisorId: string;
  headId: string;
  siteOfficer: string;
  siteCompany: string;
};

export function emptyStop(): StopDraft {
  return {
    key: crypto.randomUUID(),
    locked: false,
    projectId: "",
    projectOther: "",
    projectOtherMode: false,
    destinationId: "",
    destinationOther: "",
    destinationOtherMode: false,
    purposeId: "",
    purposeOther: "",
    purposeOtherMode: false,
    urgent: false,
    urgentReasonId: "",
    details: "",
    flexibility: "DAY",
    fixedTime: "",
    contact: "",
    supplierId: "",
  };
}

export function emptyRequestDraft(form: RequestForm, date: string): RequestDraft {
  return {
    form,
    date,
    projectMode: "one",
    projectId: "",
    projectOther: "",
    projectOtherMode: false,
    stops: [emptyStop()],
    startingPointId: "",
    departmentId: "",
    vehiclePlate: "",
    driverId: "",
    supervisorId: "",
    headId: "",
    siteOfficer: "",
    siteCompany: "",
  };
}

const projectKey = (request: TransportRequest) =>
  request.projectIsOther ? "other:" + request.projectName : (request.projectId ?? "");

/** A saved request's form, from its group and its stops (A first). Cancelled stops are left out. */
export function draftFromGroup(group: RequestGroup, stops: TransportRequest[], lockedIds: Set<string>): RequestDraft {
  const active = stops.filter((item) => item.status === "ACTIVE");
  const single = new Set(active.map(projectKey)).size <= 1;
  const first = active[0];
  return {
    form: group.form,
    date: group.date,
    projectMode: single ? "one" : "multi",
    projectId: single && first && !first.projectIsOther ? (first.projectId ?? "") : "",
    projectOther: single && first?.projectIsOther ? first.projectName : "",
    projectOtherMode: !!(single && first?.projectIsOther),
    stops: active.map((request) => {
      const destination = request.destinations[0];
      return {
        key: request.id,
        id: request.id,
        letter: request.stopLetter,
        locked: lockedIds.has(request.id),
        projectId: request.projectIsOther ? "" : (request.projectId ?? ""),
        projectOther: request.projectIsOther ? request.projectName : "",
        projectOtherMode: request.projectIsOther,
        destinationId: destination && !destination.destinationIsOther ? (destination.destinationId ?? "") : "",
        destinationOther: destination?.destinationIsOther ? destination.destinationName : "",
        destinationOtherMode: !!destination?.destinationIsOther,
        purposeId: request.urgentReason || !destination || destination.purposeIsOther ? "" : (destination.purposeId ?? ""),
        purposeOther: !request.urgentReason && destination?.purposeIsOther ? destination.purposeName : "",
        purposeOtherMode: !request.urgentReason && !!destination?.purposeIsOther,
        urgent: !!request.urgentReason,
        urgentReasonId: request.urgentReason?.id ?? "",
        details: request.details,
        flexibility: request.flexibility,
        fixedTime: request.fixedTime ?? "",
        contact: request.contact,
        supplierId: request.supplier?.id ?? "",
      };
    }),
    startingPointId: group.startingPoint?.id ?? "",
    departmentId: group.department?.id ?? "",
    vehiclePlate: group.vehiclePlate ?? "",
    driverId: group.driver?.id ?? "",
    supervisorId: group.supervisor?.id ?? "",
    headId: group.head?.id ?? "",
    siteOfficer: group.siteOfficer,
    siteCompany: group.siteCompany,
  };
}

/** The project a stop goes out with: the single one, or its own. */
function stopProject(draft: RequestDraft, stop: StopDraft) {
  const from = draft.projectMode === "one" ? draft : stop;
  return from.projectOtherMode
    ? { projectId: "", projectOther: from.projectOther.trim() }
    : { projectId: from.projectId, projectOther: "" };
}

export function draftToInput(draft: RequestDraft): RequestGroupInput {
  const company = draft.form === "COMPANY";
  return {
    date: draft.date,
    stops: draft.stops.map((stop) => ({
      ...(stop.id ? { id: stop.id } : {}),
      ...stopProject(draft, stop),
      destinationId: stop.destinationOtherMode ? "" : stop.destinationId,
      destinationOther: stop.destinationOtherMode ? stop.destinationOther.trim() : "",
      purposeId: stop.urgent || stop.purposeOtherMode ? "" : stop.purposeId,
      purposeOther: !stop.urgent && stop.purposeOtherMode ? stop.purposeOther.trim() : "",
      urgentReasonId: stop.urgent ? stop.urgentReasonId : "",
      details: stop.details.trim(),
      flexibility: stop.flexibility,
      fixedTime: stop.flexibility === "FIXED" ? stop.fixedTime : "",
      contact: stop.contact.trim(),
      supplierId: company ? stop.supplierId : "",
    })),
    startingPointId: company ? draft.startingPointId : "",
    departmentId: company ? draft.departmentId : "",
    vehiclePlate: company ? draft.vehiclePlate : "",
    driverId: company ? draft.driverId : "",
    supervisorId: company ? draft.supervisorId : "",
    headId: company ? draft.headId : "",
    siteOfficer: company ? draft.siteOfficer.trim() : "",
    siteCompany: company ? draft.siteCompany.trim() : "",
  };
}

/** The name of a chosen option, or "" if it isn't one. */
export function optionName(list: BookingOption[], id: string) {
  return list.find((item) => item.id === id)?.name ?? "";
}

/** A stop's purpose as it will read: the urgent reason on an Urgent stop. */
export function stopPurpose(stop: StopDraft, options: BookingOptions) {
  if (stop.urgent) return optionName(options.urgent_reasons, stop.urgentReasonId);
  return stop.purposeOtherMode ? stop.purposeOther.trim() : optionName(options.purposes, stop.purposeId);
}

/** Pick up and Delivery need details, as does every Urgent stop (same names as 0052). */
export function needsDetails(stop: StopDraft, options: BookingOptions) {
  if (stop.urgent) return true;
  return ["pick up", "pickup", "delivery"].includes(stopPurpose(stop, options).toLowerCase());
}

export type StopField = "project" | "destination" | "purpose" | "urgentReason" | "details" | "fixedTime";
export type StopErrors = Partial<Record<StopField, string>>;

/** What a stop still needs, as the message to show under each field. */
export function stopErrors(draft: RequestDraft, stop: StopDraft, options: BookingOptions): StopErrors {
  const errors: StopErrors = {};
  if (stop.locked) return errors;
  if (draft.projectMode === "multi" && (stop.projectOtherMode ? !stop.projectOther.trim() : !stop.projectId))
    errors.project = "Pick the project this stop is for.";
  if (stop.destinationOtherMode ? !stop.destinationOther.trim() : !stop.destinationId)
    errors.destination = "Pick a destination.";
  if (stop.urgent && !stop.urgentReasonId) errors.urgentReason = "Pick why this stop is urgent, or set it to Regular.";
  if (!stop.urgent && (stop.purposeOtherMode ? !stop.purposeOther.trim() : !stop.purposeId))
    errors.purpose = "Pick a purpose.";
  if (needsDetails(stop, options) && !stop.details.trim())
    errors.details = stop.urgent
      ? "Say what's needed at this stop, e.g. what to pick up or deliver."
      : `Say what to ${stopPurpose(stop, options).toLowerCase()}, e.g. items, quantity, who receives.`;
  if (stop.flexibility === "FIXED" && !stop.fixedTime) errors.fixedTime = "Add the appointment time.";
  return errors;
}

const FIELD_NAMES: Record<StopField, string> = {
  project: "Project / Site",
  destination: "Destination",
  purpose: "Purpose",
  urgentReason: "Urgent reason",
  details: "Details",
  fixedTime: "Time",
};

/** Everything the form still needs, e.g. ["Project / Site", "Stop B: Details"]. */
export function draftMissing(draft: RequestDraft, options: BookingOptions): string[] {
  const missing: string[] = [];
  if (!draft.date) missing.push("Date");
  if (draft.projectMode === "one" && (draft.projectOtherMode ? !draft.projectOther.trim() : !draft.projectId))
    missing.push("Project / Site");
  if (!draft.stops.length) missing.push("at least one destination");
  const many = draft.stops.length > 1;
  draft.stops.forEach((stop, index) => {
    const prefix = many ? `Stop ${stopLetter(draft, index)}: ` : "";
    for (const field of Object.keys(stopErrors(draft, stop, options)) as StopField[])
      missing.push(prefix + FIELD_NAMES[field]);
  });
  return missing;
}

/**
 * The letter a stop shows: its saved one, or the next free letters for new
 * stops (as next_stop_letter gives them; dropped stops keep their letter).
 */
export function stopLetter(draft: RequestDraft, index: number, usedLetters = 0) {
  const stop = draft.stops[index];
  if (stop.letter) return stop.letter;
  const saved = Math.max(usedLetters, ...draft.stops.map((item) => (item.letter ? item.letter.charCodeAt(0) - 64 : 0)));
  const newBefore = draft.stops.slice(0, index).filter((item) => !item.letter).length;
  return String.fromCharCode(65 + saved + newBefore);
}

/** Whether a new form holds anything the requester entered. */
export function draftHasContent(draft: RequestDraft) {
  return !!(
    draft.projectId ||
    draft.projectOther.trim() ||
    draft.stops.some(
      (stop) =>
        stop.projectId ||
        stop.projectOther.trim() ||
        stop.destinationId ||
        stop.destinationOther.trim() ||
        stop.purposeId ||
        stop.purposeOther.trim() ||
        stop.urgentReasonId ||
        stop.details.trim() ||
        stop.contact.trim(),
    )
  );
}

/** Monday to Saturday of a date's week, e.g. "Oct 12–17": what "any day that week" covers. */
export function weekLabel(date: string) {
  const day = new Date(date + "T12:00:00");
  const monday = new Date(day);
  monday.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  const short = (value: Date) => value.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const end = saturday.getMonth() === monday.getMonth() ? String(saturday.getDate()) : short(saturday);
  return `${short(monday)}–${end}`;
}

const dayLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** "12:30 PM" for "12:30". */
export function timeLabel(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

/** When a stop is wanted, in words: "Wed, Oct 15, any time". */
export function whenText(date: string, flexibility: StopFlexibility, fixedTime: string) {
  if (!date) return "No date yet";
  if (flexibility === "WEEK") return `Any day ${weekLabel(date)} (asked for ${dayLabel(date)})`;
  if (flexibility === "FIXED") return `${dayLabel(date)} at ${fixedTime ? timeLabel(fixedTime) : "—"}`;
  return `${dayLabel(date)}, any time`;
}

/** The same without the date, for a list that shows it already: "Any time", "At 1:05 PM", "Any day Oct 12–17". */
export function flexibilityShort(date: string, flexibility: StopFlexibility, fixedTime: string) {
  if (flexibility === "WEEK") return `Any day ${weekLabel(date)}`;
  if (flexibility === "FIXED") return `At ${fixedTime ? timeLabel(fixedTime) : "—"}`;
  return "Any time";
}

export const FLEXIBILITY:Record<StopFlexibility, { label: string; hint: string }> = {
  DAY: { label: "Any time that day", hint: "The Scheduler picks the time." },
  FIXED: { label: "Fixed time", hint: "An appointment at an exact time." },
  WEEK: { label: "Any day that week", hint: "The Scheduler may move it to another day that week and tells you." },
};
