import crypto from "node:crypto";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";

// Connecting Thingport Grab without giving it a password. The extension makes a secret (the verifier), opens
// Thingport with its hash (the challenge), and the signed-in user approves it there. Approving hands the page a
// short-lived code, which the extension reads off its tab and trades, with the verifier, for a token of its own.
// The code is useless without the verifier, which never leaves the extension.

const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
const TOKEN_PREFIX = "tpg_";
// base64url SHA-256, as the extension sends it.
export const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const codes = new Map<string, { userId: string; challenge: string; name: string; expiresAt: number }>();

function prune(): void {
  const now = Date.now();
  for (const [code, entry] of codes) if (entry.expiresAt < now) codes.delete(code);
}

const sha256 = (value: string, encoding: "hex" | "base64url") =>
  crypto.createHash("sha256").update(value).digest(encoding);

/** The user approved this browser's Grab: a code for its tab to pass back to it. */
export function approvePairing(userId: string, challenge: string, name: string): string {
  prune();
  const code = crypto.randomBytes(24).toString("base64url");
  codes.set(code, { userId, challenge, name, expiresAt: Date.now() + PAIRING_CODE_TTL_MS });
  return code;
}

/** Trades an approved code and the extension's verifier for a connection; the token is only in this result. */
export async function claimPairing(code: string, verifier: string): Promise<{ token: string; userId: string }> {
  prune();
  const entry = codes.get(code);
  // One try: a wrong verifier means someone else has the code.
  codes.delete(code);
  if (!entry || sha256(verifier, "base64url") !== entry.challenge) {
    throw new HttpError(400, "This connection request has expired or doesn't match. Start again from Thingport Grab.");
  }
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  await prisma.grabConnection.create({
    data: { userId: entry.userId, tokenHash: sha256(token, "hex"), name: entry.name },
  });
  return { token, userId: entry.userId };
}

/** Whose Grab this token is; null once the user removed the connection (or it never was one). */
export async function grabConnectionUser(token: string) {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const connection = await prisma.grabConnection.findUnique({
    where: { tokenHash: sha256(token, "hex") },
    include: { user: true },
  });
  if (!connection) return null;
  await prisma.grabConnection.update({ where: { id: connection.id }, data: { lastUsedAt: new Date() } });
  return connection.user;
}
