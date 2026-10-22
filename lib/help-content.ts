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
    { title: "Driving a Company trip", detail: "If you are its Driver, on My Trips: Start trip (with the odometer, if the vehicle has one), tap each stop, End trip at the last one." },
    { title: "Can't make a stop?", detail: "Tap Problem here? under it, then wait for the Scheduler's answer." },
    { title: "Change your mind", detail: "Edit before scheduling starts; after that, ask to cancel." },
  ],
  Scheduler: [
    { title: "Pick the day", detail: "On Scheduling, tap a date card, then Daily trips or Company trips. Urgent stops show on top." },
    { title: "Add stops to a vehicle", detail: "Drag a stop onto a vehicle, or tap it for the best options. Daily trips get the vehicle's Driver." },
    { title: "Any day that week", detail: "Adding such a stop to another day moves it there; the requester is told." },
    { title: "Can't fit a stop?", detail: "Tap it and choose Send back to requester, with a reason. They fix it and save to send it again." },
    { title: "Check the legs", detail: "Open a vehicle to set each leg's Time Out/In or reorder legs. Fix any warning before you submit." },
    { title: "Take a stop off", detail: "Remove its leg: back to To plan, or back to the requester with a reason." },
    { title: "Submit for approval", detail: "Admin approves or sends it back. Undo reverses your last change; Propose changes edits an approved trip." },
    { title: "Trips on the road", detail: "Change the stops not reached yet; the Driver sees it once the Admin approves." },
    { title: "Answer the Driver", detail: "A Driver's report holds the trip: skip it, wait there, end the trip or change the route." },
    { title: "Missed stops", detail: "Once skipped, a stop's banner offers Plan again, Another day or Send back." },
  ],
  Driver: [
    { title: "See your trips", detail: "My Schedule lists only your approved trips." },
    { title: "Check the plan", detail: "Open a trip for its stops and planned times." },
    { title: "Start and end at ANONANG", detail: "Tap Start trip before you leave and End trip when back. It is your attendance." },
    { title: "Tap at each stop", detail: "Tap Arrived when you reach a stop and Leaving as you go. These times print on the form." },
    { title: "Complete the trip", detail: "After End trip at ANONANG, log the start/end odometer (skipped for a vehicle without one)." },
    { title: "Problem at a stop?", detail: "Tap Problem here? under it, then wait: the Scheduler tells you to skip it, wait, end the trip, or a new route." },
    { title: "Something went wrong?", detail: "Report a problem — you can do this any time." },
    { title: "Company trips", detail: "Record the ones you drive on My Trips: Start trip, each stop, End trip." },
  ],
  Admin: [
    { title: "Review schedules", detail: "Approve, Return with a note, or handle cancellations." },
    { title: "Close out trips", detail: "Check odometers and times, fill in missed ones, resolve problems, mark Done, print the form." },
    { title: "Check attendance", detail: "See each Driver's taps at ANONANG and at each stop; odd taps are flagged." },
    { title: "Download", detail: "Download CSV on Finished Trips or Attendance: pick the dates and filters, then save it for Excel." },
    { title: "Manage the system", detail: "Invite people by email, accounts and passwords, vehicles, Drivers, request choices, who can request and who can drive Company trips." },
    { title: "Act as anyone", detail: "You can also submit requests, even for a past date." },
  ],
  Finance: [
    { title: "View only", detail: "You see trips and attendance; you can't change them." },
    { title: "Schedules", detail: "Every trip by day, week or all dates, and where each one stands." },
    { title: "Finished Trips", detail: "Odometers, distance and times per trip. Open one and tap Print for its form." },
    { title: "Attendance", detail: "When each Driver started and ended, and their taps at each stop. Company trips are there too; the Form filter leaves them out." },
    { title: "Download", detail: "Download CSV on Finished Trips or Attendance: pick the dates and filters, then save it for Excel." },
    { title: "Requests", detail: "If an Admin allows it, make Daily or Company trip requests like a Requester." },
  ],
};

/** What to do about a forgotten password (0072: reset by email from Sign In). */
export const whoToAsk: Record<Role, string> = {
  Requester: "Forgot your password? Use Forgot password? on the Sign In page and we'll email you a link. Tap your name in the menu to change your username, email or password.",
  Scheduler: "Forgot your password? Use Forgot password? on the Sign In page and we'll email you a link. Tap your name in the menu to change your username, email or password.",
  Driver: "Forgot your password? Use Forgot password? on the Sign In page and we'll email you a link. Tap your name in the menu to change your username, email or password.",
  Admin: "Forgot your password? Use Forgot password? on the Sign In page. You can also set someone's password in Settings if their email doesn't reach them.",
  Finance: "Forgot your password? Use Forgot password? on the Sign In page and we'll email you a link. Tap your name in the menu to change your username, email or password.",
};
