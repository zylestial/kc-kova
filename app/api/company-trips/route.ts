import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { parseCompanyTripInput } from "@/lib/company-trip-input";
import { groupStopsResponse, requestGroupError } from "@/lib/supabase/request-groups";

export const POST = authed(async ({ request, supabase }) => {
  const input = parseCompanyTripInput(await readJson(request));
  if (!input) return NextResponse.json({ message: "Choose a date and add at least one destination." }, { status: 422 });

  // The requester is always the signed-in account (auth.uid() in
  // request_company_trip); sending it creates the trip for the Admin.
  const { data, error } = await supabase.rpc("request_company_trip", { p_group_id: null, p_expected_row_version: null, p_input: input });
  if (error || !data) return requestGroupError(error, "Could not send the request.");
  return groupStopsResponse(supabase, data.id, 201);
});
