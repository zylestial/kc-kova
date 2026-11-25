import type { BookingOption, BookingOptions, OptionGroup } from "@/lib/kova-api";

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

const byName = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** "  Wilcon   Calasiao " -> "wilcon calasiao": names that match, as option_name_key (0049) matches them. */
export const choiceNameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The Destination dropdown on a request: Active choices a Requester can pick
 * (never a fuel/errand stop, which only a Scheduler adds), plus any the
 * request being edited already uses even if made Inactive (0024), A to Z.
 * A name shows once: of two Active choices with the same name, the one the
 * request already uses wins, so its stop still shows what it was set to.
 */
export function destinationChoices(options: BookingOption[], kept: Array<{ id: string; name: string }> = []) {
  const keptIds = new Set(kept.map((item) => item.id));
  const active = options.filter((item) => item.status === "Active" && !item.isOtherStop);
  const seen = new Set<string>();
  const list: Array<{ id: string; name: string }> = [];
  for (const item of [...active.filter((a) => keptIds.has(a.id)), ...active.filter((a) => !keptIds.has(a.id))]) {
    const key = choiceNameKey(item.name);
    if (seen.has(key) && !keptIds.has(item.id)) continue;
    seen.add(key);
    list.push({ id: item.id, name: item.name });
  }
  for (const item of kept)
    if (item.id && !list.some((option) => option.id === item.id)) list.push({ id: item.id, name: `${item.name} (inactive)` });
  return list.sort((a, b) => byName.compare(a.name, b.name));
}
