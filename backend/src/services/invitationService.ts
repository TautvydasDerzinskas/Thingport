// Invitations to register while registrations are closed. The single-use token, not the email,
// authorizes registration, so nobody else can claim an invited address first. It also proves
// mailbox ownership, so invitees skip email verification.

import crypto from "node:crypto";
import type { Invitation } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { sendInvitationEmail } from "./mailer";
import { getAllowRegistrations, getPublicUrl, isSmtpConfigured } from "./settingsService";

export const INVITATION_TTL_DAYS = 7;

/** `origin` is the fallback for instances without a public URL. */
export async function invitationLink(email: string, token: string, origin: string | null): Promise<string> {
  const base = (await getPublicUrl()) || (origin ?? "").replace(/\/+$/, "");
  return `${base}/register?email=${encodeURIComponent(email)}&invite=${encodeURIComponent(token)}`;
}

/** Replaces any existing invitation for the address. Requires closed registrations and SMTP. */
export async function inviteUser(params: {
  email: string;
  invitedById: string;
  inviterName: string;
  origin: string | null;
}): Promise<Invitation> {
  const email = params.email.trim().toLowerCase();
  if (await getAllowRegistrations(true)) {
    throw new HttpError(400, "Registrations are open, so anyone can sign up without an invitation.");
  }
  if (!(await isSmtpConfigured())) {
    throw new HttpError(400, "Set up SMTP (Connections > SMTP) to send invitations.");
  }
  if (await prisma.user.findUnique({ where: { email } })) {
    throw new HttpError(409, "An account with this email already exists");
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const previous = await prisma.invitation.findUnique({ where: { email } });
  const invitation = await prisma.invitation.upsert({
    where: { email },
    create: { email, token, expiresAt, invitedById: params.invitedById },
    update: { token, expiresAt, invitedById: params.invitedById },
  });

  try {
    await sendInvitationEmail(
      email,
      params.inviterName,
      await invitationLink(email, token, params.origin),
      INVITATION_TTL_DAYS,
    );
  } catch (err) {
    console.error("[invitations] Failed to send invitation email:", err);
    // Keep a re-invite's earlier, already delivered link working.
    if (previous) {
      await prisma.invitation.update({
        where: { email },
        data: { token: previous.token, expiresAt: previous.expiresAt, invitedById: previous.invitedById },
      });
    } else {
      await prisma.invitation.delete({ where: { email } }).catch(() => undefined);
    }
    throw new HttpError(500, "Failed to send the invitation email. Check the SMTP settings and try again.");
  }
  return invitation;
}

export async function findValidInvitation(token: string): Promise<Invitation | null> {
  const invitation = await prisma.invitation.findUnique({ where: { token } });
  if (!invitation || invitation.expiresAt < new Date()) return null;
  return invitation;
}
