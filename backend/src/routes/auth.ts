import crypto from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { AUTH_TOKEN_TTL } from "../config";
import { createToken, requireAuth } from "../auth";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { getAllowRegistrations, isSmtpConfigured } from "../services/settingsService";
import { sendVerificationEmail } from "../services/mailer";
import { createLog } from "../services/auditLog";
import { seedDefaultCategories } from "../services/categoryService";
import { toUserOut } from "../dto";
import type { Prisma, Role } from "@prisma/client";

const router = Router();

const PASSWORD_HASH_COST = 12;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

function newVerificationToken(): { token: string; expires: Date } {
  return { token: crypto.randomBytes(32).toString("hex"), expires: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS) };
}

const registerSchema = z.object({
  displayName: z.string().trim().min(1, "Display name is required"),
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string(),
});

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const body = parseBody(registerSchema, req.body);
    const email = body.email.toLowerCase();

    // The very first account on the instance always becomes admin and may register even if
    // registrations are otherwise disabled -- an operator can never lock themselves out of
    // bootstrapping the instance. Once any admin exists, this exception no longer applies.
    const adminExists = (await prisma.user.count({ where: { role: "ADMIN" } })) > 0;
    const bootstrapping = !adminExists;

    if (!bootstrapping && !(await getAllowRegistrations(true))) {
      throw new HttpError(403, "Registration is currently disabled");
    }
    if (await prisma.user.findUnique({ where: { email } })) {
      throw new HttpError(409, "An account with this email already exists");
    }

    const passwordHash = await bcrypt.hash(body.password, PASSWORD_HASH_COST);
    const role: Role = bootstrapping ? "ADMIN" : "MEMBER";
    // Bootstrapping the very first (admin) account always skips verification -- SMTP can't have
    // been configured yet by an operator who isn't able to sign in until this account exists.
    // Otherwise, email verification only actually happens when SMTP is configured; unconfigured
    // instances create fully-verified accounts immediately so this feature is opt-in, not a
    // requirement that breaks self-hosters who never set up a mail server.
    const smtpConfigured = !bootstrapping && (await isSmtpConfigured());
    const verification = smtpConfigured ? newVerificationToken() : null;

    // Wrapped together so an account never ends up missing its starter categories (or vice
    // versa) because of a failure partway through -- see seedDefaultCategories.
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          displayName: body.displayName,
          role,
          emailVerified: !smtpConfigured,
          emailVerificationToken: verification?.token ?? null,
          emailVerificationExpires: verification?.expires ?? null,
        },
      });
      await seedDefaultCategories(tx, created.id);
      return created;
    }, { timeout: 15000 }); // seedDefaultCategories is ~80 sequential inserts -- Prisma's 5s default is too tight

    if (smtpConfigured && verification) {
      try {
        await sendVerificationEmail(user.email, user.displayName, verification.token);
      } catch {
        // Don't leave an unverifiable account behind if the email never went out.
        await prisma.user.delete({ where: { id: user.id } });
        throw new HttpError(500, "Failed to send verification email. Please try again.");
      }
      res.json({ email_verification_required: true, email: user.email });
      return;
    }

    const token = createToken(user.id, user.role);
    res.json({ token, expires_in: AUTH_TOKEN_TTL, user: toUserOut(user) });
  }),
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = parseBody(loginSchema, req.body);
    const email = body.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    // Same generic message whether the email doesn't exist or the password is wrong -- don't
    // let a login attempt be used to enumerate registered addresses.
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      throw new HttpError(401, "Invalid email or password");
    }

    if (!user.emailVerified) {
      throw new HttpError(403, "Please verify your email before signing in.", "EMAIL_NOT_VERIFIED");
    }

    const token = createToken(user.id, user.role);
    res.json({ token, expires_in: AUTH_TOKEN_TTL, user: toUserOut(user) });
    void createLog({ userId: user.id, action: "user_logged_in", details: { email: user.email } });
  }),
);

const verifyEmailSchema = z.object({ token: z.string().min(1) });

router.post(
  "/verify-email",
  asyncHandler(async (req, res) => {
    const body = parseBody(verifyEmailSchema, req.body);
    const user = await prisma.user.findUnique({ where: { emailVerificationToken: body.token } });
    if (!user || !user.emailVerificationExpires || user.emailVerificationExpires < new Date()) {
      throw new HttpError(400, "This verification link is invalid or has expired.");
    }

    let verified;
    if (user.pendingEmail) {
      // Confirming an email *change* (Profile > Change email), not a fresh signup -- re-check
      // for a conflict that may have appeared since the change was requested (someone else
      // registering that same address in the meantime).
      const conflict = await prisma.user.findUnique({ where: { email: user.pendingEmail } });
      if (conflict && conflict.id !== user.id) {
        throw new HttpError(409, "That email is now used by another account. Please request the change again.");
      }
      verified = await prisma.user.update({
        where: { id: user.id },
        data: {
          email: user.pendingEmail,
          pendingEmail: null,
          emailVerified: true,
          emailVerificationToken: null,
          emailVerificationExpires: null,
        },
      });
    } else {
      verified = await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true, emailVerificationToken: null, emailVerificationExpires: null },
      });
    }
    // Verifying doubles as signing in -- the user just proved control of the mailbox, and
    // making them turn around and log in again with a password they only just typed is friction
    // with no security benefit.
    const token = createToken(verified.id, verified.role);
    res.json({ token, expires_in: AUTH_TOKEN_TTL, user: toUserOut(verified) });
    void createLog({ userId: verified.id, action: "user_logged_in", details: { email: verified.email } });
  }),
);

const resendVerificationSchema = z.object({ email: z.string().trim().email() });

router.post(
  "/resend-verification",
  asyncHandler(async (req, res) => {
    const body = parseBody(resendVerificationSchema, req.body);
    const email = body.email.toLowerCase();
    // Same response whether the account doesn't exist, is already verified, or SMTP isn't
    // configured -- don't let this endpoint be used to enumerate registered addresses either.
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerified && (await isSmtpConfigured())) {
      const verification = newVerificationToken();
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerificationToken: verification.token, emailVerificationExpires: verification.expires },
      });
      try {
        await sendVerificationEmail(user.email, user.displayName, verification.token);
      } catch (err) {
        console.error("[auth] Failed to resend verification email:", err);
      }
    }
    res.json({ message: "If that account needs verification, we've sent a new email." });
  }),
);

const updateProfileSchema = z
  .object({
    current_password: z.string().min(1, "Current password is required"),
    email: z.string().trim().email("Enter a valid email address").optional(),
    new_password: z.string().min(8, "Password must be at least 8 characters").optional(),
  })
  .refine((data) => data.email !== undefined || data.new_password !== undefined, { message: "Nothing to update" });

// Backs Profile's "Change email" and "Change password" pages -- one shared endpoint since both
// require the same current-password re-confirmation. An email change isn't applied immediately
// unless SMTP is unconfigured (same skip-verification exception /register uses): otherwise it's
// stashed in pendingEmail and only takes effect once the emailed link is clicked (POST
// /verify-email above).
router.patch(
  "/profile",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseBody(updateProfileSchema, req.body);
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user) throw new HttpError(401, "Invalid or expired token");
    if (!(await bcrypt.compare(body.current_password, user.passwordHash))) {
      // 403, not 401: this is the submitted current-password field being wrong, not the
      // session's own token -- the frontend's generic API client treats any 401 as "your
      // session expired" and force-logs-out, which would be exactly wrong here.
      throw new HttpError(403, "Current password is incorrect");
    }

    const data: Prisma.UserUpdateInput = {};
    let emailToVerify: string | null = null;
    let verification: { token: string; expires: Date } | null = null;

    if (body.email !== undefined) {
      const normalized = body.email.toLowerCase();
      if (normalized !== user.email) {
        const existing = await prisma.user.findUnique({ where: { email: normalized } });
        if (existing && existing.id !== user.id) {
          throw new HttpError(409, "An account with this email already exists");
        }
        if (await isSmtpConfigured()) {
          verification = newVerificationToken();
          data.pendingEmail = normalized;
          data.emailVerificationToken = verification.token;
          data.emailVerificationExpires = verification.expires;
          emailToVerify = normalized;
        } else {
          data.email = normalized;
          data.pendingEmail = null;
        }
      }
    }

    if (body.new_password !== undefined) {
      data.passwordHash = await bcrypt.hash(body.new_password, PASSWORD_HASH_COST);
    }

    if (Object.keys(data).length === 0) {
      res.json({ user: toUserOut(user) });
      return;
    }

    if (emailToVerify && verification) {
      try {
        await sendVerificationEmail(emailToVerify, user.displayName, verification.token);
      } catch {
        throw new HttpError(500, "Failed to send verification email. Please try again.");
      }
    }

    const updated = await prisma.user.update({ where: { id: user.id }, data });
    res.json({ user: toUserOut(updated) });
  }),
);

// Logins are stateless JWTs, so there's nothing server-side to invalidate here -- this endpoint
// exists purely to record the audit-log entry before the frontend clears its local token.
router.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ ok: true });
    void createLog({ userId: req.userId!, action: "user_logged_out" });
  }),
);

router.post(
  "/refresh",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user) throw new HttpError(401, "Invalid or expired token");
    const token = createToken(user.id, user.role);
    res.json({ token, expires_in: AUTH_TOKEN_TTL });
  }),
);

export default router;
