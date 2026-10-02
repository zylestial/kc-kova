import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { toNotification } from "@/lib/supabase/mappers";

// RLS scopes this to the signed-in account's own notifications (0035), same
// as every other read in this app.
export const GET = authed(async ({ supabase }) => {
  const { data, error } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ message: "Could not load notifications." }, { status: 500 });

  return NextResponse.json((data ?? []).map(toNotification));
});
