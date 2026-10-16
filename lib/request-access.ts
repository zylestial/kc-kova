import type { Account } from "@/lib/kova-api";

type Who = Pick<Account, "role" | "status" | "driverType" | "canRequestDaily" | "canRequestCompany">;

/*
 * Who may ask for which kind of trip (0051). These mirror
 * can_request_daily / can_request_company / can_request_transport in
 * Postgres, which is what actually enforces them; these only decide which
 * menus and forms to show.
 */

const companyCarDriver = (account: Who) => account.role === "Driver" && account.driverType === "Company car";

/** Daily Vehicle Trip requests: every Requester and Admin, and Company car drivers an Admin allowed. */
export function canRequestDaily(account: Who): boolean {
  if (account.status !== "Active") return false;
  return account.role === "Requester" || account.role === "Admin" || (companyCarDriver(account) && account.canRequestDaily);
}

/** Company Trip requests: accounts an Admin allowed; never a Scheduler or a Truck driver. */
export function canRequestCompany(account: Who): boolean {
  if (account.status !== "Active" || !account.canRequestCompany) return false;
  return account.role === "Requester" || account.role === "Admin" || companyCarDriver(account);
}

/** Either kind, so the request screens (New request, My requests) show. */
export function canRequestTransport(account: Who): boolean {
  return canRequestDaily(account) || canRequestCompany(account);
}
