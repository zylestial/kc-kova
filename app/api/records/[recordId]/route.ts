import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAccount } from "@/lib/supabase/session";
import { toVehicleRecord } from "@/lib/supabase/mappers";
import { canFinishTrip, diffFields, isAnonangRoundTrip, omit, stripAdminOnlyFields } from "@/lib/supabase/records";
import type { HistoryEntry } from "@/lib/kova-api";

// vehicle_records grants no direct write policies (see 0001_init.sql); this
// route is the only write path, so every permission and business rule the
// database would otherwise enforce is checked here before using the
// service-role client for the actual read/write.
export async function PUT(request: Request, { params }: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await params;
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  if (account.role === "Booker") return NextResponse.json({ message: "Not authorized to edit trip records." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const date = typeof body?.date === "string" ? body.date : "";
  const plate = typeof body?.plate === "string" ? body.plate : "";
  const bookingId = typeof body?.bookingId === "string" ? body.bookingId : "";
  if (!date || !plate) return NextResponse.json({ message: "Date and plate are required." }, { status: 422 });

  const admin = createSupabaseAdminClient();
  const { data: byId } = await admin.from("vehicle_records").select("*").eq("id", recordId).maybeSingle();
  const { data: byKey } = byId ? { data: null } : await admin.from("vehicle_records").select("*").eq("date", date).eq("plate", plate).maybeSingle();
  const existing = byId ?? byKey ?? null;
  const existingData = (existing?.data ?? {}) as Record<string, unknown>;

  const incoming = omit(body, ["id", "date", "plate"]);
  let nextData: Record<string, unknown>;

  if (account.role === "Driver") {
    if (existingData.submittedAt) {
      return NextResponse.json({ message: "This trip has already been submitted and is locked." }, { status: 403 });
    }
    if (!bookingId) return NextResponse.json({ message: "A linked booking is required." }, { status: 422 });
    const { data: booking } = await admin.from("bookings").select("*").eq("id", bookingId).maybeSingle();
    if (!booking || booking.driver_id !== account.id) {
      return NextResponse.json({ message: "Not authorized to edit this trip record." }, { status: 403 });
    }

    const cleaned = stripAdminOnlyFields(incoming);
    const wantsSubmit = incoming.status === "SUBMITTED FOR REVIEW";
    if (wantsSubmit) {
      const start = Number(cleaned.start);
      const end = Number(cleaned.end);
      if (booking.status !== "SCHEDULED" || !canFinishTrip(booking.date, booking.end_hour)) {
        return NextResponse.json({ message: "This trip is not available for submission." }, { status: 422 });
      }
      if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end < start) {
        return NextResponse.json({ message: "Enter valid starting and ending odometer readings." }, { status: 422 });
      }
      if (!isAnonangRoundTrip(cleaned.legs)) {
        return NextResponse.json({ message: "The trip must start and end at ANONANG." }, { status: 422 });
      }
      nextData = { ...existingData, ...cleaned, status: "SUBMITTED FOR REVIEW", submittedAt: new Date().toISOString() };
    } else {
      const draft = omit(cleaned, ["submittedAt"]);
      nextData = { ...existingData, ...draft, status: cleaned.status === "DONE" ? existingData.status : (cleaned.status ?? existingData.status ?? "Scheduled") };
    }
  } else {
    // Admin, reviewing or finalizing an already-submitted record.
    if (!existing) return NextResponse.json({ message: "Record not found." }, { status: 404 });
    if (existingData.status === "DONE") {
      return NextResponse.json({ message: "This record has been marked done and is locked." }, { status: 403 });
    }
    const wantsDone = incoming.status === "DONE";
    if (wantsDone && existingData.status !== "SUBMITTED FOR REVIEW") {
      return NextResponse.json({ message: "Only a submitted trip can be marked done." }, { status: 422 });
    }

    const merged = { ...existingData, ...incoming, status: wantsDone ? "DONE" : (incoming.status ?? existingData.status) };
    const changes = diffFields(
      Object.fromEntries(Object.entries(existingData).filter(([key]) => key !== "history")),
      Object.fromEntries(Object.entries(merged).filter(([key]) => key !== "history")),
    );
    const history = Array.isArray(existingData.history) ? [...(existingData.history as HistoryEntry[])] : [];
    if (changes.length > 0 || wantsDone) {
      history.push({
        adminId: account.id,
        adminName: account.name,
        action: wantsDone ? "MARK AS DONE" : "EDIT",
        recordId: existing.id,
        timestamp: new Date().toISOString(),
        changes,
      });
    }
    nextData = { ...merged, history };
  }

  const canonicalId = existing?.id ?? recordId;
  const { data: saved, error } = existing
    ? await admin.from("vehicle_records").update({ date, plate, data: nextData }).eq("id", canonicalId).select("*").single()
    : await admin.from("vehicle_records").insert({ id: canonicalId, date, plate, data: nextData }).select("*").single();

  if (error || !saved) {
    const isDuplicate = error?.code === "23505";
    return NextResponse.json({ message: isDuplicate ? "A record for this vehicle and date already exists." : "Could not save the record." }, { status: isDuplicate ? 409 : 422 });
  }

  return NextResponse.json(toVehicleRecord(saved));
}
