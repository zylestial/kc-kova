import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Cancels an open invite; its link stops working (Admin only). */
export const DELETE = authed<{ inviteId: string }>(async ({ account, params: { inviteId } }) => {
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });
  const { data } = await createSupabaseAdminClient()
    .from("account_invites")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", inviteId)
    .is("accepted_at", null)
    .is("cancelled_at", null)
    .select("id")
    .maybeSingle();
  if (!data) return NextResponse.json({ message: "This invite was already accepted or cancelled." }, { status: 409 });
  return new Response(null, { status: 204 });
});
