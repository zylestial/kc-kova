import { NextResponse } from "next/server";
import { authed, readJson, unprocessable } from "@/lib/api-route";
import { parsePushEndpointInput } from "@/lib/push-input";

// On signing out: this device stops getting the account's phone
// notifications until it signs in again (pause_push_subscription, 0071).
export const POST = authed(async ({ request, supabase }) => {
  const endpoint = parsePushEndpointInput(await readJson(request));
  if (!endpoint) return unprocessable("Could not tell which device to pause.");

  const { error } = await supabase.rpc("pause_push_subscription", { p_endpoint: endpoint });
  if (error) return unprocessable(error.message || "Could not pause notifications.");

  return new NextResponse(null, { status: 204 });
});
