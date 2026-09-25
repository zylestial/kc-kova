import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toTripCompletion } from "@/lib/supabase/mappers";
import { requireAccount } from "@/lib/supabase/session";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// An Admin marks a submitted completion done, which locks it for everyone.
// Repeating returns the existing done completion.
export async function POST(_request: Request, { params }: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await params;
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const { data, error } = await supabase.rpc("mark_completion_done", { p_schedule_id: scheduleId });
  if (error) return scheduleErrorResponse(error, "Could not mark the trip as done.", error.message);

  return NextResponse.json(toTripCompletion(data));
}
