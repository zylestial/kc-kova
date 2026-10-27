import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { giveBackAttempts, INVITE_LIMIT, takeAttempts } from "@/lib/supabase/login-rate-limit";
import { emailInvite, inviteLink, toInvite, type InviteRow } from "@/lib/invites";

/** Emails an open invite again with a new 7-day link; the old link stops working (Admin only). Counts toward INVITE_LIMIT. */
export const POST = authed<{ inviteId: string }>(async ({ account, params: { inviteId } }) => {
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });
  const limitKey = `invite:${account.id}`;
  if (!(await takeAttempts(limitKey, INVITE_LIMIT)).ok) {
    return NextResponse.json({ message: "You've sent the most invites allowed in an hour. Try again later." }, { status: 429 });
  }
  const link = inviteLink();
  const { data } = await createSupabaseAdminClient()
    .from("account_invites")
    .update({ token_hash: link.hash, expires_at: link.expiresAt, sent_at: new Date().toISOString() })
    .eq("id", inviteId)
    .is("accepted_at", null)
    .is("cancelled_at", null)
    .select("*")
    .maybeSingle();
  if (!data) {
    await giveBackAttempts(limitKey, INVITE_LIMIT);
    return NextResponse.json({ message: "This invite was already accepted or cancelled." }, { status: 409 });
  }
  const invite = data as InviteRow;
  try {
    await emailInvite(invite.email, invite.role, link.url, account.name);
  } catch (caught) {
    console.error("[api/invites/resend] email failed:", caught);
    await giveBackAttempts(limitKey, INVITE_LIMIT);
    return NextResponse.json({ message: "Could not send the email. Try again in a moment." }, { status: 502 });
  }
  return NextResponse.json(toInvite(invite));
});
