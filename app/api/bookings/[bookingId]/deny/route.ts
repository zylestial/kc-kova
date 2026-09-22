import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/session";
import { toBooking } from "@/lib/supabase/mappers";

function errorResponse(error: { code?: string; message: string }) {
  if (error.code === "42501") return NextResponse.json({ message: "Admin access required." }, { status: 403 });
  if (error.code === "P0002") return NextResponse.json({ message: "Booking not found." }, { status: 404 });
  return NextResponse.json({ message: error.message || "Could not deny the booking." }, { status: 422 });
}

export async function POST(_request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const { data, error } = await supabase.rpc("deny_booking", { p_booking_id: bookingId });
  if (error || !data) return errorResponse(error ?? { message: "Could not deny the booking." });

  return NextResponse.json(toBooking(data));
}
