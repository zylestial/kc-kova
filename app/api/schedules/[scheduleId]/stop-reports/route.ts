import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { parseStopReportInput } from "@/lib/stop-report-input";
import { toProblemReport } from "@/lib/supabase/mappers";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// Whoever records a trip on the road reports a problem at one stop
// (report_stop, 0061). The trip is held until a Scheduler or Admin answers
// (0068); they are told.
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
    p_lat: input.location?.lat ?? null,
    p_lng: input.location?.lng ?? null,
    p_accuracy_m: input.location?.accuracyM ?? null,
    p_request_ids: input.requestIds ?? null,
  });
  if (error) return scheduleErrorResponse(error, "Could not send the report.", error.message);

  return NextResponse.json(toProblemReport(data));
});
