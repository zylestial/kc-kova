import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { toBookingOption } from "@/lib/supabase/mappers";

/** The lists anyone signed in may add to by typing a new name (0098). */
const ADDABLE = ["destinations", "purposes"];

// Typing a name that isn't on the list adds it for everyone; the same name
// (ignoring case and spaces) returns the one already there (0098).
export const POST = authed<{ group: string }>(async ({ request, supabase, params: { group } }) => {
  if (!ADDABLE.includes(group)) return NextResponse.json({ message: "Only the Admin can add to this list." }, { status: 403 });
  const body = (await readJson(request)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 100) return NextResponse.json({ message: "Enter a name of 2 to 100 characters." }, { status: 422 });

  const { data, error } = await supabase.rpc("add_booking_option", { p_group: group, p_name: name });
  if (error || !data) {
    const status = error?.code === "42501" ? 403 : 422;
    return NextResponse.json({ message: error?.message ? `${error.message}.` : "Could not add the name." }, { status });
  }
  return NextResponse.json(toBookingOption(data), { status: 201 });
});
