import type { RequestInput } from "@/lib/kova-api";

/**
 * Shape-checks a New request / Edit request body before it reaches the
 * RPC. Only structure is checked here; the date rules, active options and
 * edit lock are enforced by create_request/update_request in Postgres.
 * Returns null when the body isn't usable.
 */
export function parseRequestInput(body: unknown): RequestInput | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : "");

  const date = text("date");
  const requestType = text("requestType");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (requestType !== "REGULAR" && requestType !== "URGENT")) return null;
  if (!Array.isArray(value.destinations) || value.destinations.length === 0) return null;

  const destinations: RequestInput["destinations"] = [];
  for (const item of value.destinations) {
    const row = item as Record<string, unknown>;
    const str = (key: string) => (typeof row?.[key] === "string" ? (row[key] as string) : "");
    const destinationId = str("destinationId");
    const destinationOther = str("destinationOther").trim();
    const purposeId = str("purposeId");
    const purposeOther = str("purposeOther").trim();
    if (!destinationId && !destinationOther) return null;
    if (!purposeId && !purposeOther) return null;
    destinations.push({ destinationId, destinationOther, purposeId, purposeOther });
  }

  return { date, requestType, projectId: text("projectId"), projectOther: text("projectOther").trim(), destinations };
}
