import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { attemptsLeft, INVITE_LIMIT, recordFailedLogin } from "@/lib/supabase/login-rate-limit";
import { inviteBody, parseEmailList } from "@/lib/admin-input";
import { emailInvite, inviteLink, toInvite, type InviteRow } from "@/lib/invites";
import type { InviteResult } from "@/lib/kova-api";
import { parseWith } from "@/lib/validation";

const MAX_BATCH = 100;

/** The open invites, newest first (Admin only). */
export const GET = authed(async ({ supabase, account }) => {
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });
  const { data, error } = await supabase
    .from("account_invites")
    .select("*")
    .is("accepted_at", null)
    .is("cancelled_at", null)
    .order("sent_at", { ascending: false });
  if (error) return NextResponse.json({ message: "Could not load the invites." }, { status: 500 });
  return NextResponse.json((data as InviteRow[]).map(toInvite));
});

/**
 * Invites a batch of emails with one role and set of permissions. Emails
 * that already have an account or an open invite are skipped (Resend is
 * for the latter); one that couldn't be emailed is cancelled again so it
 * can simply be tried later. Each Admin can send INVITE_LIMIT emails an
 * hour, resends included, so a stolen session can't spam from our address.
 */
export const POST = authed(async ({ request, account }) => {
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });

  const body = parseWith(inviteBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "Choose an account type." }, { status: 422 });
  const { valid, invalid } = parseEmailList(body.emails);
  if (!valid.length) return NextResponse.json({ message: "Add at least one email address." }, { status: 422 });
  if (valid.length > MAX_BATCH) return NextResponse.json({ message: `Invite at most ${MAX_BATCH} people at a time.` }, { status: 422 });

  const admin = createSupabaseAdminClient();
  const [{ data: taken }, { data: open }] = await Promise.all([
    admin.from("account_emails").select("email").in("email", valid),
    admin.from("account_invites").select("email").in("email", valid).is("accepted_at", null).is("cancelled_at", null),
  ]);
  const hasAccount = new Set((taken ?? []).map((row) => row.email as string));
  const invited = new Set((open ?? []).map((row) => row.email as string));

  const limitKey = `invite:${account.id}`;
  const toSend = valid.filter((email) => !hasAccount.has(email) && !invited.has(email)).length;
  const left = await attemptsLeft(limitKey, INVITE_LIMIT);
  if (toSend > left) {
    const message = left
      ? `You can send ${left} more invite${left === 1 ? "" : "s"} this hour. Send fewer, or try again later.`
      : "You've sent the most invites allowed in an hour. Try again later.";
    return NextResponse.json({ message }, { status: 429 });
  }

  const result: InviteResult = { sent: [], skipped: [], invalid, failed: [] };
  for (const email of valid) {
    if (hasAccount.has(email)) {
      result.skipped.push({ email, reason: "already has an account" });
      continue;
    }
    if (invited.has(email)) {
      result.skipped.push({ email, reason: "already invited" });
      continue;
    }
    const link = inviteLink();
    const { data: row, error } = await admin
      .from("account_invites")
      .insert({
        email,
        role: body.role,
        driver_type: body.driverType,
        can_request_daily: body.canRequestDaily,
        can_request_company: body.canRequestCompany,
        can_drive_company: body.canDriveCompany,
        token_hash: link.hash,
        expires_at: link.expiresAt,
        invited_by: account.id,
      })
      .select("id")
      .single();
    if (error || !row) {
      // Another Admin invited the same email a moment ago.
      if (error?.code === "23505") result.skipped.push({ email, reason: "already invited" });
      else result.failed.push(email);
      continue;
    }
    try {
      await emailInvite(email, body.role, link.url, account.name);
      result.sent.push(email);
    } catch (caught) {
      console.error("[api/invites] email failed:", caught);
      await admin.from("account_invites").update({ cancelled_at: new Date().toISOString() }).eq("id", row.id);
      result.failed.push(email);
    }
  }
  await recordFailedLogin(limitKey, INVITE_LIMIT, result.sent.length);
  return NextResponse.json(result);
});
