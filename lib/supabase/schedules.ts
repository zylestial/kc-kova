import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { liveRevisionStatuses, scheduleSelect, toSchedule } from "@/lib/supabase/mappers";

/**
 * Maps a schedule RPC error to an HTTP response. Stale saves (PT409) and
 * lost races for a request or a time slot (23505 / 23P01) are conflicts:
 * the caller should reload and try again.
 */
export function scheduleErrorResponse(error: { code?: string; message: string }, fallback: string) {
  if (error.code === "42501") return NextResponse.json({ message: error.message || "Not authorized." }, { status: 403 });
  if (error.code === "P0002") return NextResponse.json({ message: "Schedule not found." }, { status: 404 });
  if (error.code === "PT409" || error.code === "23505" || error.code === "23P01") {
    return NextResponse.json({ message: error.message }, { status: 409 });
  }
  return NextResponse.json({ message: error.message || fallback }, { status: 422 });
}

/** Reloads one schedule with its live versions, as the caller may see it. */
export async function loadSchedule(supabase: SupabaseClient, scheduleId: string) {
  const { data } = await supabase
    .from("schedules")
    .select(scheduleSelect)
    .eq("id", scheduleId)
    .in("schedule_revisions.status", liveRevisionStatuses)
    .maybeSingle();
  return data ? toSchedule(data) : null;
}
