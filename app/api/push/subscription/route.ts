import { NextResponse } from "next/server";
import { authed, readJson, unprocessable } from "@/lib/api-route";
import { parsePushEndpointInput, parsePushSubscriptionInput } from "@/lib/push-input";

// This device turns phone notifications on for the signed-in account
// (save_push_subscription, 0069), or moves them here from another account.
export const POST = authed(async ({ request, supabase }) => {
  const body = parsePushSubscriptionInput(await readJson(request));
  if (!body) return unprocessable("This browser didn't give KOVA what it needs for notifications.");

  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: body.endpoint,
    p_p256dh: body.p256dh,
    p_auth: body.auth,
    p_user_agent: request.headers.get("user-agent") ?? "",
  });
  if (error) return unprocessable(error.message || "Could not turn on notifications.");

  return new NextResponse(null, { status: 204 });
});

// This device turns them off (remove_push_subscription, 0069).
export const DELETE = authed(async ({ request, supabase }) => {
  const endpoint = parsePushEndpointInput(await readJson(request));
  if (!endpoint) return unprocessable("Could not tell which device to turn off.");

  const { error } = await supabase.rpc("remove_push_subscription", { p_endpoint: endpoint });
  if (error) return unprocessable(error.message || "Could not turn off notifications.");

  return new NextResponse(null, { status: 204 });
});
