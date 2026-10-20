import type { Account } from "@/lib/kova-api";

type Who = Pick<Account, "role" | "status" | "driverType" | "canRequestDaily" | "canRequestCompany">;

/*
 * Who may ask for which kind of trip (0051, 0059, 0074). These mirror
 * can_request_daily / can_request_company / can_request_transport in
 * Postgres, which is what actually enforces them; these only decide which
 * menus and forms to show.
 */

const companyCarDriver = (account: Pick<Who, "role" | "driverType">) =>
  account.role === "Driver" && account.driverType === "Company car";

/** Accounts that request only with an Admin's switches: Schedulers and Company car drivers (0074). */
export function hasRequestSwitches(account: Pick<Who, "role" | "driverType">): boolean {
  return account.role === "Scheduler" || companyCarDriver(account);
}

/** Daily Vehicle Trip requests: every Requester and Admin, and Schedulers and Company car drivers an Admin allowed. */
export function canRequestDaily(account: Who): boolean {
  if (account.status !== "Active") return false;
  return account.role === "Requester" || account.role === "Admin" || (hasRequestSwitches(account) && account.canRequestDaily);
}

/** Company Trip requests: every Admin (0059), and accounts an Admin allowed; never a Truck driver. */
export function canRequestCompany(account: Who): boolean {
  if (account.status !== "Active") return false;
  if (account.role === "Admin") return true;
  return account.canRequestCompany && (account.role === "Requester" || hasRequestSwitches(account));
}

/** Either kind, so the request screens (New request, My requests) show. */
export function canRequestTransport(account: Who): boolean {
  return canRequestDaily(account) || canRequestCompany(account);
}
