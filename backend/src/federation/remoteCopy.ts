import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Prisma } from "@prisma/client";
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

/** Starts copying the model into `userId`'s library, unless it's under way or they have a copy already. */
export async function startRemoteCopy(userId: string, modelId: string): Promise<CopyStatus> {
  const key = keyOf(userId, modelId);
  const running = jobs.get(key);
  if (running?.state === "copying") return running;
  const model = await activeRemoteModel(modelId);
  const copyId = await libraryCopyOfRemote(userId, model.apId);
  if (copyId) return { state: "done", files: [], copy_id: copyId, error: null };
  const files = filesOf(model, model.peer.origin)
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => file.url);
  if (!files.length) throw new HttpError(409, "That model has no files to copy", "no_files");
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

async function run(
  userId: string,
  model: RemoteModelRow,
  files: { index: number; file: { name: string; mediaType: string | null } }[],
  job: CopyStatus,
): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "thingport-remote-copy-"));
  try {
    const uploaded: UploadedFile[] = [];
    for (const [position, { index, file }] of files.entries()) {
      const dest = path.join(dir, `${position}-${sanitizeFilename(file.name) || "file"}`);
      await fetchRemoteFile(model, index, dest, (received) => {
        job.files[position].received = received;
      });
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
    const print = await createUploadedModel(
      userId,
      { title: model.title, notes: model.description, tags: [], creator: model.person.displayName },
      uploaded,
    );
    await prisma.print.update({
      where: { id: print.id },
      data: { remoteSource: source as unknown as Prisma.InputJsonValue },
    });
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
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function fetchPicture(model: RemoteModelRow, url: string): Promise<Buffer | null> {
  const response = await signedGet(url, model.peer.origin, {
    accept: "image/*",
    signal: AbortSignal.timeout(PICTURE_MS),
  });
  if (!response.ok || Number(response.headers.get("content-length") ?? 0) > PICTURE_MAX_BYTES) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.length <= PICTURE_MAX_BYTES ? buffer : null;
}
