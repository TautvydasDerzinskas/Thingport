import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db";
import { isExtensionRequest } from "./captchaService";

// When Thingport Grab last reached this instance, for System Health. A web page can't ask whether an extension is
// installed, but Grab makes requests of its own here.

export type Client = "grab";

const SETTING_KEY: Record<Client, string> = { grab: "client_seen_grab" };
// Grab makes requests all day; the last-seen time only needs to be roughly right.
const WRITE_EVERY_MS = 10 * 60 * 1000;
const lastWritten = new Map<Client, number>();

function record(client: Client) {
  const now = Date.now();
  if (now - (lastWritten.get(client) ?? 0) < WRITE_EVERY_MS) return;
  lastWritten.set(client, now);
  const value = { seen_at: new Date(now).toISOString() };
  // Never holds up or breaks the request it was seen on.
  void prisma.setting
    .upsert({ where: { key: SETTING_KEY[client] }, create: { key: SETTING_KEY[client], value }, update: { value } })
    .catch(() => lastWritten.delete(client));
}

export function trackClients(req: Request, _res: Response, next: NextFunction) {
  if (isExtensionRequest(req)) record("grab");
  next();
}

export async function clientLastSeen(client: Client): Promise<Date | null> {
  const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY[client] } });
  const seen = (row?.value as { seen_at?: string } | undefined)?.seen_at;
  return seen ? new Date(seen) : null;
}

/** For tests: forget what was written, so the next request records again. */
export function resetClientTracking() {
  lastWritten.clear();
}
