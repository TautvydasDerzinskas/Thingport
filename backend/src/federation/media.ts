import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Response } from "express";
import { AUTH_SECRET, STORAGE } from "../config";
import { prisma } from "../db";
import { originOf } from "./addresses";
import { signedGet } from "./signedFetch";

/** A partner's pictures (avatars, covers, models'), fetched through this instance and kept, so a viewer's browser
 *  never talks to a partner. The address handed to the browser names the picture's own URL and is signed with this
 *  instance's secret: a user can't make the server fetch anything else, and only from a partner that's ACTIVE now. */

export const MEDIA_DIR = path.join(STORAGE, "federation-media");
const MAX_BYTES = 10 * 1024 * 1024;
// A picture no longer named is left this long, in case it's about to be sent. One being sent is safe anyway: removing
// a file leaves it readable to whoever has it open.
const PRUNE_AFTER_MS = 10 * 60 * 1000;
// Kept of one partner's pictures at most, the oldest fetched dropped first: they're fetched again if they're shown.
export const MEDIA_MAX_BYTES_PER_PEER = 1024 * 1024 * 1024;
// How long a forgotten partner's pictures stay turned away: by then its row is gone or no longer ACTIVE.
const FORGOTTEN_MS = 60 * 1000;

// Pictures being fetched, by partner: forgetting one waits for them, and keeps any that come after from being kept.
const fetching = new Map<string, Set<Promise<unknown>>>();
const forgotten = new Set<string>();
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"]);
// Relative to the API, as the other file addresses are: the web app adds the session, as an <img> sends no header.
export const MEDIA_ROUTE = "/explore/elsewhere/media";

const sign = (url: string) =>
  crypto.createHmac("sha256", AUTH_SECRET).update(`thingport-federation-media:${url}`).digest("base64url").slice(0, 32);

const mediaName = (url: string) => crypto.createHash("sha256").update(url).digest("hex");

/** Where a viewer's browser gets a partner's picture; null for none. */
export function mediaAddress(url: string | null | undefined): string | null {
  if (!url) return null;
  return `${MEDIA_ROUTE}/${Buffer.from(url).toString("base64url")}.${sign(url)}`;
}

/** The picture behind an address `mediaAddress` gave, from what's kept or fetched now. */
export async function sendRemoteMedia(token: string, res: Response, viewerId: string): Promise<void> {
  const notFound = () => void res.status(404).json({ detail: "Not found" });
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return notFound();
  const url = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = Buffer.from(sign(url));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return notFound();
  const origin = originOf(url);
  const peer = origin ? await prisma.peer.findUnique({ where: { origin }, select: { id: true, status: true } }) : null;
  if (!peer || peer.status !== "ACTIVE") return notFound();
  // Kept here or not, a picture only of what was shared with some people here is theirs alone.
  const access = await mayView(url, peer.id, viewerId);
  if (!access) return notFound();

  const file = path.join(MEDIA_DIR, peer.id, mediaName(url));
  let type = await fs.readFile(`${file}.type`, "utf8").catch(() => null);
  if (!type) {
    if (forgotten.has(peer.id)) return notFound();
    const fetched = fetchInto(url, origin!, file, peer.id).catch(() => null);
    const running = fetching.get(peer.id) ?? new Set<Promise<unknown>>();
    fetching.set(peer.id, running.add(fetched));
    try {
      type = await fetched;
    } finally {
      running.delete(fetched);
      if (!running.size && fetching.get(peer.id) === running) fetching.delete(peer.id);
    }
    if (!type) return notFound();
  }
  res.setHeader("Content-Type", type);
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Its address carries the partner's version of it, so it never changes under the same one. One only some people
  // may see isn't kept by the browser: someone else signing in there would get it from what's kept.
  res.setHeader("Cache-Control", access === "open" ? "private, max-age=31536000, immutable" : "private, no-store");
  if (type === "image/svg+xml")
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  res.sendFile(file, (err) => {
    if (err && !res.headersSent) notFound();
  });
}

/** Whether `viewerId` may see a partner's picture, of those a browser is handed (an avatar, a cover, a model's
 *  pictures): "open" while it's one of a person's kept here or of a model shared openly there; "limited" while it's
 *  only of models kept for collections shared with some people here and `viewerId` may open one of those; otherwise
 *  null, whoever has its address: one of something no longer kept here (taken off a list, say) is nobody's. */
async function mayView(url: string, peerId: string, viewerId: string): Promise<"open" | "limited" | null> {
  const [person, models] = await Promise.all([
    prisma.remotePerson.findFirst({
      where: { peerId, OR: [{ avatarUrl: url }, { coverUrl: url }] },
      select: { id: true },
    }),
    // By the index on the pictures (RemoteModel_images_idx).
    prisma.$queryRaw<{ apId: string; limited: boolean }[]>`
      SELECT "apId", limited FROM "RemoteModel" WHERE "peerId" = ${peerId} AND images @> ARRAY[${url}]::text[]`,
  ]);
  if (person || models.some((model) => !model.limited)) return "open";
  const { canSeeRemoteModel } = await import("./sharedCollections");
  for (const model of models) {
    if (await canSeeRemoteModel({ apId: model.apId, peerId, limited: true }, viewerId)) return "limited";
  }
  return null;
}

/** Fetches a picture, signed as this instance, from that partner only; its type, once it's kept. */
async function fetchInto(url: string, origin: string, file: string, peerId: string): Promise<string | null> {
  const response = await signedGet(url, origin, { accept: "image/*" });
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!response.ok || !TYPES.has(type) || Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (!reader) return null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  // Its partner forgotten meanwhile: nothing of it is kept.
  if (forgotten.has(peerId)) return null;
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Written aside and moved into place: a reader never sees half of it.
  const temp = `${file}.${crypto.randomUUID()}`;
  await fs.writeFile(temp, Buffer.concat(chunks));
  await fs.rename(temp, file);
  await fs.writeFile(`${file}.type`, type);
  return type;
}

/** Everything of a partner's pictures, on disconnecting or blocking it: once the ones being fetched are done, and
 *  turning away any asked for meanwhile, so none is written back after. */
export async function forgetMedia(peerId: string): Promise<void> {
  forgotten.add(peerId);
  setTimeout(() => forgotten.delete(peerId), FORGOTTEN_MS).unref();
  await Promise.allSettled(fetching.get(peerId) ?? []);
  await fs.rm(path.join(MEDIA_DIR, peerId), { recursive: true, force: true }).catch(() => {});
}

/** A partner's pictures kept here that nothing of it names any more -- an older version of one, or one of something no
 *  longer shared -- and beyond `maxBytes` of them, the oldest fetched. After every read of the partner. */
export async function pruneMedia(peerId: string, maxBytes = MEDIA_MAX_BYTES_PER_PEER): Promise<void> {
  const dir = path.join(MEDIA_DIR, peerId);
  const names = await fs.readdir(dir).catch(() => null);
  if (!names?.length) return;
  const [people, models] = await Promise.all([
    prisma.remotePerson.findMany({ where: { peerId }, select: { avatarUrl: true, coverUrl: true } }),
    prisma.remoteModel.findMany({ where: { peerId }, select: { images: true } }),
  ]);
  const named = new Set(
    [...people.flatMap((person) => [person.avatarUrl, person.coverUrl]), ...models.flatMap((model) => model.images)]
      .filter((url): url is string => Boolean(url))
      .map(mediaName),
  );
  const before = Date.now() - PRUNE_AFTER_MS;
  const kept: { name: string; size: number; at: number }[] = [];
  for (const name of names) {
    // The picture, its type, and one being written: each named after the picture first.
    const [picture, suffix] = name.split(".");
    const stat = await fs.stat(path.join(dir, name)).catch(() => null);
    if (!stat) continue;
    if (!named.has(picture) && stat.mtimeMs < before) {
      await fs.rm(path.join(dir, name), { force: true }).catch(() => {});
    } else if (!suffix) {
      kept.push({ name, size: stat.size, at: stat.mtimeMs });
    }
  }
  let total = kept.reduce((sum, file) => sum + file.size, 0);
  for (const file of kept.toSorted((a, b) => a.at - b.at)) {
    if (total <= maxBytes) break;
    // Its type first: without one, it's fetched again rather than sent.
    await fs.rm(path.join(dir, `${file.name}.type`), { force: true }).catch(() => {});
    await fs.rm(path.join(dir, file.name), { force: true }).catch(() => {});
    total -= file.size;
  }
}
