import { NextResponse } from "next/server";
import { authed, unprocessable } from "@/lib/api-route";
import { testPushMessage } from "@/lib/push-message";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pushConfigured, sendToAccount } from "@/lib/supabase/push";

// "Send a test" in the Phone notifications dialog: one push to each of the
// signed-in account's own devices. The service-role client is only so a gone
// device can be forgotten; the account is the signed-in one, never the body's.
export const POST = authed(async ({ account }) => {
  if (!pushConfigured()) return unprocessable("Phone notifications aren't set up for KOVA yet.");

  const result = await sendToAccount(createSupabaseAdminClient(), account.id, testPushMessage).catch(() => null);
  if (!result) return NextResponse.json({ message: "Could not send the test." }, { status: 500 });
  if (!result.sent) return unprocessable("None of your devices could be reached. Turn notifications off and on again.");

  return NextResponse.json(result);
});
