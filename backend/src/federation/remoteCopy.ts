import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { IMPORT_MAX_BYTES } from "../config";
import { prisma } from "../db";
import { createLog } from "../services/auditLog";
import { addPreviewImage } from "../services/previewImageService";
import { createUploadedModel, type UploadedFile } from "../services/uploadService";
import { HttpError, sanitizeFilename } from "../utils/fileUtils";
import { activeRemoteModel, fetchRemoteFile, filesOf, type RemoteModelRow } from "./remoteFiles";
import { signedGet } from "./signedFetch";

/** A partner's model copied into a viewer's library: its files, pictures and description fetched through this instance,
 *  made into a model of the viewer's own, and marked with where it came from (`Print.remoteSource`), so it says so and
 *  the original offers it again rather than another copy. It runs in the background, file by file, and the page asks
 *  how it's going: leaving the page doesn't stop it. A copy is made only once every file is here, so one cut short
 *  leaves nothing half made. */

export type RemoteSource = {
  apId: string;
  origin: string;
  instance: string;
  ownerName: string;
  ownerHandle: string | null;
};

export type CopyFileStatus = { name: string; size: number | null; received: number; done: boolean };
export type CopyStatus = {
  state: "idle" | "copying" | "done" | "failed";
  files: CopyFileStatus[];
  copy_id: string | null;
  error: string | null;
};

const PICTURE_MAX_BYTES = 20 * 1024 * 1024;
const PICTURE_MS = 60 * 1000;
// At once, per person: each holds files on disk until it's done.
const MAX_RUNNING_PER_USER = 3;
// A finished copy's status stays a while, for a page that asks once more.
const KEEP_FINISHED_MS = 10 * 60 * 1000;

const jobs = new Map<string, CopyStatus>();
const admitting = new Map<string, Promise<CopyStatus>>();
const keyOf = (userId: string, modelId: string) => `${userId}:${modelId}`;

/** The viewer's own copy of a partner's model, if they made one. */
export async function libraryCopyOfRemote(userId: string, apId: string): Promise<string | null> {
  const found = await prisma.print.findFirst({
    where: { userId, remoteSource: { path: ["apId"], equals: apId } },
    select: { id: true },
  });
  return found?.id ?? null;
}

/** How copying the model is going for `userId`: under way, done (their copy's id), failed, or not started. */
export async function remoteCopyStatus(userId: string, modelId: string): Promise<CopyStatus> {
  const job = jobs.get(keyOf(userId, modelId));
  if (job && job.state !== "done") return job;
  const model = await activeRemoteModel(modelId);
  const copyId = await libraryCopyOfRemote(userId, model.apId);
  if (copyId) return { state: "done", files: job?.files ?? [], copy_id: copyId, error: null };
  return { state: "idle", files: [], copy_id: null, error: null };
}

/** Starts copying the model into `userId`'s library, unless it's under way or they have a copy already. Asked twice at
 *  once, the second hears the first's answer rather than starting another. */
export function startRemoteCopy(userId: string, modelId: string): Promise<CopyStatus> {
  const key = keyOf(userId, modelId);
  const pending = admitting.get(key);
  if (pending) return pending;
  const admission = admit(userId, modelId, key).finally(() => admitting.delete(key));
  admitting.set(key, admission);
  return admission;
}

async function admit(userId: string, modelId: string, key: string): Promise<CopyStatus> {
  const running = jobs.get(key);
  if (running?.state === "copying") return running;
  const model = await activeRemoteModel(modelId);
  const copyId = await libraryCopyOfRemote(userId, model.apId);
  if (copyId) return { state: "done", files: [], copy_id: copyId, error: null };
  const listed = filesOf(model, model.peer.origin);
  if (!listed.some((file) => file.url)) throw new HttpError(409, "That model has no files to copy", "no_files");
  // A copy is the whole model or nothing: one of its files that can't be had isn't left out.
  if (listed.some((file) => !file.url)) {
    throw new HttpError(409, "Not every file of that model can be fetched from its instance", "files_missing");
  }
  // All of it no bigger than one import, as a ZIP of it: each file is held on disk until the copy is made.
  if (listed.reduce((sum, file) => sum + (file.size ?? 0), 0) > IMPORT_MAX_BYTES) {
    throw new HttpError(413, "Too big to copy here: it's more than this instance takes in one import", "copy_too_big");
  }
  const files = listed.map((file, index) => ({ file, index }));
  const mine = [...jobs.entries()].filter(([k, job]) => k.startsWith(`${userId}:`) && job.state === "copying");
  if (mine.length >= MAX_RUNNING_PER_USER) {
    throw new HttpError(429, "Wait for the copies under way to finish", "copy_limit");
  }
  const job: CopyStatus = {
    state: "copying",
    files: files.map(({ file }) => ({ name: file.name, size: file.size, received: 0, done: false })),
    copy_id: null,
    error: null,
  };
  jobs.set(key, job);
  void run(userId, model, files, job).finally(() => {
    setTimeout(() => {
      if (jobs.get(key) === job) jobs.delete(key);
    }, KEEP_FINISHED_MS).unref();
  });
  return job;
}

/** Its images made links to them: shown in the copy, they'd have a viewer's browser fetch them from wherever they are,
 *  which a partner's things never do (MarkdownDescription `remote`). */
export function imagesAsLinks(markdown: string | null): string | null {
  return markdown ? markdown.replace(/(?<!\\)!\[/g, "[") : markdown;
}

async function run(
  userId: string,
  model: RemoteModelRow,
  files: { index: number; file: { name: string; mediaType: string | null } }[],
  job: CopyStatus,
): Promise<void> {
  let dir: string | null = null;
  try {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "thingport-remote-copy-"));
    const uploaded: UploadedFile[] = [];
    // What the partner says of their sizes isn't taken on trust: what came so far counts against the rest.
    let total = 0;
    for (const [position, { index, file }] of files.entries()) {
      const dest = path.join(dir, `${position}-${sanitizeFilename(file.name) || "file"}`);
      await fetchRemoteFile(model, index, dest, {
        maxBytes: IMPORT_MAX_BYTES - total,
        onProgress: (received) => {
          job.files[position].received = received;
        },
      });
      total += (await fsp.stat(dest)).size;
      job.files[position].done = true;
      uploaded.push({ path: dest, originalname: file.name, mimetype: file.mediaType });
    }
    const source: RemoteSource = {
      apId: model.apId,
      origin: model.peer.origin,
      instance: model.peer.name ?? new URL(model.peer.origin).host,
      ownerName: model.person.displayName,
      ownerHandle: model.person.username ? `${model.person.username}@${new URL(model.peer.origin).host}` : null,
    };
    // Made with where it came from, in one go: never a copy that doesn't say so, which another try would copy again.
    const print = await createUploadedModel(
      userId,
      {
        title: model.title,
        notes: imagesAsLinks(model.description),
        tags: [],
        creator: model.person.displayName,
        remoteSource: source as unknown as Prisma.InputJsonValue,
      },
      uploaded,
    );
    // Its pictures, as the partner shows them; one that doesn't come is left out, not the copy.
    for (const url of model.images) {
      const picture = await fetchPicture(model, url).catch(() => null);
      if (picture) await addPreviewImage(print.id, picture).catch(() => null);
    }
    job.state = "done";
    job.copy_id = print.id;
    void createLog({
      userId,
      action: "model_copied",
      targetId: print.id,
      details: { name: model.title, from: model.apId, instance: model.peer.origin },
    });
  } catch (err) {
    job.state = "failed";
    job.error = (err as Error).message || "Couldn't copy it";
    console.warn(`[federation] Couldn't copy ${model.apId}:`, job.error);
  } finally {
    if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** A picture of the model, read no further than PICTURE_MAX_BYTES whatever the partner says its size is. */
async function fetchPicture(model: RemoteModelRow, url: string): Promise<Buffer | null> {
  const response = await signedGet(url, model.peer.origin, {
    accept: "image/*",
    signal: AbortSignal.timeout(PICTURE_MS),
  });
  const reader = response.body?.getReader();
  if (!response.ok || !reader || Number(response.headers.get("content-length") ?? 0) > PICTURE_MAX_BYTES) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > PICTURE_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
