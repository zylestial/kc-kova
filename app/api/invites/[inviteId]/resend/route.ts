import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { emailInvite, inviteLink, toInvite, type InviteRow } from "@/lib/invites";

/** Emails an open invite again with a new 7-day link; the old link stops working (Admin only). */
export const POST = authed<{ inviteId: string }>(async ({ account, params: { inviteId } }) => {
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });
  const link = inviteLink();
  const { data } = await createSupabaseAdminClient()
    .from("account_invites")
    .update({ token_hash: link.hash, expires_at: link.expiresAt, sent_at: new Date().toISOString() })
    .eq("id", inviteId)
    .is("accepted_at", null)
    .is("cancelled_at", null)
    .select("*")
    .maybeSingle();
  if (!data) return NextResponse.json({ message: "This invite was already accepted or cancelled." }, { status: 409 });
  const invite = data as InviteRow;
  try {
    await emailInvite(invite.email, invite.role, link.url);
  } catch (caught) {
    console.error("[api/invites/resend] email failed:", caught);
    return NextResponse.json({ message: "Could not send the email. Try again in a moment." }, { status: 502 });
  }
  return NextResponse.json(toInvite(invite));
});
