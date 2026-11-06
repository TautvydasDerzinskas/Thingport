import net from "node:net";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db";
import { classifyIp, originOf } from "./addresses";
import { storeIncomingRequest } from "./peers";
import { getRuntime, INSTANCE } from "./runtime";

/** The key id a signed request names, from either kind of HTTP signature. */
export function keyIdOf(headers: Request["headers"]): string | null {
  const cavage = headers.signature;
  const fromCavage = typeof cavage === "string" ? /keyId="([^"]+)"/.exec(cavage) : null;
  if (fromCavage) return fromCavage[1];
  const input = headers["signature-input"];
  const fromRfc = typeof input === "string" ? /keyid="([^"]+)"/.exec(input) : null;
  return fromRfc ? fromRfc[1] : null;
}

/** The headers a request came with, as Fedify must see them: `Host` as this instance's Public URL names it, since a
 *  proxy in front may have dropped the port the sender signed. */
export function canonicalHeaders(headers: Request["headers"], origin: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") out[name] = value;
    else if (Array.isArray(value)) out[name] = value.join(", ");
  }
  out.host = new URL(origin).host;
  return out;
}

/** In front of the inbox, before Fedify reads anything: a partner's request goes through to be verified; a blocked
 *  instance's is dropped without a word; a paused one's is turned away to be retried later. From anyone else only a
 *  request to connect is taken, kept as it came for an admin, and nothing it names is fetched. */
export async function edgeFilter(req: Request, res: Response, next: NextFunction): Promise<void> {
  const keyId = keyIdOf(req.headers);
  const origin = keyId ? originOf(keyId) : null;
  if (!origin) {
    res.status(401).json({ error: "Unsigned" });
    return;
  }
  const peer = await prisma.peer.findUnique({ where: { origin }, select: { status: true } });
  if (peer?.status === "BLOCKED") {
    res.status(202).end();
    return;
  }
  if (peer?.status === "PAUSED") {
    res.status(503).set("Retry-After", "3600").json({ error: "Paused" });
    return;
  }
  if (peer) {
    next();
    return;
  }

  const runtime = await getRuntime();
  const host = new URL(origin).hostname.replace(/^\[|\]$/g, "");
  // Nothing at such an address could ever be a partner: not worth an admin's look.
  if (net.isIP(host) && classifyIp(host) === "never") {
    res.status(401).json({ error: "Not a connected instance" });
    return;
  }
  if (req.path !== "/inbox" && req.path !== `/actors/${INSTANCE}/inbox`) {
    res.status(401).json({ error: "Not a connected instance" });
    return;
  }
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  let follow: Record<string, unknown>;
  try {
    follow = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    res.status(400).json({ error: "Not JSON" });
    return;
  }
  const idOf = (value: unknown): string | null =>
    typeof value === "string"
      ? value
      : value && typeof value === "object"
        ? (((value as { id?: unknown }).id as string) ?? null)
        : null;
  const actor = idOf(follow.actor);
  if (
    follow.type !== "Follow" ||
    !actor ||
    originOf(actor) !== origin ||
    idOf(follow.object) !== runtime.actorUrl.href
  ) {
    res.status(401).json({ error: "Not a connected instance" });
    return;
  }
  const outcome = await storeIncomingRequest({
    origin,
    url: `${runtime.origin}${req.originalUrl}`,
    headers: canonicalHeaders(req.headers, runtime.origin),
    raw,
    follow,
  });
  if (outcome === "full") {
    res.status(429).json({ error: "Too many requests waiting" });
    return;
  }
  res.status(202).end();
}
