import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { parseAttendanceInput, tapRpc } from "@/lib/attendance-input";
import { reverseGeocode } from "@/lib/reverse-geocode";
import { toTripAttendance } from "@/lib/supabase/mappers";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// The Driver taps Start trip or End trip on their published schedule (or an
// Admin acting as Driver), with the phone's position when it shares one.
// The time is the server's, and so is the approximate address, looked up
// here from the position (never taken from the browser). Repeating a tap
// returns the first one.
export const POST = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const input = parseAttendanceInput(await readJson(request));
  if (!input) {
    return NextResponse.json({ message: "That tap couldn't be read. Try again." }, { status: 422 });
  }

  const address = input.location ? await reverseGeocode(input.location.lat, input.location.lng) : null;
  const { data, error } = await supabase.rpc(
    ...tapRpc(
      "record_trip_attendance",
      {
        p_schedule_id: scheduleId,
        p_kind: input.kind,
        p_lat: input.location?.lat ?? null,
        p_lng: input.location?.lng ?? null,
        p_accuracy_m: input.location?.accuracyM ?? null,
        p_address: address,
      },
      input.tappedAt,
    ),
  );
  if (error) return scheduleErrorResponse(error, input.kind === "START" ? "Could not start the trip." : "Could not end the trip.");

  return NextResponse.json(toTripAttendance(data));
});
