import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/session";
import { toBooking } from "@/lib/supabase/mappers";

function errorResponse(error: { code?: string; message: string }, action: "update" | "cancel") {
  if (error.code === "42501") return NextResponse.json({ message: `Not authorized to ${action} this booking.` }, { status: 403 });
  if (error.code === "P0002") return NextResponse.json({ message: "Booking not found." }, { status: 404 });
  if (error.code === "23505") return NextResponse.json({ message: "This vehicle or driver is already booked for that time." }, { status: 409 });
  return NextResponse.json({ message: error.message || `Could not ${action} the booking.` }, { status: 422 });
}

export async function PUT(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const date = typeof body?.date === "string" ? body.date : "";
  const plate = typeof body?.plate === "string" ? body.plate : "";
  const start = Number(body?.start);
  const end = Number(body?.end);
  const driverId = typeof body?.driverId === "string" ? body.driverId : "";
  const destination = typeof body?.destination === "string" ? body.destination : "";
  const purpose = typeof body?.purpose === "string" ? body.purpose : "";
  const notes = typeof body?.notes === "string" ? body.notes : "";
  const bookingType = typeof body?.bookingType === "string" ? body.bookingType : "";
  const urgentReason = typeof body?.urgentReason === "string" ? body.urgentReason : "";
  if (
    !date || !plate || !driverId || !destination || !purpose ||
    !Number.isInteger(start) || !Number.isInteger(end) ||
    !["REGULAR", "URGENT"].includes(bookingType)
  ) {
    return NextResponse.json({ message: "Date, plate, driver, time range, destination, purpose, and booking type are required." }, { status: 422 });
  }

  const { data, error } = await supabase.rpc("update_booking", {
    p_booking_id: bookingId,
    p_date: date,
    p_plate: plate,
    p_start: start,
    p_end: end,
    p_driver_id: driverId,
    p_destination: destination,
    p_purpose: purpose,
    p_notes: notes,
    p_booking_type: bookingType,
    p_urgent_reason: urgentReason,
  });
  if (error || !data) return errorResponse(error ?? { message: "Could not update the booking." }, "update");

  return NextResponse.json(toBooking(data));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const { error } = await supabase.rpc("cancel_booking", { p_booking_id: bookingId });
  if (error) return errorResponse(error, "cancel");

  return new Response(null, { status: 204 });
}
