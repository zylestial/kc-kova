import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/session";
import { loadSchedule, scheduleErrorResponse } from "@/lib/supabase/schedules";
import { parseScheduleInput } from "@/lib/schedule-input";

const invalidBody = "Date, vehicle, requests and legs are required.";

// Creates a schedule as a first draft. save_schedule_draft allows this for
// a Scheduler, or an Admin acting as Scheduler (view-as override); anyone
// else gets 403.
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const input = parseScheduleInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ message: invalidBody }, { status: 422 });

  const { data, error } = await supabase.rpc("save_schedule_draft", {
    p_schedule_id: null,
    p_expected_row_version: null,
    p_schedule_date: input.date,
    p_plate: input.plate,
    p_request_ids: input.requestIds,
    p_legs: input.legs,
  });
  if (error || !data) return scheduleErrorResponse(error ?? { message: "" }, "Could not save the draft.");

  return NextResponse.json(await loadSchedule(supabase, data.schedule_id), { status: 201 });
}
