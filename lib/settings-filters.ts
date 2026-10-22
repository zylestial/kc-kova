import type { Account, Role, Vehicle } from "@/lib/kova-api";
import { canDriveCompany, canRequestCompany } from "@/lib/request-access";

/** The Accounts list's filters on Settings; "all" lets everything through. */
export type AccountFilters = {
  search: string;
  role: "all" | Role;
  status: "all" | Account["status"];
  access: "all" | "request-company" | "drive-company";
};
export const noAccountFilters: AccountFilters = { search: "", role: "all", status: "all", access: "all" };

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

/** Whether an account passes the filters; the search matches its name, username or email. */
export function accountMatches(account: Account, f: AccountFilters, email = ""): boolean {
  const term = f.search.trim().toLowerCase();
  if (term && ![account.name, account.username, email].some((value) => value.toLowerCase().includes(term))) return false;
  if (f.role !== "all" && account.role !== f.role) return false;
  if (f.status !== "all" && account.status !== f.status) return false;
  // canDriveCompany / canRequestCompany also need the account Active; the switch is what's asked here.
  const active = { ...account, status: "Active" as const };
  if (f.access === "request-company" && !canRequestCompany(active)) return false;
  if (f.access === "drive-company" && !canDriveCompany(active)) return false;
  return true;
}

/** How many filters are set, for the phone's Filters button. */
export const accountFiltersSet = (f: AccountFilters) =>
  (f.search.trim() ? 1 : 0) + [f.role, f.status, f.access].filter((value) => value !== "all").length;
