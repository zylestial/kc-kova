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
    { title: "Request a trip", detail: "Pick a date, add each stop with its purpose. Each stop gets its own number, like 52-A." },
    { title: "Urgent stops", detail: "Set a stop to Urgent and pick why. Urgent stops are planned first." },
    { title: "Company trips", detail: "If an Admin allows it, pick Company Trip, then the vehicle and Driver." },
    { title: "Track progress", detail: "My requests shows Scheduler and Admin approval status." },
    { title: "Record your Company trip", detail: "On My Trips: Start trip with the odometer, tap each stop, End trip at the last one." },
    { title: "Change your mind", detail: "Edit before scheduling starts; after that, ask to cancel." },
  ],
  Scheduler: [
    { title: "Pick the day", detail: "On Scheduling, tap a date card, then Daily trips or Company trips. Urgent stops show on top." },
    { title: "Add stops to a vehicle", detail: "Drag a stop onto a vehicle, or tap it for the best options. Daily trips get the vehicle's Driver." },
    { title: "Any day that week", detail: "Adding such a stop to another day moves it there; the requester is told." },
    { title: "Check the legs", detail: "Open a vehicle to set each leg's Time Out/In or reorder legs. Fix any warning before you submit." },
    { title: "Take a stop off", detail: "Remove its leg: back to To plan, or back to the requester with a reason." },
    { title: "Submit for approval", detail: "Admin approves or sends it back. Undo reverses your last change; Propose changes edits an approved trip." },
  ],
  Driver: [
    { title: "See your trips", detail: "My Schedule lists only your approved trips." },
    { title: "Check the plan", detail: "Open a trip for its stops and planned times." },
    { title: "Start and end at ANONANG", detail: "Tap Start trip before you leave and End trip when back. It is your attendance." },
    { title: "Tap at each stop", detail: "Tap Arrived when you reach a stop and Leaving as you go. These times print on the form." },
    { title: "Complete the trip", detail: "After End trip at ANONANG, log the start/end odometer." },
    { title: "Something went wrong?", detail: "Report a problem — you can do this any time." },
    { title: "Company trips", detail: "The requester records these on their phone; you only drive." },
  ],
  Admin: [
    { title: "Review schedules", detail: "Approve, Return with a note, or handle cancellations." },
    { title: "Close out trips", detail: "Check odometers and times, fill in missed ones, resolve problems, mark Done, print the form." },
    { title: "Check attendance", detail: "See each Driver's taps at ANONANG and at each stop; odd taps are flagged." },
    { title: "Manage the system", detail: "Accounts, passwords, vehicles, Drivers, request choices, who can request Company trips." },
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
