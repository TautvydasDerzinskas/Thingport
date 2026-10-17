import nodemailer from "nodemailer";
import { getPublicUrl, getSmtpSettings } from "./settingsService";

/** Throws without a host rather than silently dropping the email. */
async function sendMail(message: { to: string; subject: string; text: string; html: string }): Promise<void> {
  const smtp = await getSmtpSettings();
  if (!smtp.host) throw new Error("SMTP is not configured");

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? undefined } : undefined,
  });
  await transporter.sendMail({ from: smtp.from, ...message });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export async function sendVerificationEmail(to: string, displayName: string, token: string): Promise<void> {
  const link = `${await getPublicUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail({
    to,
    subject: "Confirm your Thingport account",
    text: `Hi ${displayName},\n\nConfirm your email address to finish creating your Thingport account:\n${link}\n\nThis link expires in 24 hours.`,
    html: `<p>Hi ${escapeHtml(displayName)},</p><p>Confirm your email address to finish creating your Thingport account:</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours.</p>`,
  });
}

export async function sendPasswordResetEmail(to: string, displayName: string, token: string): Promise<void> {
  const link = `${await getPublicUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail({
    to,
    subject: "Reset your Thingport password",
    text: `Hi ${displayName},\n\nSomeone asked to reset the password for your Thingport account. To choose a new password, open:\n${link}\n\nThis link expires in 1 hour. If you didn't ask for this, you can ignore this email.`,
    html: `<p>Hi ${escapeHtml(displayName)},</p><p>Someone asked to reset the password for your Thingport account. To choose a new password, open:</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour. If you didn't ask for this, you can ignore this email.</p>`,
  });
}

/** `link` is the full registration URL, token included. */
export async function sendInvitationEmail(
  to: string,
  inviterName: string,
  link: string,
  expiresInDays: number,
): Promise<void> {
  await sendMail({
    to,
    subject: "You're invited to Thingport",
    text: `${inviterName} invited you to create an account on their Thingport, a library for 3D-printing models.\n\nCreate your account here:\n${link}\n\nThe link works for ${expiresInDays} days, for this email address only.`,
    html: `<p>${escapeHtml(inviterName)} invited you to create an account on their Thingport, a library for 3D-printing models.</p><p><a href="${link}">Create your account</a></p><p>Or open this link: ${link}</p><p>The link works for ${expiresInDays} days, for this email address only.</p>`,
  });
}
