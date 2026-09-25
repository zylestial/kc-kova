/**
 * Turns what the API or the database said into a plain sentence with a next
 * step, for the message a person actually reads. Messages that are already a
 * clear sentence pass through unchanged, so specific rules such as "Regular
 * requests need at least 7 days" stay as they are. Only the terse, technical
 * or dead-end ones are rewritten.
 */

export const NETWORK_ERROR = "KOVA can't connect right now. Check your internet connection and try again.";
const SESSION_ENDED = "Your session has ended. Sign in again to continue.";
const NO_PERMISSION = "You don't have permission to do that. Ask an Admin if you need access.";
const OUT_OF_DATE = "This was changed by someone else while you were working. Refresh the page and try again.";
const SERVER_ERROR = "Something went wrong on our side. Try again in a moment, and tell an Admin if it keeps happening.";

export function friendlyErrorMessage(status: number, message: string): string {
  const text = message.trim();

  if (status >= 500 || !text) return SERVER_ERROR;
  if (/^sign in required\.?$/i.test(text)) return SESSION_ENDED;
  if (/^(admin|driver|scheduler|requester) access required\.?$/i.test(text) || /^not authorized( to .+)?\.?$/i.test(text)) {
    return NO_PERMISSION;
  }
  if (/reload/i.test(text) || /^rowVersion is required\.?$/i.test(text)) return OUT_OF_DATE;

  const missing = /^(.+?) not found\.?$/i.exec(text);
  if (missing) {
    return `We couldn't find that ${missing[1].toLowerCase()}. It may have been removed. Refresh the page and try again.`;
  }
  if (/^the request could not be completed\.?$/i.test(text)) return SERVER_ERROR;

  return text;
}
