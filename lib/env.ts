import { z } from "zod";

/**
 * Required server-side environment variables. Validated once at server
 * startup (see instrumentation.ts) so a missing/misconfigured var fails
 * fast with a clear message instead of surfacing as an opaque runtime
 * error the first time a route touches Supabase.
 */
const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export function validateEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Missing or invalid required environment variables: ${missing}`);
  }
}
