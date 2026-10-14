import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { REQUEST_SELECT, toTransportRequest } from "@/lib/supabase/mappers";

/** The response for a refused create_request_group / update_request_group. */
export function requestGroupError(error: { code?: string; message: string } | null, fallback: string) {
  if (error?.code === "42501") return NextResponse.json({ message: "Not authorized to make this request." }, { status: 403 });
  if (error?.code === "P0002") return NextResponse.json({ message: "Request not found." }, { status: 404 });
  if (error?.code === "PT409") return NextResponse.json({ message: error.message }, { status: 409 });
  return NextResponse.json({ message: error?.message || fallback }, { status: 422 });
}

/** A group's stops, A first, each with its group; a fresh save's stops all start Not yet scheduled. */
export async function groupStopsResponse(supabase: SupabaseClient, groupId: string, status: number) {
  const { data, error } = await supabase
    .from("requests")
    .select(REQUEST_SELECT)
    .eq("group_id", groupId)
    .eq("request_destinations.active", true)
    .order("stop_letter");
  if (error) return NextResponse.json({ message: "Saved, but the request could not be reloaded." }, { status: 500 });
  return NextResponse.json((data ?? []).map((row) => toTransportRequest(row)), { status });
}
