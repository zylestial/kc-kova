import type { Role } from "@/lib/kova-api";

/**
 * The text of KOVA's account emails. Plain text and short: they're read
 * on phones and must not look like marketing to a spam filter.
 */
export type EmailContent = { subject: string; text: string };

const SIGN_OFF = "\n\nIf you weren't expecting this email, you can ignore it.\n\n— KOVA";

/** "a Requester", "an Admin", "Finance". */
const asRole = (role: Role) => (role === "Finance" ? "Finance" : role === "Admin" ? "an Admin" : `a ${role}`);

export function inviteEmail(link: string, role: Role): EmailContent {
  return {
    subject: "You're invited to KOVA",
    text:
      `You've been invited to KOVA, the company's vehicle booking app, as ${asRole(role)}.\n\n` +
      `Open this link to choose your username and password:\n${link}\n\n` +
      "The link works for 7 days. If it has expired, ask an Admin to send a new one." +
      SIGN_OFF,
  };
}

export function confirmEmail(link: string): EmailContent {
  return {
    subject: "Confirm your KOVA email",
    text:
      `Open this link to confirm this is your email for KOVA:\n${link}\n\n` +
      "The link works for 24 hours." +
      SIGN_OFF,
  };
}

export function resetPasswordEmail(link: string, username: string): EmailContent {
  return {
    subject: "Reset your KOVA password",
    text:
      `Someone asked to reset the password for your KOVA account.\n\nYour username: ${username}\n\n` +
      `Open this link to choose a new password:\n${link}\n\n` +
      "The link works for 1 hour and only once. If you didn't ask for this, your password hasn't changed." +
      SIGN_OFF,
  };
}
