import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toAccount } from "@/lib/supabase/accounts";
import { requireAccount } from "@/lib/supabase/session";
import {
  liveRevisionStatuses,
  toCancellationRequest,
  toNotification,
  toProblemReport,
  toTripCompletion,
  scheduleSelect,
  toBookingOptions,
  toPerson,
  toSchedule,
  toTransportRequest,
  toVehicle,
} from "@/lib/supabase/mappers";

// Row Level Security already scopes accounts to what the signed-in role may
// see (see supabase/migrations/0001_init.sql), so a plain select here returns
// exactly the right rows for every role. The same holds for requests and
// their progress (0014, 0022), and for schedules (0015): Requesters and
// Drivers see only published versions.
// Discarded schedules and closed versions are left out.
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const [accountsRes, vehiclesRes, optionsRes, peopleRes, requestsRes, progressRes, schedulesRes, cancellationsRes, completionsRes, problemsRes, notificationsRes] = await Promise.all([
    supabase.from("accounts").select("*"),
    supabase.from("vehicles").select("*"),
    supabase.from("booking_options").select("*"),
    supabase.from("people").select("*"),
    supabase.from("requests").select("*, request_destinations(*)").eq("request_destinations.active", true),
    supabase.from("request_progress").select("*"),
    supabase
      .from("schedules")
      .select(scheduleSelect)
      .neq("status", "DISCARDED")
      .in("schedule_revisions.status", liveRevisionStatuses),
    supabase.from("request_cancellations").select("*"),
    supabase.from("trip_completions").select("*"),
    supabase.from("problem_reports").select("*"),
    supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(50),
  ]);

  const firstError = [accountsRes, vehiclesRes, optionsRes, peopleRes, requestsRes, progressRes, schedulesRes, cancellationsRes, completionsRes, problemsRes, notificationsRes].find((res) => res.error)?.error;
  if (firstError) {
    return NextResponse.json({ message: "Could not load application data." }, { status: 500 });
  }

  const progressById = new Map((progressRes.data ?? []).map((row) => [row.request_id, row]));

  return NextResponse.json({
    accounts: (accountsRes.data ?? []).map(toAccount),
    vehicles: (vehiclesRes.data ?? []).map(toVehicle),
    options: toBookingOptions(optionsRes.data ?? []),
    people: (peopleRes.data ?? []).map(toPerson),
    requests: (requestsRes.data ?? []).map((row) => toTransportRequest(row, progressById.get(row.id))),
    schedules: (schedulesRes.data ?? []).map(toSchedule),
    // Requesters get their own asks, Admin all of them (0014 policy).
    cancellations: (cancellationsRes.data ?? []).map(toCancellationRequest),
    // A Driver gets their own; Admin all (0017 policies).
    completions: (completionsRes.data ?? []).map(toTripCompletion),
    problems: (problemsRes.data ?? []).map(toProblemReport),
    notifications: (notificationsRes.data ?? []).map(toNotification),
  });
}
