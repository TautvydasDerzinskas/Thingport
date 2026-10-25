import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { AUTH_ALGO, AUTH_SECRET } from "./config";
import { getAuthTokenTtl } from "./services/settingsService";
import { findApiTokenUser, isApiToken } from "./services/apiTokenService";
import { scopeForPath } from "./services/apiTokenScopes";
import { asyncHandler } from "./utils/asyncHandler";
import { prisma } from "./db";

// sat: when the person last actually signed in, in seconds. A refreshed session keeps it, so "signed in a
// moment ago" can't be had by refreshing. sid: the browser session (services/sessionService.ts) it was issued
// from; Thingport Grab's tokens, and ones from before sessions, have none.
export type TokenPayload = { sub: string; role: Role; sat?: number; sid?: string };

/** How recent a sign-in must be to set a password or change email without the current password. */
export const RECENT_SIGN_IN_MS = 15 * 60 * 1000;

function createToken(userId: string, role: Role, ttlSeconds: number, signedInAt: Date, sessionId?: string): string {
  const sat = Math.floor(signedInAt.getTime() / 1000);
  return jwt.sign({ sub: userId, role, sat, ...(sessionId ? { sid: sessionId } : {}) }, AUTH_SECRET, {
    algorithm: AUTH_ALGO,
    expiresIn: ttlSeconds,
  });
}

/** Uses the admin-configured session length and returns it for `expires_in`. `signedInAt` is now for a sign-in. */
export async function issueToken(
  userId: string,
  role: Role,
  signedInAt: Date = new Date(),
  sessionId?: string,
): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = await getAuthTokenTtl();
  return { token: createToken(userId, role, expiresIn, signedInAt, sessionId), expiresIn };
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

export function headerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  return header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
}

/** `?token=` is for <img>/direct file links that can't set headers. */
export function extractToken(req: Request): string | undefined {
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  return headerToken(req) || queryToken || req.pathToken;
}

const PATH_TOKEN = /^\/api\/t\/([^/?]+)(\/[^?]*(?:\?.*)?)$/;

/** `/api/t/<token>/...` is `/api/...?token=<token>` for links handed to a slicer. OrcaSlicer and its forks name the
 *  downloaded file after everything past the URL's last slash, query string included, so a token there ends up in
 *  the filename -- long enough to fail with "File name too long". Reads only, like any token in a URL. */
export function pathToken(req: Request, _res: Response, next: NextFunction) {
  const match = req.method === "GET" || req.method === "HEAD" ? PATH_TOKEN.exec(req.url) : null;
  if (match) {
    try {
      req.pathToken = decodeURIComponent(match[1]);
      req.url = `/api${match[2]}`;
      // requireAuth picks an API token's scope from originalUrl, so it must name the route actually reached.
      req.originalUrl = req.url;
    } catch {
      // A malformed escape: left as is, the request 404s.
    }
  }
  next();
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
    const scope = scopeForPath(req.originalUrl.split("?")[0].replace(/^\/api(?=\/)/, ""));
    if (!user.apiTokenRestScopes.includes(scope)) {
      res.status(403).json({ detail: `This API token isn't allowed to read ${scope}`, scope });
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
  // Read afresh rather than trusted from the token, so a demotion, a deleted account or a signed-out session takes
  // effect at once instead of when the token expires.
  const [user, session] = await Promise.all([
    prisma.user.findUnique({ where: { id: payload.sub }, select: { role: true } }),
    payload.sid ? prisma.session.findUnique({ where: { id: payload.sid }, select: { userId: true } }) : null,
  ]);
  if (!user || (payload.sid && session?.userId !== payload.sub)) {
    res.status(401).json({ detail: "Unauthorized" });
    return;
  }
  req.userId = payload.sub;
  req.userRole = user.role;
  req.sessionId = payload.sid;
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
