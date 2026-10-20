import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/api-route";
import { hashToken } from "@/lib/account-tokens";
import { INVITE_LINK_GONE, type InviteRow } from "@/lib/invites";
import { positionAsk } from "@/lib/invite-fields";
import { passwordError } from "@/lib/password-policy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAccount, usernameToAuthEmail } from "@/lib/supabase/accounts";
import { usernameError } from "@/lib/username-policy";
import { parseWith } from "@/lib/validation";

const acceptBody = z.object({
  token: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  username: z.string().trim().min(1),
  position: z.string().trim().max(100).catch(""),
  password: z.string().min(1),
});

/**
 * Sets up the account an invite was for: the person's own name, username,
 * position and password, with the role and permissions the Admin chose.
 * The invite is claimed first, so a link works once even if submitted
 * twice; if the account can't be made (say, the username is taken) the
 * claim is released and the same link can be tried again. Opening the
 * emailed link proved the email, so it's stored as confirmed. Ends signed in.
 */
export async function POST(request: Request) {
  const body = parseWith(acceptBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "Name, username and password are required." }, { status: 422 });
  const problem = usernameError(body.username) ?? passwordError(body.password, body.username);
  if (problem) return NextResponse.json({ message: problem }, { status: 422 });

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { data: claimed } = await admin
    .from("account_invites")
    .update({ accepted_at: now })
    .eq("token_hash", hashToken(body.token))
    .is("accepted_at", null)
    .is("cancelled_at", null)
    .gt("expires_at", now)
    .select("*")
    .maybeSingle();
  if (!claimed) return NextResponse.json({ message: INVITE_LINK_GONE }, { status: 410 });
  const invite = claimed as InviteRow;
  const release = () => admin.from("account_invites").update({ accepted_at: null }).eq("id", invite.id);

  // Only what this invite's access needs: a Position nobody prints isn't kept.
  const ask = positionAsk({ role: invite.role, canRequestCompany: invite.can_request_company });
  const position = ask === "none" ? "" : body.position;
  if (ask === "required" && !position) {
    await release();
    return NextResponse.json({ message: "Add your position; it prints on the Company Trip Form." }, { status: 422 });
  }
  const { data: taken } = await admin.from("account_emails").select("account_id").eq("email", invite.email).maybeSingle();
  if (taken) {
    await admin.from("account_invites").update({ accepted_at: null, cancelled_at: now }).eq("id", invite.id);
    return NextResponse.json({ message: "This email already has a KOVA account. Sign in, or use Forgot password." }, { status: 409 });
  }

  const created = await createAccount(admin, {
    name: body.name,
    username: body.username,
    role: invite.role,
    status: "Active",
    password: body.password,
    position,
    driverType: invite.driver_type ?? null,
    canRequestDaily: invite.can_request_daily,
    canRequestCompany: invite.can_request_company,
  });
  if ("message" in created) {
    await release();
    return NextResponse.json({ message: created.message }, { status: created.status });
  }

  const accountId = created.account.id;
  const { error: emailError } = await admin
    .from("account_emails")
    .insert({ account_id: accountId, email: invite.email, confirmed_at: now, updated_at: now });
  if (emailError) console.error("[api/auth/accept-invite] email not saved:", emailError);
  await admin.from("account_invites").update({ accepted_account_id: accountId }).eq("id", invite.id);

  const supabase = await createSupabaseServerClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: usernameToAuthEmail(body.username),
    password: body.password,
  });
  if (signInError) console.error("[api/auth/accept-invite] sign-in failed:", signInError);
  return NextResponse.json({ account: signInError ? null : created.account }, { status: 201 });
}
