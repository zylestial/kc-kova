import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * True when an Authorization header carries the push secret
 * ("Bearer <PUSH_SEND_SECRET>"), compared in constant time. Never true while
 * the secret is unset, so /api/push/send stays shut until it's configured.
 */
export function bearerMatches(header: string | null, secret: string | undefined) {
  if (!secret || !header) return false;
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
