import type { Role } from "@/lib/kova-api";

/**
 * Plain-language help shown on each role's Home ("How this works") and in
 * the Help dialog. Each step is a short title (readable at a glance) plus
 * one short line of detail — not a paragraph — so the whole thing can be
 * learned in one look rather than read start to finish.
 */
export type HelpStep = { title: string; detail: string };

export const howItWorks: Record<Role, HelpStep[]> = {
  Requester: [
    { title: "Request a trip", detail: "Pick a date, add each stop and its purpose." },
    { title: "Regular vs Urgent", detail: "The date sets it: Urgent for today up to 6 days ahead, Regular for 7 or more days ahead." },
    { title: "Track progress", detail: "My requests shows Scheduler and Admin approval status." },
    { title: "Change your mind", detail: "Edit before scheduling starts; after that, ask to cancel." },
  ],
  Scheduler: [
    { title: "Build the day", detail: "Create schedule, then pick from the waiting requests." },
    { title: "Vehicle picks the Driver", detail: "Choosing a vehicle assigns its Driver for you." },
    { title: "Fill the Trip Record", detail: "One leg per stop, timed Out/In, starting and ending at ANONANG." },
    { title: "Submit for approval", detail: "Draft holds the time; Admin approves or sends it back." },
  ],
  Driver: [
    { title: "See your trips", detail: "My Schedule lists only your approved trips." },
    { title: "Check the plan", detail: "Open a trip for its stops and planned times." },
    { title: "Start and end at ANONANG", detail: "Tap Start trip before you leave and End trip when back. It is your attendance." },
    { title: "Complete the trip", detail: "After the last Time In, log the start/end odometer." },
    { title: "Something went wrong?", detail: "Report a problem — you can do this any time." },
  ],
  Admin: [
    { title: "Review schedules", detail: "Approve, Return with a note, or handle cancellations." },
    { title: "Close out trips", detail: "Check odometers, fix if needed, resolve problems, mark Done." },
    { title: "Check attendance", detail: "See when each Driver started and ended at ANONANG; odd taps are flagged." },
    { title: "Manage the system", detail: "Accounts, passwords, vehicles, Drivers, request choices." },
    { title: "Act as anyone", detail: "You can also submit requests, even for a past date." },
  ],
};

/** Who to turn to, since KOVA has no self-service password reset. */
export const whoToAsk: Record<Role, string> = {
  Requester: "Forgot your password? Ask an Admin — they can set a new one.",
  Scheduler: "Forgot your password? Ask an Admin — they can set a new one.",
  Driver: "Forgot your password? Ask an Admin — they can set a new one.",
  Admin: "Forgot your password? Ask another Admin to set a new one in Settings.",
};
