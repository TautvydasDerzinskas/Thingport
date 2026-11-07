import crypto from "node:crypto";
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
import { writeZip } from "../utils/zipWriter";
import { originOf } from "./addresses";
import { signedGet } from "./signedFetch";

/** A partner's model's files, through this instance: streamed to a viewer to download or open in a slicer, fetched
 *  whole to zip them or copy them (remoteCopy.ts). Never kept: what's in a viewer's library is their own copy. Only
 *  from an ACTIVE partner, and only the addresses its own model document gave, on its own origin. */

export type RemoteFile = { name: string; size: number | null; mediaType: string | null; url: string | null };
export type RemoteModelRow = RemoteModel & { peer: Peer; person: RemotePerson };

// However long a big file takes; the connection's own idle limit still ends one that stalls.
const TRANSFER_MS = 30 * 60 * 1000;

export async function activeRemoteModel(id: string): Promise<RemoteModelRow> {
  const model = await prisma.remoteModel.findFirst({
    where: { id, peer: { status: "ACTIVE" } },
    include: { peer: true, person: true },
  });
  if (!model) throw new HttpError(404, "Not found");
  return model;
}

/** The model's files as the index has them; `url` only where it's on the partner's own origin, as remoteIndex.ts
 *  keeps them: anything else is never fetched. */
export function filesOf(model: Pick<RemoteModel, "files">, origin: string): RemoteFile[] {
  const list = Array.isArray(model.files) ? (model.files as Record<string, unknown>[]) : [];
  return list.map((file) => ({
    name: typeof file.name === "string" ? file.name : "file",
    size: typeof file.size === "number" ? file.size : null,
    mediaType: typeof file.mediaType === "string" ? file.mediaType : null,
    url: typeof file.url === "string" && originOf(file.url) === origin ? file.url : null,
  }));
}

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

/** One file, streamed from the partner to the viewer as it comes. */
export async function streamRemoteFile(
  req: Request,
  res: ExpressResponse,
  modelId: string,
  index: number,
): Promise<void> {
  const model = await activeRemoteModel(modelId);
  const file = fileAt(model, index);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSFER_MS);
  // The viewer gone: so is the fetch.
  req.on("close", () => controller.abort());
  try {
    const response = await fetchFile(model, file, controller.signal);
    res.attachment(file.name);
    res.setHeader("Content-Type", file.mediaType || "application/octet-stream");
    // A proxy in front of the partner may compress it: fetch unpacks it, so its length isn't this one's.
    const length = response.headers.get("content-encoding") ? null : response.headers.get("content-length");
    if (length) res.setHeader("Content-Length", length);
    res.setHeader("X-Content-Type-Options", "nosniff");
    await pipeline(Readable.fromWeb(response.body as never), res).catch(() => {});
  } finally {
    clearTimeout(timer);
  }
}

/** One file, fetched whole into `dest`, no bigger than an import may be. `onProgress` hears the bytes so far. */
export async function fetchRemoteFile(
  model: RemoteModelRow,
  index: number,
  dest: string,
  onProgress?: (received: number) => void,
): Promise<RemoteFile> {
  const file = fileAt(model, index);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSFER_MS);
  try {
    const response = await fetchFile(model, file, controller.signal);
    if (Number(response.headers.get("content-length") ?? 0) > IMPORT_MAX_BYTES) {
      await response.body?.cancel().catch(() => {});
      throw new HttpError(413, `${file.name} is bigger than this instance takes`);
    }
    let received = 0;
    const counted = Readable.fromWeb(response.body as never);
    counted.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > IMPORT_MAX_BYTES)
        counted.destroy(new HttpError(413, `${file.name} is bigger than this instance takes`));
      onProgress?.(received);
    });
    await pipeline(counted, fs.createWriteStream(dest));
    return file;
  } finally {
    clearTimeout(timer);
  }
}

/** Every file of the model, fetched and zipped, then sent. */
export async function sendRemoteZip(res: ExpressResponse, modelId: string): Promise<void> {
  const model = await activeRemoteModel(modelId);
  const files = filesOf(model, model.peer.origin);
  if (!files.some((file) => file.url)) throw new HttpError(404, "No files available for download");
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "thingport-remote-zip-"));
  const zipPath = path.join(os.tmpdir(), `thingport-zip-${crypto.randomBytes(8).toString("hex")}.zip`);
  try {
    const taken = new Set<string>();
    const entries: { arcname: string; filePath: string }[] = [];
    for (const [index, file] of files.entries()) {
      if (!file.url) continue;
      const dest = path.join(dir, `${index}`);
      await fetchRemoteFile(model, index, dest);
      // Two files may share a name: the later one gets a number.
      let arcname = sanitizeFilename(file.name) || `file-${index}`;
      for (let n = 2; taken.has(arcname); n++) arcname = `${n}-${sanitizeFilename(file.name)}`;
      taken.add(arcname);
      entries.push({ arcname, filePath: dest });
    }
    await writeZip(zipPath, entries);
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rm(zipPath, { force: true });
    throw err;
  }
  await fsp.rm(dir, { recursive: true, force: true });
  res.download(zipPath, `${sanitizeFilename(model.title) || "model"}.zip`, () => {
    fs.rm(zipPath, { force: true }, () => undefined);
  });
}
