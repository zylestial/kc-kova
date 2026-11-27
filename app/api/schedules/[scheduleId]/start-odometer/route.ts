import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { parseStartOdometerInput } from "@/lib/attendance-input";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// The starting odometer, entered after Start trip on a Daily or Company trip
// (set_start_odometer, 0090). A reading saved on the phone without signal
// comes later with its tappedAt, which isn't needed: the reading is the same.
export const POST = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const input = parseStartOdometerInput(await readJson(request));
  if (!input) return NextResponse.json({ message: "Enter the odometer reading in whole kilometres." }, { status: 422 });

  const { data, error } = await supabase.rpc("set_start_odometer", { p_schedule_id: scheduleId, p_odometer: input.odometer });
  if (error) return scheduleErrorResponse(error, "Could not save the odometer reading.", error.message);

  return NextResponse.json({ startOdometer: data });
});
