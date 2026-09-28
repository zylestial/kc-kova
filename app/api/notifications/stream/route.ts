import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/session";

// The frontend never talks to Supabase directly (docs/ARCHITECTURE.md), so
// this isn't Supabase Realtime: it's a Server-Sent Events endpoint of KOVA's
// own that polls this account's notifications every few seconds and pushes
// anything new. A Vercel serverless function can't hold a connection open
// indefinitely, so the stream closes itself well under any plan's function
// duration limit; the browser's EventSource reconnects automatically and
// picks up from there (lib/notifications-stream.ts).
export const maxDuration = 60;

const POLL_INTERVAL_MS = 4_000;
const STREAM_DURATION_MS = 50_000;

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return new Response("Sign in required.", { status: 401 });

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      let sinceCreatedAt = new Date().toISOString();
      const startedAt = Date.now();
      send("ready", {});

      while (!closed && Date.now() - startedAt < STREAM_DURATION_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (closed) break;

        const { data, error } = await supabase
          .from("notifications")
          .select("id, created_at")
          .gt("created_at", sinceCreatedAt)
          .order("created_at", { ascending: true });

        if (!error && data && data.length > 0) {
          sinceCreatedAt = data[data.length - 1].created_at;
          send("new-notifications", { count: data.length });
        }
      }

      send("closing", {});
      controller.close();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
