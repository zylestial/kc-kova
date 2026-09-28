import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/session";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const { error } = await supabase.rpc("mark_all_notifications_read");
  if (error) return NextResponse.json({ message: "Could not mark notifications as read." }, { status: 422 });

  return new NextResponse(null, { status: 204 });
}
