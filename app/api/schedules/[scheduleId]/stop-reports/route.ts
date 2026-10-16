import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { parseStopReportInput } from "@/lib/stop-report-input";
import { toProblemReport } from "@/lib/supabase/mappers";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// Whoever records a trip on the road reports a problem at one stop
// (report_stop, 0061): Not available or Wrong address misses the stop, a
// blocked road is skipped or waited out, a Vehicle problem pauses the trip.
// Schedulers and Admins are told.
export const POST = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const input = parseStopReportInput(await readJson(request));
  if (!input) {
    return NextResponse.json({ message: "That report couldn't be read. Try again." }, { status: 422 });
  }

  const { data, error } = await supabase.rpc("report_stop", {
    p_schedule_id: scheduleId,
    p_leg_id: input.legId,
    p_kind: input.kind,
    p_note: input.note,
    p_skip: input.skip,
    p_lat: input.location?.lat ?? null,
    p_lng: input.location?.lng ?? null,
    p_accuracy_m: input.location?.accuracyM ?? null,
  });
  if (error) return scheduleErrorResponse(error, "Could not send the report.", error.message);

  return NextResponse.json(toProblemReport(data));
});
