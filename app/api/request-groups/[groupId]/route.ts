import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { parseRequestGroupInput } from "@/lib/request-group-input";
import { groupStopsResponse, requestGroupError } from "@/lib/supabase/request-groups";
import { parseWith, rowVersionBody } from "@/lib/validation";

export const PUT = authed<{ groupId: string }>(async ({ request, supabase, params: { groupId } }) => {
  const body = await readJson(request);
  const input = parseRequestGroupInput(body);
  const version = parseWith(rowVersionBody, body);
  if (!input || !version) {
    return NextResponse.json({ message: "Choose a date and keep at least one destination." }, { status: 422 });
  }

  // rowVersion is the version the form was opened on; update_request_group
  // refuses the save if the request changed since.
  const { data, error } = await supabase.rpc("update_request_group", {
    p_group_id: groupId,
    p_expected_row_version: version.rowVersion,
    p_input: input,
  });
  if (error || !data) return requestGroupError(error, "Could not update the request.");
  return groupStopsResponse(supabase, groupId, 200);
});
