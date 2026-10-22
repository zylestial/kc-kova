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

/** The Vehicles list's filters on Settings. */
export type VehicleFilters = { status: "all" | Vehicle["status"]; companyTrips: "all" | "yes" | "no" };
export const noVehicleFilters: VehicleFilters = { status: "all", companyTrips: "all" };

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

export function vehicleMatches(vehicle: Pick<Vehicle, "status" | "companyTrips">, f: VehicleFilters): boolean {
  if (f.status !== "all" && vehicle.status !== f.status) return false;
  if (f.companyTrips !== "all" && vehicle.companyTrips !== (f.companyTrips === "yes")) return false;
  return true;
}

/** How many filters are set, for the phone's Filters button. */
export const accountFiltersSet = (f: AccountFilters) =>
  (f.search.trim() ? 1 : 0) + [f.role, f.status, f.access].filter((value) => value !== "all").length;
export const vehicleFiltersSet = (f: VehicleFilters) => [f.status, f.companyTrips].filter((value) => value !== "all").length;
