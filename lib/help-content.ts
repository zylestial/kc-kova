import type { Role } from "@/lib/kova-api";

/**
 * Plain-language help shown on each role's Home ("How this works") and in
 * the Help dialog. Written for someone using KOVA for the first time, so it
 * avoids system words and says who does what next.
 */
export const howItWorks: Record<Role, string[]> = {
  Requester: [
    "Choose New request, pick the date you need transport, then add each destination with its purpose.",
    "Regular requests need at least 7 days' notice. Urgent requests are for today or tomorrow only.",
    "A Scheduler plans the vehicle, Driver and times, and an Admin approves it. My requests shows how far along it is.",
    "You can edit a request until scheduling starts. After that, ask for a cancellation and an Admin decides.",
  ],
  Scheduler: [
    "In Create schedule, pick the day, then tick the requests waiting for that day.",
    "Choose a vehicle. Its Driver comes with it.",
    "Fill in the Trip Record: one leg per stop, each with a planned Time Out and Time In. The trip starts and ends at ANONANG.",
    "Save a draft to hold the time, or Submit for approval. The Driver only sees the trip once an Admin approves it, and an Admin may send it back for changes.",
  ],
  Driver: [
    "My Schedule lists your approved trips.",
    "Open a trip to see its Trip Record: the stops and their planned times.",
    "After the trip's last planned Time In, choose Complete trip and enter the odometer at the start and at the end.",
    "If a trip can't go as planned, choose Report a problem. You can do this at any time.",
  ],
  Admin: [
    "In Schedules, review submitted schedules, then Approve them or Return them with a note. Cancellation requests are handled there too.",
    "In Finished Trips, check each Driver's odometer readings, correct them if needed, deal with reported problems, then mark the trip Done.",
    "In Settings, manage accounts (including password resets), vehicles and their Drivers, and the choices people pick from in requests.",
    "You can also make requests yourself, including for a date that has already passed.",
  ],
};

/** Who to turn to, since KOVA has no self-service password reset. */
export const whoToAsk: Record<Role, string> = {
  Requester: "Forgot your password or can't sign in? Ask an Admin. They can set a new one for you.",
  Scheduler: "Forgot your password or can't sign in? Ask an Admin. They can set a new one for you.",
  Driver: "Forgot your password or can't sign in? Ask an Admin. They can set a new one for you.",
  Admin: "Forgot your password? Ask another Admin to set a new one in Settings.",
};
