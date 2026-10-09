import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { parseStopTapInput } from "@/lib/attendance-input";
import { reverseGeocode } from "@/lib/reverse-geocode";
import { toStopTap } from "@/lib/supabase/mappers";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// The Driver taps Arrived or Leaving at one leg's destination (or an Admin
// acting as Driver), with the phone's position when it shares one. Same as
// Start/End: the time and the approximate address are the server's, and a
// repeat returns the first tap.
export const POST = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const input = parseStopTapInput(await readJson(request));
  if (!input) {
    return NextResponse.json({ message: "That tap couldn't be read. Try again." }, { status: 422 });
  }

  const address = input.location ? await reverseGeocode(input.location.lat, input.location.lng) : null;
  const { data, error } = await supabase.rpc("record_stop_tap", {
    p_schedule_id: scheduleId,
    p_leg_id: input.legId,
    p_kind: input.kind,
    p_lat: input.location?.lat ?? null,
    p_lng: input.location?.lng ?? null,
    p_accuracy_m: input.location?.accuracyM ?? null,
    p_address: address,
  });
  if (error) return scheduleErrorResponse(error, input.kind === "ARRIVE" ? "Could not record arriving." : "Could not record leaving.");

  return NextResponse.json(toStopTap(data));
});
