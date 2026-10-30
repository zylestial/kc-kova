import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";

// The signed-in account closed the welcome tour (0084), so it stops
// opening by itself, on every device.
export const POST = authed(async ({ supabase }) => {
  const { error } = await supabase.rpc("mark_tour_seen");
  if (error) return NextResponse.json({ message: "Could not save that you've seen the tour." }, { status: 422 });

  return new NextResponse(null, { status: 204 });
});
