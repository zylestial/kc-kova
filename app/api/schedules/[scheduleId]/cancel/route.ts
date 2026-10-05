import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { loadSchedule, scheduleErrorResponse } from "@/lib/supabase/schedules";
import { parseWith } from "@/lib/validation";

const cancelBody = z.object({ reason: z.string().trim().min(1) });

// Admin cancels a schedule: frees its reservation and returns the requests
// it still needed to Not yet scheduled. A reason is required.
export const POST = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const body = parseWith(cancelBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "Add a reason for cancelling this schedule." }, { status: 422 });

  const { error } = await supabase.rpc("cancel_schedule", { p_schedule_id: scheduleId, p_reason: body.reason });
  if (error) return scheduleErrorResponse(error, "Could not cancel the schedule.");

  return NextResponse.json(await loadSchedule(supabase, scheduleId));
});
