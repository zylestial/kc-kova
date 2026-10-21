import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { toAccount } from "@/lib/supabase/accounts";
import { parseSince } from "@/lib/bootstrap-window";
import { allRows } from "@/lib/supabase/all-rows";
import {
  liveRevisionStatuses,
  toCancellationRequest,
  toNotification,
  toProblemReport,
  toStopTap,
  toCompanyTripRun,
  toTripTimeCorrection,
  toTripAttendance,
  toTripCompletion,
  scheduleSelect,
  toBookingOptions,
  toSchedule,
  toTransportRequest,
  REQUEST_SELECT,
  toVehicle,
} from "@/lib/supabase/mappers";

const requestSelect = REQUEST_SELECT;

// Row Level Security already scopes accounts to what the signed-in role may
// see (see supabase/migrations/0001_init.sql), so a plain select here returns
// exactly the right rows for every role. The same holds for requests and
// their progress (0014, 0022), and for schedules (0015): Requesters and
// Drivers see only published versions.
// Discarded schedules and closed versions are left out.
//
// Requests, schedules and what hangs off them load only from `since` on
// (default: the last 90 days, lib/bootstrap-window.ts); the app asks for
// more with ?since=. Anything older that still needs someone is added back
// regardless: a submitted trip nobody has closed, an open problem report
// and a pending cancellation, together with the schedules and requests they
// belong to.
export const GET = authed(async ({ request, supabase }) => {
  const since = parseSince(new URL(request.url).searchParams.get("since"));

  const [
    accountsRes,
    vehiclesRes,
    optionsRes,
    locationsRes,
    requestsRes,
    progressRes,
    schedulesRes,
    cancellationsRes,
    completionsRes,
    attendanceRes,
    stopTapsRes,
    companyRunsRes,
    correctionsRes,
    problemsRes,
    notificationsRes,
    oldCancellationsRes,
    oldCompletionsRes,
    oldProblemsRes,
  ] = await Promise.all([
    allRows((from, to) => supabase.from("accounts").select("*").order("id").range(from, to)),
    allRows((from, to) => supabase.from("vehicles").select("*").order("plate").range(from, to)),
    allRows((from, to) => supabase.from("booking_options").select("*").order("group").order("id").range(from, to)),
    allRows((from, to) =>
      supabase
        .from("destination_locations")
        .select("destination_id, lat, lng")
        .order("destination_group")
        .order("destination_id")
        .range(from, to),
    ),
    allRows((from, to) =>
      supabase
        .from("requests")
        .select(requestSelect)
        .eq("request_destinations.active", true)
        .gte("requested_date", since)
        .order("id")
        .range(from, to),
    ),
    allRows((from, to) =>
      supabase.from("request_progress").select("*").gte("requested_date", since).order("request_id").range(from, to),
    ),
    allRows((from, to) =>
      supabase
        .from("schedules")
        .select(scheduleSelect)
        .neq("status", "DISCARDED")
        .in("schedule_revisions.status", liveRevisionStatuses)
        .gte("schedule_date", since)
        .order("id")
        .range(from, to),
    ),
    allRows((from, to) =>
      supabase
        .from("request_cancellations")
        .select("*, requests!request_cancellations_request_id_fkey!inner(requested_date)")
        .gte("requests.requested_date", since)
        .order("id")
        .range(from, to),
    ),
    allRows((from, to) =>
      supabase
        .from("trip_completions")
        .select("*, schedules!trip_completions_schedule_id_fkey!inner(schedule_date)")
        .gte("schedules.schedule_date", since)
        .order("id")
        .range(from, to),
    ),
    allRows((from, to) =>
      supabase
        .from("trip_attendance")
        .select("*, schedules!trip_attendance_schedule_id_fkey!inner(schedule_date)")
        .gte("schedules.schedule_date", since)
        .order("id")
        .range(from, to),
    ),
    allRows((from, to) =>
      supabase
        .from("stop_taps")
        .select("*, schedules!stop_taps_schedule_id_fkey!inner(schedule_date)")
        .gte("schedules.schedule_date", since)
        .order("id")
        .range(from, to),
    ),
    allRows((from, to) =>
      supabase
        .from("company_trip_runs")
        .select("*, schedules!company_trip_runs_schedule_id_fkey!inner(schedule_date)")
        .gte("schedules.schedule_date", since)
        .order("id")
        .range(from, to),
    ),
    allRows((from, to) =>
      supabase
        .from("trip_time_corrections")
        .select("*, schedules!trip_time_corrections_schedule_id_fkey!inner(schedule_date)")
        .gte("schedules.schedule_date", since)
        .order("id")
        .range(from, to),
    ),
    allRows((from, to) =>
      supabase
        .from("problem_reports")
        .select("*, schedules!problem_reports_schedule_id_fkey!inner(schedule_date)")
        .gte("schedules.schedule_date", since)
        .order("id")
        .range(from, to),
    ),
    supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(50),
    allRows((from, to) =>
      supabase
        .from("request_cancellations")
        .select("*, requests!request_cancellations_request_id_fkey!inner(requested_date)")
        .eq("status", "PENDING")
        .lt("requests.requested_date", since)
        .order("id")
        .range(from, to),
    ),
    allRows((from, to) =>
      supabase
        .from("trip_completions")
        .select("*, schedules!trip_completions_schedule_id_fkey!inner(schedule_date)")
        .eq("status", "SUBMITTED")
        .lt("schedules.schedule_date", since)
        .order("id")
        .range(from, to),
    ),
    allRows((from, to) =>
      supabase
        .from("problem_reports")
        .select("*, schedules!problem_reports_schedule_id_fkey!inner(schedule_date)")
        .eq("status", "OPEN")
        .lt("schedules.schedule_date", since)
        .order("id")
        .range(from, to),
    ),
  ]);

  const firstError = [
    accountsRes,
    vehiclesRes,
    optionsRes,
    locationsRes,
    requestsRes,
    progressRes,
    schedulesRes,
    cancellationsRes,
    completionsRes,
    attendanceRes,
    stopTapsRes,
    companyRunsRes,
    correctionsRes,
    problemsRes,
    notificationsRes,
    oldCancellationsRes,
    oldCompletionsRes,
    oldProblemsRes,
  ].find((res) => res.error)?.error;
  if (firstError) {
    return NextResponse.json({ message: "Could not load application data." }, { status: 500 });
  }

  // Older records that still need someone, and the schedules and requests
  // they sit on. These dates are all before `since`, so nothing repeats.
  const oldCancellations = oldCancellationsRes.data ?? [];
  const oldCompletions = oldCompletionsRes.data ?? [];
  const oldProblems = oldProblemsRes.data ?? [];
  const oldScheduleIds = [...new Set([...oldCompletions, ...oldProblems].map((row) => row.schedule_id as string))];
  const oldSchedulesRes = oldScheduleIds.length
    ? await supabase
        .from("schedules")
        .select(scheduleSelect)
        .in("id", oldScheduleIds)
        .neq("status", "DISCARDED")
        .in("schedule_revisions.status", liveRevisionStatuses)
    : { data: [], error: null };
  if (oldSchedulesRes.error) {
    return NextResponse.json({ message: "Could not load application data." }, { status: 500 });
  }
  const oldSchedules = oldSchedulesRes.data ?? [];

  // Their taps and Admin time entries too, so an older trip still under
  // review shows (and prints) its actual times.
  const [oldAttendanceRes, oldStopTapsRes, oldCompanyRunsRes, oldCorrectionsRes] = oldScheduleIds.length
    ? await Promise.all([
        allRows((from, to) => supabase.from("trip_attendance").select("*").in("schedule_id", oldScheduleIds).order("id").range(from, to)),
        allRows((from, to) => supabase.from("stop_taps").select("*").in("schedule_id", oldScheduleIds).order("id").range(from, to)),
        allRows((from, to) => supabase.from("company_trip_runs").select("*").in("schedule_id", oldScheduleIds).order("id").range(from, to)),
        allRows((from, to) =>
          supabase.from("trip_time_corrections").select("*").in("schedule_id", oldScheduleIds).order("id").range(from, to),
        ),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  if (oldAttendanceRes.error || oldStopTapsRes.error || oldCompanyRunsRes.error || oldCorrectionsRes.error) {
    return NextResponse.json({ message: "Could not load application data." }, { status: 500 });
  }

  const loadedRequestIds = new Set((requestsRes.data ?? []).map((row) => row.id as string));
  const oldRequestIds = [
    ...new Set([
      ...oldCancellations.map((row) => row.request_id as string),
      ...oldSchedules.flatMap((row) =>
        (row.schedule_revisions ?? []).flatMap((revision: { revision_requests?: Array<{ request_id: string }> }) =>
          (revision.revision_requests ?? []).map((link) => link.request_id),
        ),
      ),
    ]),
  ].filter((id) => !loadedRequestIds.has(id));
  const [oldRequestsRes, oldProgressRes] = oldRequestIds.length
    ? await Promise.all([
        allRows((from, to) =>
          supabase
            .from("requests")
            .select(requestSelect)
            .eq("request_destinations.active", true)
            .in("id", oldRequestIds)
            .order("id")
            .range(from, to),
        ),
        allRows((from, to) => supabase.from("request_progress").select("*").in("request_id", oldRequestIds).order("request_id").range(from, to)),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (oldRequestsRes.error || oldProgressRes.error) {
    return NextResponse.json({ message: "Could not load application data." }, { status: 500 });
  }

  const progressById = new Map([...(progressRes.data ?? []), ...(oldProgressRes.data ?? [])].map((row) => [row.request_id, row]));

  return NextResponse.json({
    since,
    accounts: (accountsRes.data ?? []).map(toAccount),
    vehicles: (vehiclesRes.data ?? []).map(toVehicle),
    options: toBookingOptions(optionsRes.data ?? [], locationsRes.data ?? []),
    requests: [...(requestsRes.data ?? []), ...(oldRequestsRes.data ?? [])].map((row) =>
      toTransportRequest(row, progressById.get(row.id)),
    ),
    schedules: [...(schedulesRes.data ?? []), ...oldSchedules].map(toSchedule),
    // Requesters get their own asks, Admin all of them (0014 policy).
    cancellations: [...(cancellationsRes.data ?? []), ...oldCancellations].map(toCancellationRequest),
    // A Driver gets their own; Admin all (0017 policies).
    completions: [...(completionsRes.data ?? []), ...oldCompletions].map(toTripCompletion),
    // Same visibility as completions (0042 policy).
    attendance: [...(attendanceRes.data ?? []), ...(oldAttendanceRes.data ?? [])].map(toTripAttendance),
    // Same visibility as attendance (0045 policy).
    stopTaps: [...(stopTapsRes.data ?? []), ...(oldStopTapsRes.data ?? [])].map(toStopTap),
    // Whoever can see the Company trip (0055 policy).
    companyRuns: [...(companyRunsRes.data ?? []), ...(oldCompanyRunsRes.data ?? [])].map(toCompanyTripRun),
    // Admin all; a Driver those on their own trips (0046 policy).
    timeCorrections: [...(correctionsRes.data ?? []), ...(oldCorrectionsRes.data ?? [])].map(toTripTimeCorrection),
    problems: [...(problemsRes.data ?? []), ...oldProblems].map(toProblemReport),
    notifications: (notificationsRes.data ?? []).map(toNotification),
  });
});
