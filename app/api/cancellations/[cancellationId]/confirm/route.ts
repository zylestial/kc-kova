import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/session";
import { toCancellationRequest } from "@/lib/supabase/mappers";
import { cancellationErrorResponse } from "@/lib/supabase/cancellations";

// Admin confirms: cancels only that request. The schedule then needs a new
// version without it, unless nothing else was left in it.
export async function POST(_request: Request, { params }: { params: Promise<{ cancellationId: string }> }) {
  const { cancellationId } = await params;
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const { data, error } = await supabase.rpc("confirm_cancellation", { p_cancellation_id: cancellationId });
  if (error || !data) return cancellationErrorResponse(error ?? { message: "Could not confirm the cancellation." }, "Could not confirm the cancellation.");
  return NextResponse.json(toCancellationRequest(data));
}
