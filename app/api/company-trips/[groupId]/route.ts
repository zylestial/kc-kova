import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { parseCompanyTripInput } from "@/lib/company-trip-input";
import { groupStopsResponse, requestGroupError } from "@/lib/supabase/request-groups";
import { parseWith, rowVersionBody } from "@/lib/validation";

export const PUT = authed<{ groupId: string }>(async ({ request, supabase, params: { groupId } }) => {
  const body = await readJson(request);
  const input = parseCompanyTripInput(body);
  const version = parseWith(rowVersionBody, body);
  if (!input || !version) return NextResponse.json({ message: "Choose a date and keep at least one destination." }, { status: 422 });

  // rowVersion is the version the form was opened on; a newer change is
  // refused rather than overwritten. Saving resends it to the Admin.
  const { data, error } = await supabase.rpc("request_company_trip", {
    p_group_id: groupId,
    p_expected_row_version: version.rowVersion,
    p_input: input,
  });
  if (error || !data) return requestGroupError(error, "Could not save the request.");
  return groupStopsResponse(supabase, groupId, 200);
});
