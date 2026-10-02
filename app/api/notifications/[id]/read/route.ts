import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { notificationErrorResponse } from "@/lib/supabase/notifications";

export const POST = authed<{ id: string }>(async ({ supabase, params: { id } }) => {
  const { error } = await supabase.rpc("mark_notification_read", { p_id: id });
  if (error) return notificationErrorResponse(error, "Could not mark the notification as read.");

  return new NextResponse(null, { status: 204 });
});
