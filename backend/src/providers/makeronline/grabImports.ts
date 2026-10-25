import type { GrabImport } from "@prisma/client";
import { prisma } from "../../db";
import { createNotification } from "../../services/notificationService";
import { findOrCreateCollectionByName } from "../../services/collectionService";
import type { ListImportBody } from "../types";
import {
  makeronlineDownloadPlan,
  makeronlineModelUrl,
  parseMakeronlineModelUrl,
  resolveMakeronlineModel,
  type MakeronlineDownloadRequest,
  type MakeronlineProfileScope,
} from "./api";
import { HttpError } from "../../utils/fileUtils";
import { MANIFESTS } from "../index.generated";
import { siteHost } from "../names";

// Imports waiting for Thingport Grab. MakerOnline hands out download links only to a page its anti-bot script runs on,
// so an import that starts anywhere else (the app, the import queue, a sync) is parked here. Grab, on the next
// makeronline.com page it sees, asks for the list, gets each one's files signed there and imports it; a model that
// keeps failing is dropped with a notification, so it isn't retried on every visit.

export const GRAB_IMPORT_MAX_ATTEMPTS = 3;

const NAME = MANIFESTS.makeronline.name;
const SITE_HOST = siteHost(MANIFESTS.makeronline.id);

export type GrabImportOptions = {
  scope?: MakeronlineProfileScope;
  collectionId?: string | null;
  categoryId?: string | null;
  tags?: string[];
  notes?: string | null;
};

/** Parks a MakerOnline model for Grab. The same link again keeps one entry, with the newest options. */
export async function queueGrabImport(userId: string, url: string, options: GrabImportOptions = {}): Promise<void> {
  if (!parseMakeronlineModelUrl(url)) throw new HttpError(400, `Not a ${NAME} model link`);
  const data = {
    scope: options.scope ?? "url",
    collectionId: options.collectionId ?? null,
    categoryId: options.categoryId ?? null,
    tags: options.tags ?? [],
    notes: options.notes ?? null,
  };
  await prisma.grabImport.upsert({
    where: { userId_url: { userId, url } },
    create: { userId, url, ...data },
    update: { ...data, attempts: 0, lastError: null },
  });
}

/** The picked models of a list, parked for Grab and filed, once imported, into a collection named after the list. */
export async function queueGrabList(
  userId: string,
  title: string,
  body: ListImportBody,
): Promise<{ queued: number; collectionId: string }> {
  const collection = await findOrCreateCollectionByName(userId, title);
  for (const modelId of body.model_ids) {
    await queueGrabImport(userId, makeronlineModelUrl(modelId), {
      collectionId: collection.id,
      categoryId: body.category_id ?? null,
      tags: body.tags ?? [],
      notes: body.notes ?? null,
    });
  }
  await notifyGrabImportsQueued(userId, body.model_ids.length, {
    label: title,
    externalUrl: body.url,
    internalPath: `/models/collections/${collection.id}`,
  });
  return { queued: body.model_ids.length, collectionId: collection.id };
}

/** One heads-up for a batch just parked, so the user knows to open MakerOnline. */
export async function notifyGrabImportsQueued(
  userId: string,
  count: number,
  opts: { label?: string | null; externalUrl?: string | null; internalPath?: string | null } = {},
): Promise<void> {
  if (!count) return;
  const models = count === 1 ? `1 ${NAME} model waits` : `${count} ${NAME} models wait`;
  await createNotification(userId, {
    type: "import",
    title: `${models} for Thingport Grab${opts.label ? ` (${opts.label})` : ""}`,
    body:
      `${NAME} only gives its files to its own pages. Open ${SITE_HOST} in a browser with Thingport Grab and it ` +
      "imports them there.",
    externalUrl: opts.externalUrl ?? null,
    internalPath: opts.internalPath ?? null,
  });
}

export type GrabImportOut = {
  id: string;
  url: string;
  scope: string;
  collection_id: string | null;
  attempts: number;
};

export async function listGrabImports(userId: string): Promise<GrabImportOut[]> {
  const rows = await prisma.grabImport.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    scope: row.scope,
    collection_id: row.collectionId,
    attempts: row.attempts,
  }));
}

export async function getGrabImport(userId: string, id: string): Promise<GrabImport> {
  const row = await prisma.grabImport.findFirst({ where: { id, userId } });
  if (!row) throw new HttpError(404, "This waiting import is gone -- it may have been imported already");
  return row;
}

/** Imported: nothing waits for this model any more, whichever way it came in. */
export async function clearGrabImports(userId: string, modelId: string): Promise<void> {
  const rows = await prisma.grabImport.findMany({ where: { userId }, select: { id: true, url: true } });
  const done = rows.filter((row) => parseMakeronlineModelUrl(row.url)?.modelId === modelId).map((row) => row.id);
  if (done.length) await prisma.grabImport.deleteMany({ where: { id: { in: done } } });
}

/** One waiting import done; others for the same model, under another link or with other options, still wait. */
export async function clearGrabImport(row: GrabImport): Promise<void> {
  await prisma.grabImport.deleteMany({ where: { id: row.id, userId: row.userId } });
}

/** A failed try. The last one drops the model and says why. */
export async function recordGrabImportFailure(row: GrabImport, error: string): Promise<void> {
  const attempts = row.attempts + 1;
  if (attempts < GRAB_IMPORT_MAX_ATTEMPTS) {
    await prisma.grabImport.update({ where: { id: row.id }, data: { attempts, lastError: error.slice(0, 1000) } });
    return;
  }
  await prisma.grabImport.delete({ where: { id: row.id } }).catch(() => undefined);
  await createNotification(row.userId, {
    type: "import",
    title: `Couldn't import a ${NAME} model`,
    body: `Thingport Grab tried ${attempts} times: ${error}`,
    externalUrl: row.url,
    internalPath: null,
  });
}

/** What Grab has to get signed for a model link: each picked print profile's 3MF, or the model's own files. */
export async function planMakeronlineDownloads(
  url: string,
  scope: MakeronlineProfileScope,
): Promise<{ title: string | null; requests: MakeronlineDownloadRequest[] }> {
  const parsed = parseMakeronlineModelUrl(url);
  if (!parsed) throw new HttpError(400, `Not a ${NAME} model link`);
  const resolved = await resolveMakeronlineModel(parsed.modelId);
  if (!resolved) throw new HttpError(404, `This ${NAME} model could not be found, or isn't public.`);
  const requests = makeronlineDownloadPlan(parsed.modelId, resolved, scope, parsed.requestedProfileId);
  if (!requests.length) throw new HttpError(400, `This ${NAME} model has no files Thingport can import.`);
  return { title: resolved.meta.title ?? null, requests };
}
