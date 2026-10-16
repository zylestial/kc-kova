import { z } from "zod";
import type { StopReportInput } from "@/lib/kova-api";
import { parseWith } from "@/lib/validation";

const stopReportBody = z.object({
  legId: z.uuid(),
  kind: z.enum(["NOT_AVAILABLE", "WRONG_ADDRESS", "ROAD_BLOCKED", "VEHICLE_PROBLEM", "OTHER"]),
  note: z.string().trim().max(500).catch(""),
  requestIds: z.array(z.uuid()).min(1).max(20).optional(),
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracyM: z.number().min(0).nullable().catch(null),
    })
    .nullable()
    .default(null),
});

/**
 * Shape-checks a stop report body before it reaches report_stop (0061): the
 * stop, what happened, the note, which of
 * the requests there (0067; all when left out), and the optional position. Which kinds need a note, and who may report, are
 * enforced in Postgres. Returns null when the body isn't usable.
 */
export function parseStopReportInput(body: unknown): StopReportInput | null {
  return parseWith(stopReportBody, body);
}
