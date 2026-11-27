import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import type { CompanyTripBooking } from "@/lib/kova-api";

type BusyRow = { schedule_id: string; plate: string; owner_name: string; starts_at: string; ends_at: string; account_ids: string[] };

/** The Company trips booked on a date, for the request form (0094 company_trip_busy). */
export const GET = authed(async ({ request, supabase }) => {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? "";
  const except = url.searchParams.get("except");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ message: "Choose a date." }, { status: 422 });
  if (except && !/^[0-9a-f-]{36}$/i.test(except)) return NextResponse.json({ message: "Request not found." }, { status: 404 });

  const { data, error } = await supabase.rpc("company_trip_busy", { p_date: date, p_except_group: except || null });
  if (error?.code === "42501") return NextResponse.json({ message: "Not authorized." }, { status: 403 });
  if (error) return NextResponse.json({ message: "Could not load the day's trips." }, { status: 500 });
  const bookings: CompanyTripBooking[] = ((data ?? []) as BusyRow[]).map((row) => ({
    scheduleId: row.schedule_id,
    plate: row.plate,
    ownerName: row.owner_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    accountIds: row.account_ids ?? [],
  }));
  return NextResponse.json(bookings);
});
