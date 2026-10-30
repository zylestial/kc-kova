import type { Role } from "@/lib/kova-api";

/**
 * The welcome tour (owner's prototype "KOVA Welcome Tour", 2026-10-30):
 * step 1 shows the role's menu and what each screen is for, then one
 * screenshot per step, then where to find the tour again. Screenshots
 * live in public/tour/<device>/<role>-<image>.webp, taken by
 * scripts/shoot-welcome-tour.mjs, whose step names match `image` here.
 */
export type TourDevice = "pc" | "tablet" | "phone";
export type TourStep = {
  image: string;
  title: string;
  text: string;
  /** Show the whole shot instead of filling the frame from the top. */
  whole?: boolean;
};

export const tourSteps: Record<Role, TourStep[]> = {
  Requester: [
    { image: "home", title: "Your Dashboard", text: "See your requests at a glance: open, not yet scheduled, sent back and scheduled. Tap a card to open that list." },
    { image: "new", title: "Request a trip", text: "Tap New request. Pick the date and the project or site, then add each stop with its purpose. Set a stop to Urgent if it can't wait." },
    { image: "list", title: "Track your requests", text: "My requests shows where each one stands. Tap Details to edit it before scheduling starts, or to ask to cancel after. If a stop is sent back, fix it and save to send it again." },
  ],
  Scheduler: [
    { image: "day", title: "Pick the day", text: "On Scheduling, tap a date card, then Daily trips or Company trips. Also waiting lists later dates that still have stops to plan." },
    { image: "plan", title: "Add stops to a vehicle", text: "Drag a stop from To plan onto a vehicle, or tap it for the best options. Open a vehicle to set each leg's Time Out and Time In." },
    { image: "missed", title: "Handle missed stops", text: "When a Driver can't reach a stop, it comes back here. Plan it again, move it to another day, or send it back to the requester.", whole: true },
    { image: "schedules", title: "Submit for approval", text: "Submit the day for the Admin to approve. Schedules shows each trip: draft, waiting for approval, approved or returned." },
  ],
  Driver: [
    { image: "schedule", title: "See your trips", text: "My Schedule lists the trips an Admin approved for you. Tap Open for the stops and planned times." },
    { image: "trip", title: "Start, tap each stop, end", text: "Tap Start trip at ANONANG before you leave. At each stop tap Arrived, then Left. Can't make a stop? Tap Problem here? and wait for the Scheduler." },
    { image: "home", title: "Complete the trip", text: "After End trip, enter the odometer readings and submit. The Admin checks it on Finished Trips." },
  ],
  Finance: [
    { image: "schedules", title: "Schedules", text: "Every trip by day, week or all dates, and where each one stands." },
    { image: "finished", title: "Finished Trips", text: "Odometers, distance and times per trip. Open one and tap Print for its form. Download CSV saves the rows for Excel." },
    { image: "attendance", title: "Attendance", text: "When each Driver started and ended, and their taps at each stop. Download CSV works here too." },
  ],
  Admin: [
    { image: "schedules", title: "Approve schedules", text: "Approve trips waiting for approval, or return them with a note. Cancellation requests show at the top: Confirm or Decline." },
    { image: "finished", title: "Close out trips", text: "Check odometers and times, fill in any that are missing, resolve problems, then Mark as done. Print gives the trip form." },
    { image: "attendance", title: "Check attendance", text: "Each Driver's Start and End taps and their stop taps. Taps away from the place or without a location are flagged." },
    { image: "settings", title: "Manage KOVA", text: "Invite people by email, edit accounts, vehicles and request choices, and choose who can request or drive Company trips." },
  ],
};

export const tourLastStep: TourStep = {
  image: "help",
  title: "You're all set",
  text: "Open this tour again any time from Help in the menu. Forgot your password? Use Forgot password? on the Sign In page.",
  whole: true,
};

// What each menu link is for, on step 1. A role's own wording wins over
// the shared one; Dashboard isn't listed.
const menuFor: Partial<Record<Role, Record<string, string>>> = {
  Requester: { "/requests": "make, edit and cancel your trip requests" },
  Scheduler: {
    "/scheduling": "plan each day's trips",
    "/schedules": "your drafts and where each trip stands",
    "/finished": "view trips the Drivers submitted",
  },
  Driver: { "/my-schedule": "your approved trips", "/finished/driver": "trips you've submitted" },
  Finance: {
    "/schedules": "every trip and where it stands",
    "/finished": "odometers, distance and times; print forms",
    "/attendance": "each Driver's start, end and stop taps",
  },
  Admin: {
    "/schedules": "approve or return trips; handle cancellations",
    "/finished": "check, fix times, mark done, print",
    "/attendance": "Drivers' taps, flags and CSV",
    "/settings": "people, vehicles and request choices",
    "/requests": "request trips yourself, even for a past date",
  },
};
const menuShared: Record<string, string> = {
  "/requests": "make and track your trip requests",
  "/my-trips": "record the Company trips you drive",
  "/account": "your username, email and password",
};

export function menuNote(role: Role, href: string): string | undefined {
  return menuFor[role]?.[href] ?? menuShared[href];
}

export function tourImage(device: TourDevice, role: Role, image: string): string {
  return `/tour/${device}/${role.toLowerCase()}-${image}.webp`;
}
