export const PASSWORD_HINT = "At least 8 characters with a letter and a number, and not containing the username.";

// Returns why a password is not acceptable, or null when it is.
export function passwordError(password: string, username: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Password must include a letter and a number.";
  const user = username.trim().toLowerCase();
  if (user && password.toLowerCase().includes(user)) return "Password must not contain the username.";
  return null;
}
