import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/session";
import { notificationErrorResponse } from "@/lib/supabase/notifications";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const { error } = await supabase.rpc("mark_notification_read", { p_id: id });
  if (error) return notificationErrorResponse(error, "Could not mark the notification as read.");

  return new NextResponse(null, { status: 204 });
}
