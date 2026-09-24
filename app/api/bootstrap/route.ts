import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toAccount } from "@/lib/supabase/accounts";
import { requireAccount } from "@/lib/supabase/session";
import { toBooking, toBookingOptions, toPerson, toTransportRequest, toVehicle, toVehicleRecord } from "@/lib/supabase/mappers";

// Row Level Security already scopes bookings/vehicle_records/accounts to
// what the signed-in role may see (see supabase/migrations/0001_init.sql),
// so a plain select here returns exactly the right rows for every role.
// The same holds for v2 requests and their progress (0014, 0022).
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const [accountsRes, vehiclesRes, bookingsRes, recordsRes, optionsRes, peopleRes, requestsRes, progressRes] = await Promise.all([
    supabase.from("accounts").select("*"),
    supabase.from("vehicles").select("*"),
    supabase.from("bookings").select("*"),
    supabase.from("vehicle_records").select("*"),
    supabase.from("booking_options").select("*"),
    supabase.from("people").select("*"),
    supabase.from("requests").select("*, request_destinations(*)").eq("request_destinations.active", true),
    supabase.from("request_progress").select("*"),
  ]);

  const firstError = [accountsRes, vehiclesRes, bookingsRes, recordsRes, optionsRes, peopleRes, requestsRes, progressRes].find((res) => res.error)?.error;
  if (firstError) {
    return NextResponse.json({ message: "Could not load application data." }, { status: 500 });
  }

  const progressById = new Map((progressRes.data ?? []).map((row) => [row.request_id, row]));

  return NextResponse.json({
    accounts: (accountsRes.data ?? []).map(toAccount),
    vehicles: (vehiclesRes.data ?? []).map(toVehicle),
    bookings: (bookingsRes.data ?? []).map(toBooking),
    records: (recordsRes.data ?? []).map(toVehicleRecord),
    options: toBookingOptions(optionsRes.data ?? []),
    people: (peopleRes.data ?? []).map(toPerson),
    requests: (requestsRes.data ?? []).map((row) => toTransportRequest(row, progressById.get(row.id))),
  });
}
