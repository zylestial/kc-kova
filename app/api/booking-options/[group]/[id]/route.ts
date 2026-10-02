import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { toBookingOption } from "@/lib/supabase/mappers";

const GROUPS = ["projects", "destinations", "purposes"] as const;
const STATUSES = ["Active", "Inactive"] as const;

export const PUT = authed<{ group: string; id: string }>(async ({ request, supabase, account, params: { group, id } }) => {
  if (!GROUPS.includes(group as (typeof GROUPS)[number])) {
    return NextResponse.json({ message: "Unknown booking option group." }, { status: 404 });
  }
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const status = STATUSES.includes(body?.status) ? body.status : "Active";
  // Only meaningful for destinations; ignored (stays false) for every other group.
  const isOtherStop = group === "destinations" && body?.isOtherStop === true;
  if (!name) return NextResponse.json({ message: "Name is required." }, { status: 422 });

  // booking_options_admin_write RLS policy enforces the Admin check server-side too.
  const { data, error } = await supabase
    .from("booking_options")
    .upsert({ group, id, name, status, is_other_stop: isOtherStop }, { onConflict: "group,id" })
    .select("*")
    .single();
  if (error || !data) return NextResponse.json({ message: "Could not save the option." }, { status: 422 });

  return NextResponse.json(toBookingOption(data));
});
