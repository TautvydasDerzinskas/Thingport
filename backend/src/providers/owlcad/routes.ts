// OwlCAD stores no file for a CAD project: its document is a script, and only its own editor can turn one into
// geometry. So Grab opens the model in that editor on owlcad.com, exports it through the page's own automation
// bridge (`window.owlcadAgent.exportMesh`) and posts the bytes here. Imports started anywhere else wait for its next
// visit (grabExports.ts). Mounted by providers/routes.ts.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../auth";
import { prisma } from "../../db";
import { enabledImportUrl, importRequestSchema } from "../../routes/importRequest";
import { requireCaptcha } from "../../services/captchaService";
import { addPrintsToCollection } from "../../services/collectionService";
import { startImportTask } from "../../services/importTaskService";
import { importAndDescribe } from "../../services/singleImport";
import { asyncHandler } from "../../utils/asyncHandler";
import { HttpError } from "../../utils/fileUtils";
import { parseBody } from "../../utils/validate";
import manifest from "./manifest.generated";
import { owlcadModelUrl, parseOwlcadModelUrl } from "./urls.generated";
import { owlcadNeedsGrab } from "./index";
import {
  clearOwlcadExport,
  getOwlcadExport,
  listOwlcadExports,
  queueOwlcadExport,
  recordOwlcadExportFailure,
} from "./grabExports";

const OWLCAD = manifest.id;

/** A 3MF the editor built. Its bridge refuses anything over 250k triangles, which caps this well under the limit. */
const MAX_EXPORT_BYTES = 128 * 1024 * 1024;
/** Base64 is about a third larger than the bytes it carries. */
const MAX_EXPORT_BASE64 = Math.ceil((MAX_EXPORT_BYTES * 4) / 3) + 1024;

/** The two routes an export's file travels in the JSON of, and the body limit they need. The global parser's
 *  100 kB would turn away every real export, so app.ts gives these paths their own -- the base64 above, and room
 *  for the handful of fields beside it. */
export const bodyLimit = {
  paths: [`/api/import/${OWLCAD}/export`, `/api/import/${OWLCAD}/waiting`],
  limit: MAX_EXPORT_BASE64 + 64 * 1024,
};

const router = Router();
router.use(requireAuth);

/** What Grab asks before opening the editor: whether this model needs exporting there at all. A library part does
 *  not -- the backend converts its stored mesh itself. */
router.get(
  `/import/${OWLCAD}/plan`,
  asyncHandler(async (req, res) => {
    const url = await enabledImportUrl(z.string().parse(req.query.url));
    const parsed = parseOwlcadModelUrl(url);
    if (!parsed) throw new HttpError(400, `Not an ${manifest.name} model link`);
    const { item, needsGrab } = await owlcadNeedsGrab(parsed.modelId);
    res.json({ model_id: parsed.modelId, title: item.name ?? null, type: item.type ?? null, needs_grab: needsGrab });
  }),
);

/** A link pasted in the app for a model only the editor can build: it waits for Grab's next visit to owlcad.com. */
router.post(
  `/import/${OWLCAD}/queue`,
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = parseBody(importRequestSchema.extend({ collection_id: z.string().nullable().optional() }), req.body);
    const url = await enabledImportUrl(body.url);
    if (!parseOwlcadModelUrl(url)) throw new HttpError(400, `Not an ${manifest.name} model link`);
    await queueOwlcadExport(req.userId!, url, {
      collectionId: body.collection_id ?? null,
      categoryId: body.category_id ?? null,
      tags: body.tags,
      notes: body.notes ?? null,
    });
    res.status(202).json({ queued: 1 });
  }),
);

router.get(
  `/import/${OWLCAD}/waiting`,
  asyncHandler(async (req, res) => {
    res.json(await listOwlcadExports(req.userId!));
  }),
);

const exportSchema = z.object({
  /** The file itself, base64: OwlCAD's bridge hands the editor's export to the page as base64, and there is no link
   *  anywhere to send instead. */
  file: z.string().min(1).max(MAX_EXPORT_BASE64),
  filename: z.string().max(200).nullable().optional(),
});

/** Files an imported model where its import asked for it, as long as that collection is still the user's. */
async function fileInCollection(userId: string, collectionId: string | null, printId: string): Promise<void> {
  if (!collectionId) return;
  const collection = await prisma.collection.findFirst({ where: { id: collectionId, userId } });
  if (collection) await addPrintsToCollection(collection.id, [printId]);
}

/** Writes Grab's export where the import can read it, and runs the import with it. */
async function importExported(
  userId: string,
  url: string,
  base64: string,
  extras: { tags?: string[]; notes?: string | null; categoryId?: string | null },
  options: { keepGrabImports?: boolean } = {},
) {
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) throw new HttpError(400, "That export was empty.");
  if (bytes.length > MAX_EXPORT_BYTES) throw new HttpError(413, "That export is too large to import.");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "owlcad-grab-"));
  const file = path.join(dir, "export.3mf");
  await fs.writeFile(file, bytes);
  try {
    return await importAndDescribe(
      userId,
      url,
      {
        url,
        tags: extras.tags ?? [],
        notes: extras.notes ?? null,
        category_id: extras.categoryId ?? null,
        owlcadExportPath: file,
        notify: false,
      },
      options,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Grab exported a waiting model in the editor: imported, then filed where it was meant to go. Asynchronous with
 *  `?async=1`, as /import is, since a dense model outlasts an extension worker's fetch. */
router.post(
  `/import/${OWLCAD}/waiting/:id`,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const body = parseBody(exportSchema, req.body);
    const row = await getOwlcadExport(userId, req.params.id);
    const run = async () => {
      let described;
      try {
        described = await importExported(
          userId,
          row.url,
          body.file,
          { tags: row.tags, notes: row.notes, categoryId: row.categoryId },
          // This row is cleared below, once it's filed, rather than by the import: a failed filing keeps the
          // collection to try again with.
          { keepGrabImports: true },
        );
        await fileInCollection(userId, row.collectionId, described.id);
      } catch (err) {
        await recordOwlcadExportFailure(row, err instanceof Error ? err.message : "Import failed").catch(
          () => undefined,
        );
        throw err;
      }
      await clearOwlcadExport(row).catch(() => undefined);
      return described;
    };
    if (req.query.async === "1") {
      res.status(202).json({ task_id: startImportTask(userId, run) });
      return;
    }
    res.json(await run());
  }),
);

/** Grab exported a model the user asked for on the page itself, with nothing waiting for it. */
router.post(
  `/import/${OWLCAD}/export`,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const body = parseBody(
      importRequestSchema.merge(exportSchema).extend({ collection_id: z.string().nullable().optional() }),
      req.body,
    );
    const url = await enabledImportUrl(body.url);
    const parsed = parseOwlcadModelUrl(url);
    if (!parsed) throw new HttpError(400, `Not an ${manifest.name} model link`);
    // No row of its own to keep: the import clears whatever waited for this model, so Grab's next visit doesn't
    // export it a second time.
    const run = async () => {
      const described = await importExported(userId, owlcadModelUrl(parsed.modelId), body.file, {
        tags: body.tags,
        notes: body.notes ?? null,
        categoryId: body.category_id ?? null,
      });
      await fileInCollection(userId, body.collection_id ?? null, described.id);
      return described;
    };
    if (req.query.async === "1") {
      res.status(202).json({ task_id: startImportTask(userId, run) });
      return;
    }
    res.json(await run());
  }),
);

/** Grab couldn't export a waiting model: the editor wouldn't load it, or it is denser than the bridge allows. */
router.post(
  `/import/${OWLCAD}/waiting/:id/failed`,
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ error: z.string().max(1000) }), req.body);
    await recordOwlcadExportFailure(await getOwlcadExport(req.userId!, req.params.id), body.error);
    res.json({ ok: true });
  }),
);

export default router;
