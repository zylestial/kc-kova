import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";
import { parseWith, trimmedText } from "@/lib/validation";

const missedBody = z.object({
  sendBack: z.boolean(),
  reason: trimmedText,
});

// A Scheduler takes a missed stop's requests off its trip (release_missed_stop,
// 0063) to plan them again, or to send them back to the requester. Returns
// the requests' ids.
export const POST = authed<{ problemId: string }>(async ({ request, supabase, params: { problemId } }) => {
  const body = parseWith(missedBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "Choose what to do with the missed stop." }, { status: 422 });

  const { data, error } = await supabase.rpc("release_missed_stop", {
    p_problem_id: problemId,
    p_send_back: body.sendBack,
    p_reason: body.reason,
  });
  if (error) return scheduleErrorResponse(error, "Could not take the missed stop off the trip.", error.message);

  return NextResponse.json({ requestIds: ((data ?? []) as Array<{ id: string }>).map((row) => row.id) });
});
