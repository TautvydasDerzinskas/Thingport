import type { GrabImport } from "@prisma/client";
import { prisma } from "../../db";
import { createNotification } from "../../services/notificationService";
import { HttpError } from "../../utils/fileUtils";
import { siteHost } from "../names";
import manifest from "./manifest.generated";
import { owlcadEditorUrl, owlcadModelUrl, parseOwlcadModelUrl } from "./urls.generated";

// CAD projects waiting for Thingport Grab. A project's geometry is a script, not a mesh: OwlCAD stores no file for
// it and hands out no link to one, because its own editor builds the file in the page. So an import that starts
// anywhere else (the app, the import queue) is parked here, and Grab, on the next owlcad.com page it sees, opens
// each one in the editor, exports it and sends the bytes back. A project that keeps failing is dropped with a
// notification, so it isn't retried on every visit.
//
// Shares the GrabImport table with MakerOnline, which parks imports for its own reason; `provider` keeps the two
// apart, so neither hands the other's rows to its own Grab flow.

export const OWLCAD_EXPORT_MAX_ATTEMPTS = 3;

const NAME = manifest.name;
const ID = manifest.id;
const SITE_HOST = siteHost(ID);

export type OwlcadExportOptions = {
  collectionId?: string | null;
  categoryId?: string | null;
  tags?: string[];
  notes?: string | null;
};

/** Parks an OwlCAD CAD project for Grab. The same model again keeps one entry, with the newest options. */
export async function queueOwlcadExport(userId: string, url: string, options: OwlcadExportOptions = {}): Promise<void> {
  const parsed = parseOwlcadModelUrl(url);
  if (!parsed) throw new HttpError(400, `Not an ${NAME} model link`);
  // Always the gallery link, so the same model queued from its editor link and its gallery link is one row.
  const canonical = owlcadModelUrl(parsed.modelId);
  const data = {
    collectionId: options.collectionId ?? null,
    categoryId: options.categoryId ?? null,
    tags: options.tags ?? [],
    notes: options.notes ?? null,
  };
  await prisma.grabImport.upsert({
    where: { userId_url: { userId, url: canonical } },
    create: { userId, provider: ID, url: canonical, ...data },
    update: { ...data, attempts: 0, lastError: null },
  });
}

/** One heads-up for a batch just parked, so the user knows to open OwlCAD. */
export async function notifyOwlcadExportsQueued(
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
      `${NAME} builds a CAD project's file in its own editor, so there is nothing to download. Open ${SITE_HOST} in ` +
      "a browser with Thingport Grab and it exports them there.",
    externalUrl: opts.externalUrl ?? null,
    internalPath: opts.internalPath ?? null,
  });
}

export type OwlcadExportOut = {
  id: string;
  url: string;
  /** The page Grab opens to export it: the model in OwlCAD's editor. */
  editor_url: string;
  model_id: string;
  collection_id: string | null;
  attempts: number;
};

export async function listOwlcadExports(userId: string): Promise<OwlcadExportOut[]> {
  const rows = await prisma.grabImport.findMany({
    where: { userId, provider: ID },
    orderBy: { createdAt: "asc" },
  });
  return rows.flatMap((row) => {
    const parsed = parseOwlcadModelUrl(row.url);
    if (!parsed) return [];
    return [
      {
        id: row.id,
        url: row.url,
        editor_url: owlcadEditorUrl(parsed.modelId),
        model_id: parsed.modelId,
        collection_id: row.collectionId,
        attempts: row.attempts,
      },
    ];
  });
}

export async function getOwlcadExport(userId: string, id: string): Promise<GrabImport> {
  const row = await prisma.grabImport.findFirst({ where: { id, userId, provider: ID } });
  if (!row) throw new HttpError(404, "This waiting export is gone -- it may have been imported already");
  return row;
}

/** Imported, however it came in: nothing waits for this model any more. */
export async function clearOwlcadExports(userId: string, modelId: string): Promise<void> {
  const rows = await prisma.grabImport.findMany({
    where: { userId, provider: ID },
    select: { id: true, url: true },
  });
  const done = rows.filter((row) => parseOwlcadModelUrl(row.url)?.modelId === modelId).map((row) => row.id);
  if (done.length) await prisma.grabImport.deleteMany({ where: { id: { in: done } } });
}

/** One waiting export done. */
export async function clearOwlcadExport(row: GrabImport): Promise<void> {
  await prisma.grabImport.deleteMany({ where: { id: row.id, userId: row.userId } });
}

/** A failed try. The last one drops the model and says why. */
export async function recordOwlcadExportFailure(row: GrabImport, error: string): Promise<void> {
  const attempts = row.attempts + 1;
  if (attempts < OWLCAD_EXPORT_MAX_ATTEMPTS) {
    await prisma.grabImport.update({ where: { id: row.id }, data: { attempts, lastError: error.slice(0, 1000) } });
    return;
  }
  await prisma.grabImport.delete({ where: { id: row.id } }).catch(() => undefined);
  await createNotification(row.userId, {
    type: "import",
    title: `Couldn't import an ${NAME} model`,
    body: `Thingport Grab tried ${attempts} times: ${error}`,
    externalUrl: row.url,
    internalPath: null,
  });
}
