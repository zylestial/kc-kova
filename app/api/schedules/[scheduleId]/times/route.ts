import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { parseTripTimeInput } from "@/lib/attendance-input";
import { toTripTimeCorrection } from "@/lib/supabase/mappers";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// An Admin fills in or corrects one leg's Time Out / Time In on a submitted
// trip (a null time clears their entry, leaving the Driver's tap). Who may,
// and on which trips, is enforced by set_trip_time.
export const PUT = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const input = parseTripTimeInput(await readJson(request));
  if (!input) {
    return NextResponse.json({ message: "Enter the time as hours and minutes." }, { status: 422 });
  }

  const { data, error } = await supabase.rpc("set_trip_time", {
    p_schedule_id: scheduleId,
    p_leg_id: input.legId,
    p_field: input.field,
    p_time: input.time,
  });
  if (error) return scheduleErrorResponse(error, "Could not save the time.", error.message);

  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json(row ? toTripTimeCorrection(row) : null);
});
