import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { parseCompanyRunInput, tapRpc } from "@/lib/attendance-input";
import { reverseGeocode } from "@/lib/reverse-geocode";
import { toCompanyTripRun } from "@/lib/supabase/mappers";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// The requester taps Start trip or End trip on their approved Company trip,
// with the odometer reading (0055). As for a Driver's taps, the time and the
// approximate address are the server's, and a repeat returns the first.
// End trip submits the trip.
export const POST = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const input = parseCompanyRunInput(await readJson(request));
  if (!input) {
    return NextResponse.json({ message: "Enter the odometer reading in whole kilometres." }, { status: 422 });
  }

  const address = input.location ? await reverseGeocode(input.location.lat, input.location.lng) : null;
  const { data, error } = await supabase.rpc(
    ...tapRpc(
      input.kind === "START" ? "start_company_trip" : "end_company_trip",
      {
        p_schedule_id: scheduleId,
        p_odometer: input.odometer,
        p_lat: input.location?.lat ?? null,
        p_lng: input.location?.lng ?? null,
        p_accuracy_m: input.location?.accuracyM ?? null,
        p_address: address,
      },
      input.tappedAt,
    ),
  );
  if (error) {
    return scheduleErrorResponse(error, input.kind === "START" ? "Could not start the trip." : "Could not end the trip.", error.message);
  }

  return NextResponse.json(toCompanyTripRun(data));
});
