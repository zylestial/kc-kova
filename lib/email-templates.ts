import type { Role } from "@/lib/kova-api";

/**
 * KOVA's account emails, each as plain text plus a matching HTML version.
 * Written to stay out of spam: they name the company and why the email was
 * sent, carry one button with the full link under it, and have no images,
 * tracking or promotional wording. Both versions say the same thing.
 */
export type EmailContent = { subject: string; text: string; html: string };

const COMPANY = "Kayelen's Construction";
const FOOTER = `${COMPANY} · KOVA vehicle booking`;

type Layout = {
  subject: string;
  /** The grey snippet Gmail shows after the subject. */
  preheader: string;
  heading: string;
  intro: string;
  facts: [label: string, value: string][];
  button: string;
  link: string;
  after: string;
  /** Why this person got the email, and what to do if it isn't for them. */
  why: string;
};

/** "a Requester", "an Admin", "Finance". */
const asRole = (role: Role) => (role === "Finance" ? "Finance" : role === "Admin" ? "an Admin" : `a ${role}`);

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function plainText(mail: Layout) {
  const facts = mail.facts.map(([label, value]) => `${label}: ${value}`).join("\n");
  return (
    `${mail.heading}\n\n${mail.intro}\n\n${facts}\n\n${mail.button}:\n${mail.link}\n\n${mail.after}\n\n` +
    `--\n${mail.why}\n\n${FOOTER}`
  );
}

/** Table layout and inline styles only: that's what every mail app renders the same. */
function html(mail: Layout) {
  const e = escapeHtml;
  const link = e(mail.link);
  const font = "font-family:Arial,Helvetica,sans-serif;";
  const facts = mail.facts
    .map(
      ([label, value]) =>
        `<tr><td style="${font}font-size:14px;color:#6b7280;padding:2px 16px 2px 0;white-space:nowrap;">${e(label)}</td>` +
        `<td style="${font}font-size:14px;color:#111827;font-weight:bold;padding:2px 0;">${e(value)}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(mail.subject)}</title></head>
<body style="margin:0;padding:0;background:#eef1f7;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(mail.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
<tr><td style="background:#1b2e6e;padding:18px 28px;border-radius:8px 8px 0 0;${font}">
<span style="font-size:20px;font-weight:bold;letter-spacing:2px;color:#ffffff;">KOVA</span>
<span style="font-size:13px;color:#c9d2f0;padding-left:8px;">${e(COMPANY)}</span></td></tr>
<tr><td style="padding:28px;${font}font-size:15px;line-height:1.55;color:#1f2937;">
<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:#111827;">${e(mail.heading)}</h1>
<p style="margin:0 0 16px;">${e(mail.intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#f5f7fc;border:1px solid #e1e6f3;border-radius:6px;"><tr><td style="padding:12px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0">${facts}</table></td></tr></table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td style="background:#2b47a8;border-radius:6px;">
<a href="${link}" style="display:inline-block;padding:12px 22px;${font}font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">${e(mail.button)}</a></td></tr></table>
<p style="margin:0 0 16px;font-size:14px;color:#6b7280;">${e(mail.after)}</p>
<p style="margin:0;font-size:13px;color:#6b7280;">Button not working? Copy this link into your browser:<br><a href="${link}" style="color:#2b47a8;word-break:break-all;">${link}</a></p>
</td></tr>
<tr><td style="border-top:1px solid #e5e7eb;padding:18px 28px 22px;${font}font-size:12.5px;line-height:1.5;color:#6b7280;">
<p style="margin:0 0 6px;">${e(mail.why)}</p><p style="margin:0;">${e(FOOTER)}</p></td></tr>
</table></td></tr></table>
</body></html>`;
}

function build(mail: Layout): EmailContent {
  return { subject: mail.subject, text: plainText(mail), html: html(mail) };
}

export function inviteEmail(link: string, invite: { role: Role; email: string; invitedBy: string }): EmailContent {
  return build({
    subject: `${invite.invitedBy} invited you to KOVA`,
    preheader: `Set up your account to book ${COMPANY} vehicles. The link works for 7 days.`,
    heading: "You're invited to KOVA",
    intro: `${invite.invitedBy} invited you to KOVA, the app ${COMPANY} uses to book and schedule company vehicles. You'll join as ${asRole(invite.role)}.`,
    facts: [
      ["Your role", invite.role],
      ["Sent to", invite.email],
    ],
    button: "Set up my account",
    link,
    after: "You'll choose your own username and password. This link works for 7 days. If it has expired, ask an Admin to send a new one.",
    why: `You got this email because an Admin at ${COMPANY} added this address to KOVA. If you don't work with ${COMPANY}, you can ignore it. No account is made until the link is opened.`,
  });
}

export function confirmEmail(link: string, account: { username: string; email: string }): EmailContent {
  return build({
    subject: "Confirm your email for KOVA",
    preheader: "Confirm it so KOVA can send password resets here. The link works for 24 hours.",
    heading: "Confirm your email",
    intro: `This address was added to the KOVA account ${account.username}. Confirm it so password resets can be sent here.`,
    facts: [
      ["Username", account.username],
      ["New email", account.email],
    ],
    button: "Confirm my email",
    link,
    after: "This link works for 24 hours. Until it's opened, the account keeps its current email.",
    why: "You got this email because this address was entered for a KOVA account. If it isn't yours, ignore this email and nothing will change.",
  });
}

/** "Oct 22, 2026, 9:14 AM", Philippine time. */
const requestedAt = (at: Date) =>
  at.toLocaleString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function resetPasswordEmail(link: string, username: string, at = new Date()): EmailContent {
  return build({
    subject: "Reset your KOVA password",
    preheader: `Your username is ${username}. The link works for 1 hour and only once.`,
    heading: "Reset your password",
    intro: `Hi ${username}, we got a request to reset the password for your KOVA account.`,
    facts: [
      ["Username", username],
      ["Requested", requestedAt(at)],
    ],
    button: "Choose a new password",
    link,
    after: "This link works for 1 hour and only once.",
    why: "If you didn't ask for this, you can ignore this email. Your password stays the same until the link is used.",
  });
}
