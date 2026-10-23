import crypto from "node:crypto";
import type { Request, Response } from "express";
import type { Role, Session } from "@prisma/client";
import { headerToken, issueToken, verifyToken } from "../auth";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { getAuthTokenTtl, getRememberSessionTtl } from "./settingsService";

// A browser's sign-in outlives its access token: the token sits in localStorage and runs out, the session's secret
// sits in an httpOnly cookie that only /api/refresh and /api/logout act on. A browser's homepage, opened once a
// day and closed again, never stays open long enough to renew its token before it expires -- with the cookie it
// gets a new one instead of the sign-in form.

const COOKIE = "thingport_session";
// /api/refresh and /api/logout share no narrower path.
const COOKIE_PATH = "/api";

const hashSecret = (secret: string) => crypto.createHash("sha256").update(secret).digest("hex");
const newSecret = () => crypto.randomBytes(32).toString("base64url");

/** Never shorter than the access token, so turning remembering off leaves a session that lasts as long as it. */
async function sessionLifetimeSeconds(): Promise<number> {
  const [remember, access] = await Promise.all([getRememberSessionTtl(), getAuthTokenTtl()]);
  return Math.max(remember, access);
}

// nginx in front of the backend passes the scheme on. A Secure cookie sent over plain http is dropped, which would
// leave a LAN install at http://192.168.x.x unable to stay signed in.
function isHttps(req: Request): boolean {
  const forwarded = req.header("x-forwarded-proto")?.split(",")[0].trim();
  return forwarded ? forwarded === "https" : req.secure;
}

function setSessionCookie(req: Request, res: Response, secret: string, maxAgeSeconds: number): void {
  const secure = isHttps(req) ? "; Secure" : "";
  // Strict: no other site can have the browser send it, not even a link to Thingport.
  res.append(
    "Set-Cookie",
    `${COOKIE}=${secret}; Path=${COOKIE_PATH}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secure}`,
  );
}

function clearSessionCookie(res: Response): void {
  res.append("Set-Cookie", `${COOKIE}=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Strict`);
}

function cookieSecret(req: Request): string | undefined {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE && value.length) return value.join("=") || undefined;
  }
  return undefined;
}

type SessionUser = { id: string; role: Role };

/** Signs the user in on this browser: a session in a cookie, and the access token it starts with. */
export async function startSession(
  req: Request,
  res: Response,
  user: SessionUser,
  signedInAt: Date = new Date(),
): Promise<{ token: string; expiresIn: number }> {
  const lifetime = await sessionLifetimeSeconds();
  const secret = newSecret();
  const [, session] = await prisma.$transaction([
    // Sweeps up the user's sessions nobody came back to; there's no other cleanup.
    prisma.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } }),
    prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashSecret(secret),
        signedInAt,
        expiresAt: new Date(Date.now() + lifetime * 1000),
      },
    }),
  ]);
  setSessionCookie(req, res, secret, lifetime);
  return issueToken(user.id, user.role, signedInAt, session.id);
}

/** Pushes the session's expiry on, and gives the browser a new secret when the one it holds isn't this session's. */
async function renewSession(req: Request, res: Response, session: Session, secret: string | null): Promise<void> {
  const lifetime = await sessionLifetimeSeconds();
  const kept = secret && hashSecret(secret) === session.tokenHash ? secret : newSecret();
  await prisma.session.update({
    where: { id: session.id },
    data: {
      tokenHash: hashSecret(kept),
      lastUsedAt: new Date(),
      expiresAt: new Date(Date.now() + lifetime * 1000),
    },
  });
  setSessionCookie(req, res, kept, lifetime);
}

/**
 * A new access token, from the one the browser still holds or, once that has run out, from the session's cookie.
 * Tokens from before sessions existed get a session here, so whoever was signed in at the upgrade stays signed in.
 */
export async function refreshSession(req: Request, res: Response) {
  const secret = cookieSecret(req) ?? null;
  const bearer = headerToken(req);
  const payload = bearer ? verifyToken(bearer) : null;

  if (payload) {
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new HttpError(401, "Invalid or expired token");
    const signedInAt = typeof payload.sat === "number" ? new Date(payload.sat * 1000) : new Date(0);
    if (!payload.sid) return { ...(await startSession(req, res, user, signedInAt)), user };
    const session = await prisma.session.findUnique({ where: { id: payload.sid } });
    if (!session || session.userId !== user.id) throw new HttpError(401, "Invalid or expired token");
    await renewSession(req, res, session, secret);
    return { ...(await issueToken(user.id, user.role, session.signedInAt, session.id)), user };
  }

  if (!secret) throw new HttpError(401, "Invalid or expired token");
  // SameSite=Strict already keeps other sites out, but a site is every subdomain of it: a homelab's other apps
  // on *.home.lan could otherwise have this browser trade its cookie for a token.
  const fetchSite = req.header("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") throw new HttpError(403, "Refreshing a session is same-origin only");
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSecret(secret) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) {
    clearSessionCookie(res);
    throw new HttpError(401, "Invalid or expired token");
  }
  await renewSession(req, res, session, secret);
  const { token, expiresIn } = await issueToken(session.user.id, session.user.role, session.signedInAt, session.id);
  return { token, expiresIn, user: session.user };
}

/** Signs this browser out: its session, found by its token or its cookie, is deleted. The user, when known. */
export async function endSession(req: Request, res: Response): Promise<string | null> {
  clearSessionCookie(res);
  const bearer = headerToken(req);
  const payload = bearer ? verifyToken(bearer) : null;
  const secret = cookieSecret(req);
  const where = [
    ...(payload?.sid ? [{ id: payload.sid, userId: payload.sub }] : []),
    ...(secret ? [{ tokenHash: hashSecret(secret) }] : []),
  ];
  if (!where.length) return payload?.sub ?? null;
  const sessions = await prisma.session.findMany({ where: { OR: where }, select: { id: true, userId: true } });
  await prisma.session.deleteMany({ where: { id: { in: sessions.map((s) => s.id) } } });
  return payload?.sub ?? sessions[0]?.userId ?? null;
}

/** Signs the user out everywhere else, as after a password change. */
export async function endOtherSessions(userId: string, keepSessionId?: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) } });
}
