import type { Account, Vehicle } from "@/lib/kova-api";

/**
 * Whether this account may ask for transport (New request, My requests):
 * an active Requester or Admin, or an active Driver who doesn't drive a
 * Truck. Mirrors can_request_transport in Postgres (0051), which is what
 * actually enforces it; this only decides which menus to show.
 */
export function canRequestTransport(account: Pick<Account, "id" | "role" | "status">, vehicles: Vehicle[]): boolean {
  if (account.status !== "Active") return false;
  if (account.role === "Requester" || account.role === "Admin") return true;
  if (account.role !== "Driver") return false;
  return !vehicles.some((vehicle) => vehicle.assignedDriverId === account.id && vehicle.type === "Truck");
}
