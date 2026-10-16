import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { loadSchedule, scheduleErrorResponse } from "@/lib/supabase/schedules";
import { parseScheduleInput } from "@/lib/schedule-input";
import { parseWith } from "@/lib/validation";
import { z } from "zod";

const invalidBody = "Date, vehicle, requests and legs are required.";

// Creates a schedule as a first draft. save_schedule_draft allows this for
// a Scheduler, or an Admin acting as Scheduler (view-as override); anyone
// else gets 403.
// A body with kind "COMPANY" starts a Company trip instead (create_company_trip, 0054).
export const POST = authed(async ({ request, supabase }) => {
  const body = await readJson(request);
  const input = parseScheduleInput(body);
  if (!input) return NextResponse.json({ message: invalidBody }, { status: 422 });
  const kind = parseWith(z.object({ kind: z.enum(["DAILY", "COMPANY"]) }), body)?.kind ?? "DAILY";

  const { data, error } =
    kind === "COMPANY"
      ? await supabase.rpc("create_company_trip", {
          p_schedule_date: input.date,
          p_plate: input.plate,
          p_request_ids: input.requestIds,
          p_legs: input.legs,
        })
      : await supabase.rpc("save_schedule_draft", {
          p_schedule_id: null,
          p_expected_row_version: null,
          p_schedule_date: input.date,
          p_plate: input.plate,
          p_request_ids: input.requestIds,
          p_legs: input.legs,
        });
  if (error || !data) return scheduleErrorResponse(error ?? { message: "" }, "Could not save the draft.");

  return NextResponse.json(await loadSchedule(supabase, data.schedule_id), { status: 201 });
});
