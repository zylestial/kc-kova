import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { requestGroupError } from "@/lib/supabase/request-groups";
import { parseWith, trimmedText } from "@/lib/validation";

export const POST = authed<{ groupId: string }>(async ({ request, supabase, params: { groupId } }) => {
  const body = parseWith(z.object({ reason: trimmedText.pipe(z.string().max(500)) }), await readJson(request));
  if (!body) return NextResponse.json({ message: "The reason can be at most 500 characters." }, { status: 422 });

  // The requester or an Admin, before the trip starts (0094).
  const { error } = await supabase.rpc("cancel_company_trip", { p_group_id: groupId, p_reason: body.reason });
  if (error) return requestGroupError(error, "Could not cancel the request.");
  return new NextResponse(null, { status: 204 });
});
