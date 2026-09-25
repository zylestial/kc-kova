import { NextResponse } from "next/server";
import { parseProblemNote } from "@/lib/completion-input";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toProblemReport } from "@/lib/supabase/mappers";
import { requireAccount } from "@/lib/supabase/session";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// The Driver reports a problem with their published schedule. Doesn't
// complete the trip; more than one report is allowed.
export async function POST(request: Request, { params }: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await params;
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const note = parseProblemNote(await request.json().catch(() => null));
  if (!note) return NextResponse.json({ message: "Describe the problem." }, { status: 422 });

  const { data, error } = await supabase.rpc("report_problem", { p_schedule_id: scheduleId, p_note: note });
  if (error) return scheduleErrorResponse(error, "Could not report the problem.");

  return NextResponse.json(toProblemReport(data), { status: 201 });
}
