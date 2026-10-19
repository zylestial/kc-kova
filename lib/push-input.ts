import { z } from "zod";
import { parseWith } from "@/lib/validation";

const endpoint = z.url({ protocol: /^https$/ }).max(1000);

// The browser's PushSubscription as JSON (pushManager.subscribe()).
const subscriptionBody = z.object({
  endpoint,
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});

const endpointBody = z.object({ endpoint });

export type PushSubscriptionInput = { endpoint: string; p256dh: string; auth: string };

/**
 * Shape-checks a device turning phone notifications on, before it reaches
 * save_push_subscription (0069). Returns null when the body isn't usable.
 */
export function parsePushSubscriptionInput(body: unknown): PushSubscriptionInput | null {
  const parsed = parseWith(subscriptionBody, body);
  return parsed && { endpoint: parsed.endpoint, p256dh: parsed.keys.p256dh, auth: parsed.keys.auth };
}

/** The device turning phone notifications off, or null. */
export function parsePushEndpointInput(body: unknown): string | null {
  return parseWith(endpointBody, body)?.endpoint ?? null;
}
