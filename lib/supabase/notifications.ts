import { NextResponse } from "next/server";

/** Maps a notifications RPC error to an HTTP response. */
export function notificationErrorResponse(error: { code?: string; message: string }, fallback: string) {
  if (error.code === "P0002") return NextResponse.json({ message: "Notification not found." }, { status: 404 });
  return NextResponse.json({ message: error.message || fallback }, { status: 422 });
}
