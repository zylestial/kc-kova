import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { parseCompletionInput } from "@/lib/completion-input";
import { toTripCompletion } from "@/lib/supabase/mappers";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// The Driver completes their published schedule with one odometer pair, or
// an Admin acting as Driver (view-as override) on any vehicle's schedule.
// Repeating returns the existing completion.
export const POST = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const input = parseCompletionInput(await readJson(request));
  if (!input) {
    return NextResponse.json({ message: "Enter whole-number odometer readings, with the end no lower than the start." }, { status: 422 });
  }

  const { data, error } = await supabase.rpc("submit_completion", {
    p_schedule_id: scheduleId,
    p_start_odometer: input.startOdometer,
    p_end_odometer: input.endOdometer,
    p_full_tank: input.fullTank,
    p_fleet_card_used: input.fleetCardUsed,
    p_gas_receipt_attached: input.gasReceiptAttached,
  });
  if (error) return scheduleErrorResponse(error, "Could not submit the trip.");

  return NextResponse.json(toTripCompletion(data));
});

// An Admin corrects the odometer pair of a submitted completion. A done
// completion is locked and refused by Postgres.
export const PATCH = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const input = parseCompletionInput(await readJson(request));
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
});
