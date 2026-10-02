import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";

export const POST = authed(async ({ supabase }) => {
  const { error } = await supabase.rpc("mark_all_notifications_read");
  if (error) return NextResponse.json({ message: "Could not mark notifications as read." }, { status: 422 });

  return new NextResponse(null, { status: 204 });
});
