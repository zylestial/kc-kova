import type { DriverType, Role } from "@/lib/kova-api";

type InviteAccess = { role: Role; driverType?: DriverType | null; canRequestDaily: boolean; canRequestCompany: boolean };

/**
 * Whether the Join page asks for a Position, from the invite's role and
 * access: company trips print it on the Company Trip Form, so it's
 * required then (0051); an Admin's prints if set (0059); nobody else's is
 * ever printed, so they aren't asked.
 */
export function positionAsk(invite: Pick<InviteAccess, "role" | "canRequestCompany">): "required" | "optional" | "none" {
  if (invite.canRequestCompany) return "required";
  return invite.role === "Admin" ? "optional" : "none";
}

/** What an invite lets someone do, in a few words, for the Join page. */
export function accessSummary(invite: InviteAccess): string {
  if (invite.role === "Scheduler") return "Scheduler · plans the trips";
  if (invite.role === "Admin") return "Admin · runs KOVA, can make requests and company trips";
  const parts: string[] = [invite.role === "Driver" ? `${invite.driverType ?? "Truck"} Driver` : "Requester"];
  const daily = invite.role === "Requester" || (invite.driverType === "Company car" && invite.canRequestDaily);
  if (daily) parts.push("Daily requests");
  if (invite.canRequestCompany) parts.push("Company trips");
  return parts.join(" · ");
}
