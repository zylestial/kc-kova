import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { parseProblemNote } from "@/lib/completion-input";
import { toProblemReport } from "@/lib/supabase/mappers";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// The Driver reports a problem with their published schedule, or an Admin
// acting as Driver (view-as override) on any vehicle's schedule. Doesn't
// complete the trip; more than one report is allowed.
export const POST = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const note = parseProblemNote(await readJson(request));
  if (!note) return NextResponse.json({ message: "Describe the problem." }, { status: 422 });

  const { data, error } = await supabase.rpc("report_problem", { p_schedule_id: scheduleId, p_note: note });
  if (error) return scheduleErrorResponse(error, "Could not report the problem.");

  return NextResponse.json(toProblemReport(data), { status: 201 });
});
