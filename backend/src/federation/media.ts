import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Response } from "express";
import { AUTH_SECRET } from "../config";
import { prisma } from "../db";
import { originOf } from "./addresses";
import { federationFetch } from "./fetch";
import { MEDIA_DIR } from "./remoteIndex";
import { getRuntime } from "./runtime";

/** A partner's pictures (avatars, covers, models'), fetched through this instance and kept, so a viewer's browser
 *  never talks to a partner. The address handed to the browser names the picture's own URL and is signed with this
 *  instance's secret: a user can't make the server fetch anything else, and only from a partner that's ACTIVE now. */

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"]);
// Relative to the API, as the other file addresses are: the web app adds the session, as an <img> sends no header.
export const MEDIA_ROUTE = "/explore/elsewhere/media";

const sign = (url: string) =>
  crypto.createHmac("sha256", AUTH_SECRET).update(`thingport-federation-media:${url}`).digest("base64url").slice(0, 32);

/** Where a viewer's browser gets a partner's picture; null for none. */
export function mediaAddress(url: string | null | undefined): string | null {
  if (!url) return null;
  return `${MEDIA_ROUTE}/${Buffer.from(url).toString("base64url")}.${sign(url)}`;
}

/** The picture behind an address `mediaAddress` gave, from what's kept or fetched now. */
export async function sendRemoteMedia(token: string, res: Response): Promise<void> {
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

  const name = crypto.createHash("sha256").update(url).digest("hex");
  const file = path.join(MEDIA_DIR, peer.id, name);
  let type = await fs.readFile(`${file}.type`, "utf8").catch(() => null);
  if (!type) {
    type = await fetchInto(url, origin!, file).catch(() => null);
    if (!type) return notFound();
  }
  res.setHeader("Content-Type", type);
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Its address carries the partner's version of it, so it never changes under the same one.
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  if (type === "image/svg+xml")
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  res.sendFile(file, (err) => {
    if (err && !res.headersSent) notFound();
  });
}

/** Fetches a picture, signed as this instance, from that partner only; its type, once it's kept. */
async function fetchInto(url: string, origin: string, file: string): Promise<string | null> {
  const runtime = await getRuntime();
  const signed = await runtime.fedify.signRequest(
    new Request(url, { headers: { Accept: "image/*" } }),
    runtime.keys.rsa.privateKey as never,
    runtime.keyId,
  );
  const response = await federationFetch(url, { headers: signed.headers }, (allowed) => allowed === origin);
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
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Written aside and moved into place: a reader never sees half of it.
  const temp = `${file}.${crypto.randomUUID()}`;
  await fs.writeFile(temp, Buffer.concat(chunks));
  await fs.rename(temp, file);
  await fs.writeFile(`${file}.type`, type);
  return type;
}
