import { NextResponse } from "next/server";
import { parseHandleProblemInput } from "@/lib/completion-input";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toProblemReport } from "@/lib/supabase/mappers";
import { requireAccount } from "@/lib/supabase/session";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// An Admin marks a problem report handled, with a note and optionally the
// schedule that follows up on it. Repeating returns the handled report.
export async function POST(request: Request, { params }: { params: Promise<{ problemId: string }> }) {
  const { problemId } = await params;
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const input = parseHandleProblemInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ message: "Describe how the problem was handled." }, { status: 422 });

  const { data, error } = await supabase.rpc("handle_problem", {
    p_problem_id: problemId,
    p_handling_note: input.handlingNote,
    p_follow_up_schedule_id: input.followUpScheduleId,
  });
  if (error) return scheduleErrorResponse(error, "Could not mark the problem as handled.", error.message);

  return NextResponse.json(toProblemReport(data));
}
