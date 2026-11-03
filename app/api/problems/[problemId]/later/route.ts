import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { toProblemReport } from "@/lib/supabase/mappers";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";
import { parseWith } from "@/lib/validation";

const laterBody = z.object({ afterLegId: z.uuid() });

// A Scheduler or Admin sends the Driver on (come_back_later, 0086): the requests
// move to a new stop at the same place, after the stop picked. The Driver is told.
export const POST = authed<{ problemId: string }>(async ({ request, supabase, params: { problemId } }) => {
  const body = parseWith(laterBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "Choose when to come back." }, { status: 422 });

  const { data, error } = await supabase.rpc("come_back_later", { p_problem_id: problemId, p_after_leg_id: body.afterLegId });
  if (error) return scheduleErrorResponse(error, "Could not send the answer.", error.message);

  return NextResponse.json(toProblemReport(data));
});
