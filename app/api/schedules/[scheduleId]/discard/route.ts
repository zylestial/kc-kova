import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/session";
import { loadSchedule, scheduleErrorResponse } from "@/lib/supabase/schedules";

// Throws away an unsubmitted draft: frees its reservation and returns its
// requests to Not yet scheduled, unlocked. Not a cancellation (Phase 7).
export async function POST(request: Request, { params }: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await params;
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const rowVersion = Number(body?.rowVersion);
  if (!Number.isInteger(rowVersion)) return NextResponse.json({ message: "rowVersion is required." }, { status: 422 });

  const { error } = await supabase.rpc("discard_schedule_draft", {
    p_schedule_id: scheduleId,
    p_expected_row_version: rowVersion,
  });
  if (error) return scheduleErrorResponse(error, "Could not discard the draft.");

  return NextResponse.json(await loadSchedule(supabase, scheduleId));
}
