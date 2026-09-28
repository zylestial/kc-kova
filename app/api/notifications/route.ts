import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toNotification } from "@/lib/supabase/mappers";
import { requireAccount } from "@/lib/supabase/session";

// RLS scopes this to the signed-in account's own notifications (0035), same
// as every other read in this app.
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const { data, error } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ message: "Could not load notifications." }, { status: 500 });

  return NextResponse.json((data ?? []).map(toNotification));
}
