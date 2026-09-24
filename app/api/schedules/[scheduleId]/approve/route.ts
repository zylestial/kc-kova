import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/session";
import { loadSchedule, scheduleErrorResponse } from "@/lib/supabase/schedules";

// Admin approves the submitted version, publishing it. approve_schedule
// rechecks the Trip Record, the Driver, the vehicle and any pending
// cancellations, and refuses a stale version.
export async function POST(request: Request, { params }: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await params;
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const rowVersion = Number(body?.rowVersion);
  if (!Number.isInteger(rowVersion)) return NextResponse.json({ message: "rowVersion is required." }, { status: 422 });

  const { error } = await supabase.rpc("approve_schedule", {
    p_schedule_id: scheduleId,
    p_expected_row_version: rowVersion,
  });
  if (error) return scheduleErrorResponse(error, "Could not approve the schedule.");

  return NextResponse.json(await loadSchedule(supabase, scheduleId));
}
