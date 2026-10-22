import type { BookingOptions, OptionGroup } from "@/lib/kova-api";

/** What a request can't do without a list: every request, an Urgent stop, a Company Trip, or nothing. */
export type ChoiceNeed = "every" | "urgent" | "company" | "optional";

export type ChoiceList = {
  group: OptionGroup;
  /** The rail's heading. */
  section: "Every request" | "Company Trips only";
  label: string;
  one: string;
  need: ChoiceNeed;
  about: string;
};

/*
 * Settings → Request choices (owner's prototype, 2026-10-22). `need` mirrors
 * the resolve_choice calls: Project / Site, Destination and Purpose on every
 * stop, an Urgent reason on an Urgent one, and a Starting point, Immediate
 * Supervisor and PM / CM / Dept. Head on a Company Trip (0052, 0058). A
 * Supplier is optional. Departments / Sites is no longer asked for (0058).
 */
export const CHOICE_LISTS: ChoiceList[] = [
  { group: "projects", section: "Every request", label: "Projects / Sites", one: "Project / Site", need: "every",
    about: "The project a request is for. On a Company Trip it's also printed as the Department / Site." },
  { group: "destinations", section: "Every request", label: "Destinations", one: "Destination", need: "every",
    about: "Where each stop goes. Add a location so Drivers' Arrived and Leaving taps can be checked against the place." },
  { group: "purposes", section: "Every request", label: "Purposes", one: "Purpose", need: "every",
    about: "Why a stop is needed, like Delivery or Pick up." },
  { group: "urgent_reasons", section: "Every request", label: "Urgent reasons", one: "Urgent reason", need: "urgent",
    about: "The reasons a requester picks from when they mark a stop Urgent." },
  { group: "starting_points", section: "Company Trips only", label: "Starting points", one: "Starting point", need: "company",
    about: "Where a Company trip starts. Company trips don't start at ANONANG." },
  { group: "suppliers", section: "Company Trips only", label: "Suppliers", one: "Supplier", need: "optional",
    about: "Suppliers a Company Trip stop can name. Optional." },
  { group: "supervisors", section: "Company Trips only", label: "Immediate Supervisors", one: "Immediate Supervisor", need: "company",
    about: "Printed on the Company Trip Form. Every Company Trip names one." },
  { group: "heads", section: "Company Trips only", label: "PM / CM / Dept. Heads", one: "PM / CM / Dept. Head", need: "company",
    about: "Printed on the Company Trip Form. Every Company Trip names one." },
];

export const needLabel: Record<ChoiceNeed, string> = {
  every: "Required",
  urgent: "Needed for Urgent stops",
  company: "Needed for Company Trips",
  optional: "Optional",
};

/** Active choices in a list. */
export const activeCount = (options: BookingOptions, group: OptionGroup) =>
  options[group].filter((item) => item.status === "Active").length;

/** The lists a request needs that have no active choice, in rail order. */
export function choiceGaps(options: BookingOptions): ChoiceList[] {
  return CHOICE_LISTS.filter((list) => list.need !== "optional" && activeCount(options, list.group) === 0);
}

/** What an empty list stops, for its warning. */
export function gapEffect(list: ChoiceList): string {
  if (list.need === "every") return "Nobody can send a request until it has one.";
  if (list.need === "urgent") return "Nobody can mark a stop Urgent until it has one.";
  return "Nobody can send a Company Trip until it has one.";
}
