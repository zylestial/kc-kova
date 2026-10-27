import { NextResponse } from "next/server";
import { authed, readJson, unprocessable } from "@/lib/api-route";
import { parsePushEndpointInput } from "@/lib/push-input";
import { testPushMessage } from "@/lib/push-message";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PUSH_TEST_LIMIT, takeAttempts } from "@/lib/supabase/login-rate-limit";
import { pushConfigured, sendToDevice } from "@/lib/supabase/push";

// "Send a test" in the Push notifications dialog: one push to the device that
// asked, and only if it's one of the signed-in account's own. The
// service-role client is only so a gone device can be forgotten. At most
// PUSH_TEST_LIMIT tests an hour per account.
export const POST = authed(async ({ request, account }) => {
  if (!pushConfigured()) return unprocessable("Push notifications aren't set up for KOVA yet.");
  const endpoint = parsePushEndpointInput(await readJson(request));
  if (!endpoint) return unprocessable("Could not tell which device to test. Turn notifications off and on again.");
  if (!(await takeAttempts(`push-test:${account.id}`, PUSH_TEST_LIMIT)).ok) {
    return NextResponse.json({ message: "Too many tests. Try again in an hour." }, { status: 429 });
  }

  const result = await sendToDevice(createSupabaseAdminClient(), account.id, endpoint, testPushMessage).catch(() => null);
  if (!result) return NextResponse.json({ message: "Could not send the test." }, { status: 500 });
  if (!result.sent) return unprocessable("This device couldn't be reached. Turn notifications off and on again.");

  return NextResponse.json(result);
});
