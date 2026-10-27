import type { Account, Role, Vehicle } from "@/lib/kova-api";
import { canDriveCompany, canRequestCompany, canRequestDaily } from "@/lib/request-access";

type AccountFacts = Pick<Account, "role" | "status" | "driverType" | "canRequestDaily" | "canRequestCompany" | "canDriveCompany">;

/** What an account (or an invite, as if accepted) may do, as Settings' Access chips (0051, 0074, 0079). */
export function accessLabels(account: AccountFacts): string[] {
  return [
    canRequestDaily(account) && "Daily requests",
    canRequestCompany(account) && "Company trip requests",
    canDriveCompany(account) && "Drives company trips",
  ].filter((label): label is string => !!label);
}

/** Settings → Accounts' rail: views over the accounts; Pending invites is its own list (owner's prototype, 2026-10-22). */
export type AccountView = {
  id: string;
  section: string;
  label: string;
  about: string;
  test: (account: AccountFacts) => boolean;
  /** Said when nobody is in it, and the count shows as a warning. */
  warnIfEmpty?: string;
};
const roleView = (role: Role, label: string, about: string): AccountView => ({
  id: role,
  section: "People",
  label,
  about,
  test: (account) => account.role === role,
});
export const ACCOUNT_VIEWS: AccountView[] = [
  { id: "all", section: "People", label: "All accounts", about: "Everyone who can sign in to KOVA.", test: () => true },
  roleView("Admin", "Admins", "Run KOVA: approve schedules, close trips, manage Settings."),
  roleView("Scheduler", "Schedulers", "Plan each day's trips and submit them for approval."),
  roleView("Requester", "Requesters", "Ask for transport."),
  roleView("Driver", "Drivers", "Drive the trips. Truck drivers do Daily trips; Company car Drivers can also drive Company trips."),
  roleView("Finance", "Finance", "View trips and attendance."),
  {
    id: "drive-company",
    section: "Access",
    label: "Can drive company trips",
    about: "Who can be picked as a Company trip's Driver. Company car Drivers always can; for anyone else, switch it on in Edit.",
    test: canDriveCompany,
    warnIfEmpty: "Nobody yet",
  },
  {
    id: "request-company",
    section: "Access",
    label: "Can request company trips",
    about: "Who sees Company Trip on the New request form. Every Admin can.",
    test: canRequestCompany,
  },
];
export const INVITES_VIEW = {
  id: "invites",
  section: "Invites",
  label: "Pending invites",
  about: "People who were emailed an invite and haven't set up their account yet. A link works once, for 7 days.",
};

type VehicleFacts = Pick<Vehicle, "status" | "companyTrips" | "hasOdometer" | "assignedDriverId">;

/** An active Daily vehicle whose Driver isn't an active Driver can't go on a Daily trip (0079). */
export const vehicleNeedsDriver = (vehicle: VehicleFacts, activeDriverIds: ReadonlySet<string>) =>
  vehicle.status === "Active" && !vehicle.companyTrips && !(vehicle.assignedDriverId && activeDriverIds.has(vehicle.assignedDriverId));

/** Settings → Vehicles' rail: views over the vehicles (owner's prototype, 2026-10-22). */
export type VehicleView = {
  id: string;
  section: string;
  label: string;
  about: string;
  test: (vehicle: VehicleFacts, activeDriverIds: ReadonlySet<string>) => boolean;
  /** Its vehicles need the Admin, so a count shows as a warning. */
  warn?: boolean;
  /** Add vehicle shows here; the company view adds one already ticked. */
  canAdd?: boolean;
};
export const VEHICLE_VIEWS: VehicleView[] = [
  { id: "all", section: "Vehicles", label: "All vehicles", about: "Every company vehicle.", test: () => true, canAdd: true },
  {
    id: "company",
    section: "Kind",
    label: "Can be requested for company trips",
    about: "Offered on the Company Trip form, with the Driver the requester picks. Never put on a Daily trip.",
    test: (vehicle) => vehicle.companyTrips,
    canAdd: true,
  },
  {
    id: "daily",
    section: "Kind",
    label: "Daily trips only",
    about: "Planned by the Scheduler on Daily trips, driven by the vehicle's assigned Driver.",
    test: (vehicle) => !vehicle.companyTrips,
    canAdd: true,
  },
  {
    id: "no-driver",
    section: "Needs attention",
    label: "No Driver assigned",
    about: "An active Daily vehicle with no active Driver can't be put on a Daily trip.",
    test: vehicleNeedsDriver,
    warn: true,
  },
  { id: "no-odometer", section: "Needs attention", label: "No odometer", about: "Trips on these vehicles take no odometer readings.", test: (vehicle) => !vehicle.hasOdometer },
  {
    id: "inactive",
    section: "Needs attention",
    label: "Inactive",
    about: "Retired vehicles. They stay on old trips but can't be planned.",
    test: (vehicle) => vehicle.status === "Inactive",
  },
];
