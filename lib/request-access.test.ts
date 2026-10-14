import { describe, expect, it } from "vitest";
import type { Account, Vehicle } from "@/lib/kova-api";
import { canRequestTransport } from "@/lib/request-access";

const account = (role: Account["role"], status: Account["status"] = "Active") => ({ id: "a1", role, status });
const vehicle = (type: Vehicle["type"], assignedDriverId: string | null = "a1"): Vehicle => ({
  plate: "ABC-123",
  name: "Hauler",
  status: "Active",
  assignedDriverId,
  type,
  requestable: true,
});

describe("canRequestTransport", () => {
  it("lets Requesters and Admins ask, but not Schedulers", () => {
    expect(canRequestTransport(account("Requester"), [])).toBe(true);
    expect(canRequestTransport(account("Admin"), [])).toBe(true);
    expect(canRequestTransport(account("Scheduler"), [])).toBe(false);
  });

  it("lets a Driver ask unless they drive a Truck", () => {
    expect(canRequestTransport(account("Driver"), [vehicle("Van")])).toBe(true);
    expect(canRequestTransport(account("Driver"), [])).toBe(true);
    expect(canRequestTransport(account("Driver"), [vehicle("Truck")])).toBe(false);
    expect(canRequestTransport(account("Driver"), [vehicle("Truck", "someone-else")])).toBe(true);
  });

  it("refuses inactive accounts", () => {
    expect(canRequestTransport(account("Requester", "Inactive"), [])).toBe(false);
  });
});
