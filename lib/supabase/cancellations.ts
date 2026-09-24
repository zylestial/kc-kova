import { NextResponse } from "next/server";

/**
 * Maps a cancellation RPC error to an HTTP response. A moved request
 * (PT409) is a conflict: the caller should reload and try again.
 */
export function cancellationErrorResponse(error: { code?: string; message: string }, fallback: string) {
  if (error.code === "42501") return NextResponse.json({ message: error.message || "Not authorized." }, { status: 403 });
  if (error.code === "P0002") return NextResponse.json({ message: error.message || "Not found." }, { status: 404 });
  if (error.code === "PT409") return NextResponse.json({ message: error.message }, { status: 409 });
  return NextResponse.json({ message: error.message || fallback }, { status: 422 });
}
