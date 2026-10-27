import nodemailer, { type Transporter } from "nodemailer";

/** `html` goes alongside `text`, never instead of it: both say the same thing. */
export type Mail = { to: string; subject: string; text: string; html?: string };

/** The name shown next to the sender address in the inbox. */
export const SENDER_NAME = "KOVA · Kayelen's Construction";

let transporter: Transporter | undefined;

function smtpTransporter(): Transporter | undefined {
  const host = process.env.SMTP_HOST;
  if (!host) return undefined;
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 465);
    const user = process.env.SMTP_USER;
    transporter = nodemailer.createTransport({
      host,
      port,
      // 465 is TLS from the start (Gmail); anything else upgrades if it can
      // (local Mailpit on 54325 has no TLS and no login).
      secure: port === 465,
      auth: user ? { user, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

/**
 * Sends one of KOVA's account emails (invite, confirm, reset). Without
 * SMTP_HOST, development logs it instead so links can still be opened;
 * production refuses, so a missing setup can't fail silently.
 */
export async function sendMail(mail: Mail) {
  const smtp = smtpTransporter();
  if (!smtp) {
    if (process.env.NODE_ENV === "production") throw new Error("SMTP_HOST is not set; KOVA can't send email.");
    console.info(`[mail] to ${mail.to}: ${mail.subject}\n${mail.text}`);
    return;
  }
  await smtp.sendMail({ from: sender(), ...mail });
}

/**
 * MAIL_FROM as given when it already carries a name ("Name <address>");
 * a bare address, or SMTP_USER, gets SENDER_NAME so the inbox never shows
 * an unnamed Gmail address.
 */
function sender() {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || "";
  return from.includes("<") ? from : { name: SENDER_NAME, address: from };
}

/**
 * An absolute link into KOVA for an email. Always built from APP_URL,
 * never from the request's Host header, so nobody can make KOVA email a
 * link that points at another site.
 */
export function appUrl(path: string) {
  const base = process.env.APP_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000");
  if (!base) throw new Error("APP_URL is not set; KOVA can't build email links.");
  return new URL(path, base).toString();
}
