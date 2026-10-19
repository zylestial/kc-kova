import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One-time links KOVA emails (0072). The link carries a random token; the
 * database keeps only its sha256, so a leaked table can't be turned back
 * into working links.
 */
export type TokenPurpose = "confirm_email" | "reset_password";

const HOUR_MS = 60 * 60 * 1000;
export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  confirm_email: 24 * HOUR_MS,
  reset_password: HOUR_MS,
};
export const INVITE_TTL_MS = 7 * 24 * HOUR_MS;

export const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

/** A fresh link token and the hash to store for it. */
export function newToken() {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export const expiresIn = (ms: number) => new Date(Date.now() + ms).toISOString();

/**
 * Issues a link for an account, cancelling its older unused links of the
 * same purpose so only the newest one works. Returns the raw token for the
 * email. `admin` is the service-role client.
 */
export async function issueAccountToken(admin: SupabaseClient, accountId: string, purpose: TokenPurpose, email: string) {
  const now = new Date().toISOString();
  await admin.from("account_tokens").update({ used_at: now }).eq("account_id", accountId).eq("purpose", purpose).is("used_at", null);
  const { raw, hash } = newToken();
  const { error } = await admin.from("account_tokens").insert({
    account_id: accountId,
    purpose,
    email,
    token_hash: hash,
    expires_at: expiresIn(TOKEN_TTL_MS[purpose]),
  });
  if (error) throw error;
  return raw;
}

/**
 * Uses up a link: marks it used in the same statement that checks it's
 * unused and unexpired, so it works once even if opened twice at the same
 * moment. Null when it's unknown, used, expired, or for another purpose.
 */
export async function consumeAccountToken(admin: SupabaseClient, raw: string, purpose: TokenPurpose) {
  const now = new Date().toISOString();
  const { data } = await admin
    .from("account_tokens")
    .update({ used_at: now })
    .eq("token_hash", hashToken(raw))
    .eq("purpose", purpose)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("account_id, email")
    .maybeSingle();
  return data ? { accountId: data.account_id as string, email: data.email as string } : null;
}
