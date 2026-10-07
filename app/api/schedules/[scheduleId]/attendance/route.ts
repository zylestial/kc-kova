import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { parseAttendanceInput } from "@/lib/attendance-input";
import { toTripAttendance } from "@/lib/supabase/mappers";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// The Driver taps Start trip or End trip on their published schedule (or an
// Admin acting as Driver), with the phone's position when it shares one.
// The time is the server's. Repeating a tap returns the first one.
export const POST = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const input = parseAttendanceInput(await readJson(request));
  if (!input) {
    return NextResponse.json({ message: "That tap couldn't be read. Try again." }, { status: 422 });
  }

  const { data, error } = await supabase.rpc("record_trip_attendance", {
    p_schedule_id: scheduleId,
    p_kind: input.kind,
    p_lat: input.location?.lat ?? null,
    p_lng: input.location?.lng ?? null,
    p_accuracy_m: input.location?.accuracyM ?? null,
  });
  if (error) return scheduleErrorResponse(error, input.kind === "START" ? "Could not start the trip." : "Could not end the trip.");

  return NextResponse.json(toTripAttendance(data));
});
