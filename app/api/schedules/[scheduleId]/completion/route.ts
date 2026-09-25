import { NextResponse } from "next/server";
import { parseCompletionInput } from "@/lib/completion-input";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toTripCompletion } from "@/lib/supabase/mappers";
import { requireAccount } from "@/lib/supabase/session";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// The Driver completes their published schedule with one odometer pair.
// Repeating returns the existing completion.
export async function POST(request: Request, { params }: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await params;
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const input = parseCompletionInput(await request.json().catch(() => null));
  if (!input) {
    return NextResponse.json({ message: "Enter whole-number odometer readings, with the end no lower than the start." }, { status: 422 });
  }

  const { data, error } = await supabase.rpc("submit_completion", {
    p_schedule_id: scheduleId,
    p_start_odometer: input.startOdometer,
    p_end_odometer: input.endOdometer,
  });
  if (error) return scheduleErrorResponse(error, "Could not submit the trip.");

  return NextResponse.json(toTripCompletion(data));
}

// An Admin corrects the odometer pair of a submitted completion. A done
// completion is locked and refused by Postgres.
export async function PATCH(request: Request, { params }: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await params;
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const input = parseCompletionInput(await request.json().catch(() => null));
  if (!input) {
    return NextResponse.json({ message: "Enter whole-number odometer readings, with the end no lower than the start." }, { status: 422 });
  }

  const { data, error } = await supabase.rpc("correct_completion", {
    p_schedule_id: scheduleId,
    p_start_odometer: input.startOdometer,
    p_end_odometer: input.endOdometer,
  });
  if (error) return scheduleErrorResponse(error, "Could not correct the trip.", error.message);

  return NextResponse.json(toTripCompletion(data));
}
