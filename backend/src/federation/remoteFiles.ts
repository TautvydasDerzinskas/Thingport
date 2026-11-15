import crypto from "node:crypto";
import { canSeeRemoteModel } from "./sharedCollections";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Peer, RemoteModel, RemotePerson } from "@prisma/client";
import type { Request, Response as ExpressResponse } from "express";
import { IMPORT_MAX_BYTES } from "../config";
import { prisma } from "../db";
import { HttpError, sanitizeFilename } from "../utils/fileUtils";
import { folderPath, normalizeFolder } from "../utils/fileFolder";
import { writeZip } from "../utils/zipWriter";
import { originOf } from "./addresses";
import type { RemoteFileDetails } from "./remoteIndex";
import { signedGet } from "./signedFetch";

/** A partner's model's files, through this instance: streamed to a viewer to download or open in a slicer, fetched
 *  whole to zip them or copy them (remoteCopy.ts). Never kept: what's in a viewer's library is their own copy. Only
 *  from an ACTIVE partner, and only the addresses its own model document gave, on its own origin. */

export type RemoteFile = {
  name: string;
  size: number | null;
  mediaType: string | null;
  url: string | null;
} & RemoteFileDetails;
export type RemoteModelRow = RemoteModel & { peer: Peer; person: RemotePerson };

// However long a big file takes; the connection's own idle limit still ends one that stalls.
const TRANSFER_MS = 30 * 60 * 1000;

/** A partner's model `viewerId` may open: one shared openly there, or in a collection shared with them. 404 for any
 *  other. */
export async function activeRemoteModel(id: string, viewerId: string): Promise<RemoteModelRow> {
  const model = await prisma.remoteModel.findFirst({
    where: { id, peer: { status: "ACTIVE" } },
    include: { peer: true, person: true },
  });
  if (!model || !(await canSeeRemoteModel(model, viewerId))) throw new HttpError(404, "Not found");
  return model;
}

/** The model's files as the index has them; `url` only where it's on the partner's own origin, as remoteIndex.ts
 *  keeps them: anything else is never fetched. */
export function filesOf(model: Pick<RemoteModel, "files">, origin: string): RemoteFile[] {
  const list = Array.isArray(model.files) ? (model.files as Record<string, unknown>[]) : [];
  const own = (url: unknown): url is string => typeof url === "string" && originOf(url) === origin;
  return list.map((file) => ({
    name: typeof file.name === "string" ? file.name : "file",
    size: typeof file.size === "number" ? file.size : null,
    mediaType: typeof file.mediaType === "string" ? file.mediaType : null,
    url: own(file.url) ? file.url : null,
    // As remoteIndex.ts checked them; a row from before has none.
    kind: file.kind === "plate" || file.kind === "file" ? file.kind : undefined,
    role: file.role === "SUPPORTING" || file.role === "PREPARED" ? file.role : undefined,
    profileId: typeof file.profileId === "string" ? file.profileId : undefined,
    profile: isProfile(file.profile) ? file.profile : undefined,
    thumb: own(file.thumb) ? file.thumb : undefined,
    thumbGenerated: own(file.thumb) && file.thumbGenerated === true ? true : undefined,
    folder: (typeof file.folder === "string" && normalizeFolder(file.folder)) || undefined,
  }));
}

const isProfile = (value: unknown): value is NonNullable<RemoteFileDetails["profile"]> =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { version?: unknown }).version === "number" &&
  typeof (value as { facts?: unknown }).facts === "object" &&
  (value as { facts?: unknown }).facts !== null;

/** A file's key in the address a viewer gets, from its own address at the partner: a read that reorders the model's
 *  files never turns an address handed out into another file, and one no longer shared answers 404. */
export const fileKey = (url: string) => crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);

function fileAt(model: RemoteModelRow, index: number): RemoteFile & { url: string } {
  const file = filesOf(model, model.peer.origin)[index];
  if (!file?.url) throw new HttpError(404, "Not found");
  return file as RemoteFile & { url: string };
}

async function fetchFile(model: RemoteModelRow, file: { url: string }, signal: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await signedGet(file.url, model.peer.origin, { signal });
  } catch (err) {
    throw new HttpError(502, `Couldn't reach ${new URL(model.peer.origin).host}: ${(err as Error).message}`);
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new HttpError(response.status === 404 ? 404 : 502, `${new URL(model.peer.origin).host} didn't send the file`);
  }
  return response;
}

/** Aborted once the viewer is gone, whenever that is: the response closing before it's finished. */
function untilGone(req: Request, res: ExpressResponse): AbortController {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  if (res.destroyed || req.socket?.destroyed) controller.abort();
  return controller;
}

/** One file, by its key (`fileKey`), streamed from the partner to the viewer as it comes. */
export async function streamRemoteFile(
  req: Request,
  res: ExpressResponse,
  modelId: string,
  key: string,
): Promise<void> {
  const model = await activeRemoteModel(modelId, req.userId!);
  const file = filesOf(model, model.peer.origin).find((item) => item.url && fileKey(item.url) === key);
  if (!file?.url) throw new HttpError(404, "Not found");
  const viewer = untilGone(req, res);
  const response = await fetchFile(
    model,
    { url: file.url },
    AbortSignal.any([viewer.signal, AbortSignal.timeout(TRANSFER_MS)]),
  );
  res.attachment(file.name);
  res.setHeader("Content-Type", file.mediaType || "application/octet-stream");
  // A proxy in front of the partner may compress it: fetch unpacks it, so its length isn't this one's.
  const length = response.headers.get("content-encoding") ? null : response.headers.get("content-length");
  if (length) res.setHeader("Content-Length", length);
  res.setHeader("X-Content-Type-Options", "nosniff");
  await pipeline(Readable.fromWeb(response.body as never), res).catch(() => {});
}

/** One file, fetched whole into `dest`, no bigger than `maxBytes` (an import's most by default). `onProgress` hears the
 *  bytes so far; `signal` stops it. */
export async function fetchRemoteFile(
  model: RemoteModelRow,
  index: number,
  dest: string,
  options: { onProgress?: (received: number) => void; signal?: AbortSignal; maxBytes?: number } = {},
): Promise<RemoteFile> {
  const file = fileAt(model, index);
  const maxBytes = Math.min(options.maxBytes ?? IMPORT_MAX_BYTES, IMPORT_MAX_BYTES);
  const tooBig = () => new HttpError(413, `${file.name} is bigger than this instance takes`, "too_large");
  const signal = AbortSignal.any([AbortSignal.timeout(TRANSFER_MS), ...(options.signal ? [options.signal] : [])]);
  const response = await fetchFile(model, file, signal);
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw tooBig();
  }
  let received = 0;
  const counted = Readable.fromWeb(response.body as never);
  counted.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > maxBytes) counted.destroy(tooBig());
    options.onProgress?.(received);
  });
  await pipeline(counted, fs.createWriteStream(dest));
  return file;
}

// ZIPs made at once on this instance, and by one person: each holds its files and the ZIP on disk until it's sent.
const MAX_ZIPS = 2;
const zipping = new Set<string>();

/** Every file of the model, fetched and zipped for `userId`, then sent: all of them no bigger than an import, and
 *  given up as soon as the viewer is gone. */
export async function sendRemoteZip(
  req: Request,
  res: ExpressResponse,
  modelId: string,
  userId: string,
): Promise<void> {
  const model = await activeRemoteModel(modelId, userId);
  const files = filesOf(model, model.peer.origin);
  if (!files.some((file) => file.url)) throw new HttpError(404, "No files available for download");
  const known = files.reduce((sum, file) => sum + (file.url ? (file.size ?? 0) : 0), 0);
  if (known > IMPORT_MAX_BYTES) {
    throw new HttpError(413, "Too big to zip here: download its files one at a time", "zip_too_big");
  }
  if (zipping.has(userId) || zipping.size >= MAX_ZIPS) {
    throw new HttpError(429, "Another ZIP is being made: try again in a moment", "zip_busy");
  }
  zipping.add(userId);
  const viewer = untilGone(req, res);
  const zipPath = path.join(os.tmpdir(), `thingport-zip-${crypto.randomBytes(8).toString("hex")}.zip`);
  let dir: string | null = null;
  try {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "thingport-remote-zip-"));
    const taken = new Set<string>();
    const entries: { arcname: string; filePath: string }[] = [];
    let total = 0;
    for (const [index, file] of files.entries()) {
      if (!file.url) continue;
      if (viewer.signal.aborted) throw new Error("The viewer left");
      const dest = path.join(dir, `${index}`);
      await fetchRemoteFile(model, index, dest, { signal: viewer.signal, maxBytes: IMPORT_MAX_BYTES - total });
      total += (await fsp.stat(dest)).size;
      // In its folder, as the partner keeps it. Two files may still share a place: the later one gets a number.
      const name = sanitizeFilename(file.name) || `file-${index}`;
      let arcname = folderPath(file.folder, name);
      for (let n = 2; taken.has(arcname); n++) arcname = folderPath(file.folder, `${n}-${name}`);
      taken.add(arcname);
      entries.push({ arcname, filePath: dest });
    }
    if (viewer.signal.aborted) throw new Error("The viewer left");
    await writeZip(zipPath, entries);
  } catch (err) {
    zipping.delete(userId);
    await fsp.rm(zipPath, { force: true });
    throw err;
  } finally {
    if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  res.download(zipPath, `${sanitizeFilename(model.title) || "model"}.zip`, () => {
    zipping.delete(userId);
    fs.rm(zipPath, { force: true }, () => undefined);
  });
}
