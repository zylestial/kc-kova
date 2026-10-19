export const USERNAME_HINT = "3–30 letters, numbers, dots, dashes or underscores, no spaces.";

/**
 * Why a username someone chose for themselves isn't acceptable, or null
 * when it is. It becomes part of the made-up Auth email, so it stays to
 * characters an email address allows. Taken usernames are refused by the
 * database, not here.
 */
export function usernameError(username: string): string | null {
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(username.trim())) return `Username must be ${USERNAME_HINT.charAt(0).toLowerCase()}${USERNAME_HINT.slice(1)}`;
  return null;
}
