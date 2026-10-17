import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { AUTH_ALGO, AUTH_SECRET } from "./config";
import { getAuthTokenTtl } from "./services/settingsService";
import { findApiTokenUser, isApiToken } from "./services/apiTokenService";
import { asyncHandler } from "./utils/asyncHandler";
import { prisma } from "./db";

// sat: when the person last actually signed in, in seconds. A refreshed session keeps it, so "signed in a
// moment ago" can't be had by refreshing.
export type TokenPayload = { sub: string; role: Role; sat?: number };

/** How recent a sign-in must be to set a password or change email without the current password. */
export const RECENT_SIGN_IN_MS = 15 * 60 * 1000;

function createToken(userId: string, role: Role, ttlSeconds: number, signedInAt: Date): string {
  return jwt.sign({ sub: userId, role, sat: Math.floor(signedInAt.getTime() / 1000) }, AUTH_SECRET, {
    algorithm: AUTH_ALGO,
    expiresIn: ttlSeconds,
  });
}

/** Uses the admin-configured session length and returns it for `expires_in`. `signedInAt` is now for a sign-in. */
export async function issueToken(
  userId: string,
  role: Role,
  signedInAt: Date = new Date(),
): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = await getAuthTokenTtl();
  return { token: createToken(userId, role, expiresIn, signedInAt), expiresIn };
}

/** Whether this session's sign-in was recent enough to stand in for the current password. */
export function signedInRecently(req: Request): boolean {
  return Boolean(req.signedInAt && Date.now() - req.signedInAt.getTime() < RECENT_SIGN_IN_MS);
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, AUTH_SECRET, { algorithms: [AUTH_ALGO] }) as TokenPayload;
  } catch {
    return null;
  }
}

function headerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  return header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
}

/** `?token=` is for <img>/direct file links that can't set headers. */
export function extractToken(req: Request): string | undefined {
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  return headerToken(req) || queryToken;
}

// An API token may only read. That also keeps it from minting a session (POST /refresh) or
// replacing itself, so a leaked one can't be turned into anything more.
const API_TOKEN_METHODS = new Set(["GET", "HEAD"]);

export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);

  if (token && isApiToken(token)) {
    // Header only: a token in a URL ends up in proxy logs and browser history, and it lives for
    // months rather than a session.
    const user = token === headerToken(req) ? await findApiTokenUser(token) : null;
    if (!user) {
      res.status(401).json({ detail: "Unauthorized" });
      return;
    }
    if (!API_TOKEN_METHODS.has(req.method)) {
      res.status(403).json({ detail: "API tokens are read-only" });
      return;
    }
    req.userId = user.id;
    req.userRole = user.role;
    req.viaApiToken = true;
    next();
    return;
  }

  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    res.status(401).json({ detail: "Unauthorized" });
    return;
  }
  // Read afresh rather than trusted from the token, so a demotion or a deleted account takes effect at once
  // instead of when the token expires.
  const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { role: true } });
  if (!user) {
    res.status(401).json({ detail: "Unauthorized" });
    return;
  }
  req.userId = payload.sub;
  req.userRole = user.role;
  // Sessions from before this was recorded count as long ago.
  req.signedInAt = typeof payload.sat === "number" ? new Date(payload.sat * 1000) : new Date(0);
  next();
});

/** Must run after requireAuth. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  // Admin settings include instance secrets (SMTP, Thingiverse), which a dashboard never needs.
  if (req.userRole !== "ADMIN" || req.viaApiToken) {
    res.status(403).json({ detail: "Admin access required" });
    return;
  }
  next();
}
