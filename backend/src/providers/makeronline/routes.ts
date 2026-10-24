// MakerOnline signs its download links only for a page its own anti-bot script runs on. Grab asks what a model needs
// (plan), gets it signed on makeronline.com, and imports with the signed links; imports started anywhere else wait
// for it (grabImports.ts). Mounted by providers/routes.ts.

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
import manifest from "../_generated/makeronline/manifest";
import { parseMakeronlineModelUrl } from "./api";
import {
  clearGrabImport,
  getGrabImport,
  listGrabImports,
  planMakeronlineDownloads,
  queueGrabImport,
  recordGrabImportFailure,
} from "./grabImports";

const MAKERONLINE = manifest.id;

const router = Router();
router.use(requireAuth);

const makeronlineScopeSchema = z.enum(["url", "designer", "all"]).default("url");

router.post(
  `/import/${MAKERONLINE}/plan`,
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ url: z.string(), scope: makeronlineScopeSchema }), req.body);
    const url = await enabledImportUrl(body.url);
    res.json(await planMakeronlineDownloads(url, body.scope));
  }),
);

/** A link pasted in the app: it waits for Grab's next visit to makeronline.com. */
router.post(
  `/import/${MAKERONLINE}/queue`,
  requireCaptcha("import"),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      importRequestSchema.extend({ scope: makeronlineScopeSchema, collection_id: z.string().nullable().optional() }),
      req.body,
    );
    const url = await enabledImportUrl(body.url);
    if (!parseMakeronlineModelUrl(url)) throw new HttpError(400, `Not a ${manifest.name} model link`);
    await queueGrabImport(req.userId!, url, {
      scope: body.scope,
      collectionId: body.collection_id ?? null,
      categoryId: body.category_id ?? null,
      tags: body.tags,
      notes: body.notes ?? null,
    });
    res.status(202).json({ queued: 1 });
  }),
);

router.get(
  `/import/${MAKERONLINE}/waiting`,
  asyncHandler(async (req, res) => {
    res.json(await listGrabImports(req.userId!));
  }),
);

const grabFilesSchema = z.object({
  files: z
    .array(z.object({ url: z.string().url(), name: z.string().max(500), profile_id: z.string().nullable().optional() }))
    .min(1)
    .max(200),
});

/** Grab signed a waiting model's files: imported like any link, then filed where it was meant to go. Asynchronous
 *  with `?async=1`, as /import is, since a model of many files outlasts an extension worker's fetch. */
router.post(
  `/import/${MAKERONLINE}/waiting/:id`,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const body = parseBody(grabFilesSchema, req.body);
    const row = await getGrabImport(userId, req.params.id);
    const run = async () => {
      let described;
      try {
        described = await importAndDescribe(
          userId,
          row.url,
          {
            url: row.url,
            tags: row.tags,
            notes: row.notes,
            category_id: row.categoryId,
            resolved_files: body.files,
            notify: false,
          },
          // Only this row is cleared, once it's filed, so a failed filing keeps the collection to try again with.
          { keepGrabImports: true },
        );
        if (row.collectionId) {
          const collection = await prisma.collection.findFirst({ where: { id: row.collectionId, userId } });
          if (collection) await addPrintsToCollection(collection.id, [described.id]);
        }
      } catch (err) {
        await recordGrabImportFailure(row, err instanceof Error ? err.message : "Import failed").catch(() => undefined);
        throw err;
      }
      await clearGrabImport(row).catch(() => undefined);
      return described;
    };
    if (req.query.async === "1") {
      res.status(202).json({ task_id: startImportTask(userId, run) });
      return;
    }
    res.json(await run());
  }),
);

/** Grab couldn't get a waiting model's files signed, e.g. MakerOnline asked for a captcha. */
router.post(
  `/import/${MAKERONLINE}/waiting/:id/failed`,
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ error: z.string().max(1000) }), req.body);
    await recordGrabImportFailure(await getGrabImport(req.userId!, req.params.id), body.error);
    res.json({ ok: true });
  }),
);

export default router;
