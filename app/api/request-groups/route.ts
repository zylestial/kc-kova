import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { parseRequestForm, parseRequestGroupInput } from "@/lib/request-group-input";
import { groupStopsResponse, requestGroupError } from "@/lib/supabase/request-groups";

export const POST = authed(async ({ request, supabase }) => {
  const body = await readJson(request);
  const form = parseRequestForm(body);
  const input = parseRequestGroupInput(body);
  if (!form || !input) {
    return NextResponse.json({ message: "Choose a form and a date, and add at least one destination." }, { status: 422 });
  }

  // Requested By is always the signed-in account; create_request_group
  // takes it from auth.uid(), never from the body.
  const { data, error } = await supabase.rpc("create_request_group", { p_form_type: form, p_input: input });
  if (error || !data) return requestGroupError(error, "Could not create the request.");
  return groupStopsResponse(supabase, data.id, 201);
});
