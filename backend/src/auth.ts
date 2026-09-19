import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { AUTH_ALGO, AUTH_SECRET } from "./config";
import { getAuthTokenTtl } from "./services/settingsService";

export type TokenPayload = { sub: string; role: Role };

function createToken(userId: string, role: Role, ttlSeconds: number): string {
  return jwt.sign({ sub: userId, role }, AUTH_SECRET, {
    algorithm: AUTH_ALGO,
    expiresIn: ttlSeconds,
  });
}

/** Signs a fresh JWT for `userId`, using the instance's current session length (admin-configurable
 *  -- see settingsService.ts's getAuthTokenTtl / AdminSettingsPage's Session section) -- and
 *  returns that same length alongside it so the caller can echo it back as the login response's
 *  `expires_in`. Every route that issues a token (register/login/verify-email/refresh) goes
 *  through this instead of calling createToken directly. */
export async function issueToken(userId: string, role: Role): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = await getAuthTokenTtl();
  return { token: createToken(userId, role, expiresIn), expiresIn };
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, AUTH_SECRET, { algorithms: [AUTH_ALGO] }) as TokenPayload;
  } catch {
    return null;
  }
}

/** Accepts either an `Authorization: Bearer <token>` header or a `?token=` query param
 * (needed for <img>/direct file links that can't set headers). */
export function extractToken(req: Request): string | undefined {
  const header = req.header("authorization");
  const headerToken = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  return headerToken || queryToken;
}

/** Every route in this app requires a real account -- there's no "auth disabled" mode, since
 * there'd be no way to resolve which user's data a request is even asking about. Attaches the
 * token's subject/role to the request so handlers can scope their queries. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    res.status(401).json({ detail: "Unauthorized" });
    return;
  }
  req.userId = payload.sub;
  req.userRole = payload.role;
  next();
}

/** Must run after requireAuth. For routes whose effect isn't confined to the caller's own
 * data (e.g. an instance-wide storage template affecting every user's files). */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.userRole !== "ADMIN") {
    res.status(403).json({ detail: "Admin access required" });
    return;
  }
  next();
}
