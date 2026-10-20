import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/api-route";
import { consumeAccountToken, peekAccountToken } from "@/lib/account-tokens";
import { passwordError } from "@/lib/password-policy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { clearLoginAttempts } from "@/lib/supabase/login-rate-limit";
import { parseWith } from "@/lib/validation";

const LINK_GONE = "This reset link has expired or was already used. Ask for a new one from Sign In → Forgot password.";

const resetBody = z.object({ token: z.string().min(1), password: z.string().min(1) });

async function activeAccountFor(token: string) {
  const admin = createSupabaseAdminClient();
  const link = token ? await peekAccountToken(admin, token, "reset_password") : null;
  if (!link) return null;
  const { data } = await admin.from("accounts").select("id, username, status").eq("id", link.accountId).maybeSingle();
  return data && data.status === "Active" ? { admin, account: data as { id: string; username: string } } : null;
}

/** Who a reset link is for, so the page can say so; public, the token is the proof. */
export async function GET(request: Request) {
  const found = await activeAccountFor(new URL(request.url).searchParams.get("token") ?? "");
  if (!found) return NextResponse.json({ message: LINK_GONE }, { status: 410 });
  return NextResponse.json({ username: found.account.username });
}

/**
 * Sets a new password from a reset link. The password is checked before
 * the link is used up, so a refused one can be fixed and tried again; the
 * link then works once. Also lifts a sign-in lockout.
 */
export async function POST(request: Request) {
  const body = parseWith(resetBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "Enter a new password." }, { status: 422 });

  const found = await activeAccountFor(body.token);
  if (!found) return NextResponse.json({ message: LINK_GONE }, { status: 410 });
  const { admin, account } = found;
  const problem = passwordError(body.password, account.username);
  if (problem) return NextResponse.json({ message: problem }, { status: 422 });

  if (!(await consumeAccountToken(admin, body.token, "reset_password"))) {
    return NextResponse.json({ message: LINK_GONE }, { status: 410 });
  }
  const { error } = await admin.auth.admin.updateUserById(account.id, { password: body.password });
  if (error) {
    console.error("[api/auth/reset-password] update failed:", error);
    return NextResponse.json({ message: "Could not change the password. Ask for a new link and try again." }, { status: 422 });
  }
  await clearLoginAttempts(account.username);
  return new Response(null, { status: 204 });
}
