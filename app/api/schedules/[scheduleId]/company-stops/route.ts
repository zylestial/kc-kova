import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { parseStopTapInput, tapRpc } from "@/lib/attendance-input";
import { reverseGeocode } from "@/lib/reverse-geocode";
import { toStopTap } from "@/lib/supabase/mappers";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// The requester taps Arrived or Leaving at a stop of their Company trip
// (0055), in route order; the last stop's arrival is End trip instead.
export const POST = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const input = parseStopTapInput(await readJson(request));
  if (!input) {
    return NextResponse.json({ message: "That tap couldn't be read. Try again." }, { status: 422 });
  }

  const address = input.location ? await reverseGeocode(input.location.lat, input.location.lng) : null;
  const { data, error } = await supabase.rpc(
    ...tapRpc(
      "record_company_stop",
      {
        p_schedule_id: scheduleId,
        p_leg_id: input.legId,
        p_kind: input.kind,
        p_lat: input.location?.lat ?? null,
        p_lng: input.location?.lng ?? null,
        p_accuracy_m: input.location?.accuracyM ?? null,
        p_address: address,
      },
      input.tappedAt,
    ),
  );
  if (error) {
    return scheduleErrorResponse(error, input.kind === "ARRIVE" ? "Could not record arriving." : "Could not record leaving.", error.message);
  }

  return NextResponse.json(toStopTap(data));
});
