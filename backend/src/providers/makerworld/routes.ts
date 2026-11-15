// Imports MakerWorld's CAPTCHA stopped, waiting for Thingport Grab to clear it with MakerWorld's own puzzle on its site
// (grabImports.ts): Grab lists them, resolves each one's file there once the puzzle is solved, and hands it over here.
// Mounted by providers/routes.ts.

import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../auth";
import { prisma } from "../../db";
import { addPrintsToCollection } from "../../services/collectionService";
import { startImportTask } from "../../services/importTaskService";
import { importAndDescribe, prepareSingleImport } from "../../services/singleImport";
import { asyncHandler } from "../../utils/asyncHandler";
import { parseBody } from "../../utils/validate";
import manifest from "./manifest.generated";
import {
  finishMakerworldGrabImport,
  getMakerworldGrabImport,
  listMakerworldGrabImports,
  recordMakerworldGrabImportFailure,
} from "./grabImports";

const MAKERWORLD = manifest.id;

const router = Router();
router.use(requireAuth);

router.get(
  `/import/${MAKERWORLD}/waiting`,
  asyncHandler(async (req, res) => {
    res.json(await listMakerworldGrabImports(req.userId!));
  }),
);

/** What Grab resolved on makerworld.com, as its own imports send it to /import. */
const resolvedSchema = z.object({
  resolved_download_url: z.string().url(),
  resolved_instance_id: z.string().nullable().optional(),
  makerworld_design: z.record(z.unknown()).nullable().optional(),
});

/** Which queueing of the link Grab's list had: a try at an earlier one doesn't count against a newer one. An older
 *  Grab sends none, and its try counts against the link as it's queued now. */
const revisionSchema = z.object({ revision: z.number().int().nonnegative().optional() });

/** Grab resolved a waiting model's file: imported like any link with what it resolved, filed where it was meant to go,
 *  and counted done in the import it failed in. Asynchronous with `?async=1`, as /import is. */
router.post(
  `/import/${MAKERWORLD}/waiting/:id`,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const resolved = parseBody(resolvedSchema, req.body);
    const { revision } = parseBody(revisionSchema, req.body);
    const row = await getMakerworldGrabImport(userId, req.params.id);
    const run = async () => {
      let described;
      try {
        const { url, body } = await prepareSingleImport(userId, {
          url: row.url,
          tags: row.tags,
          notes: row.notes,
          category_id: row.categoryId,
          ...resolved,
          notify: false,
        });
        // Only this row is cleared, once it's filed, so a failed filing keeps the collection to try again with.
        described = await importAndDescribe(userId, url, body, { keepGrabImports: true });
        if (row.collectionId) {
          const collection = await prisma.collection.findFirst({ where: { id: row.collectionId, userId } });
          if (collection) await addPrintsToCollection(collection.id, [described.id]);
        }
      } catch (err) {
        // The import ran with the link as it's queued now, but the try was at the one Grab listed.
        await recordMakerworldGrabImportFailure(
          { ...row, revision: revision ?? row.revision },
          err instanceof Error ? err.message : "Import failed",
        ).catch(() => undefined);
        throw err;
      }
      await finishMakerworldGrabImport(row, described.import_outcome === "already_imported");
      return described;
    };
    if (req.query.async === "1") {
      res.status(202).json({ task_id: startImportTask(userId, run) });
      return;
    }
    res.json(await run());
  }),
);

/** Grab couldn't resolve a waiting model's file, the puzzle solved or not, at the queueing its list had. */
router.post(
  `/import/${MAKERWORLD}/waiting/:id/failed`,
  asyncHandler(async (req, res) => {
    const body = parseBody(revisionSchema.extend({ error: z.string().max(1000) }), req.body);
    const row = await getMakerworldGrabImport(req.userId!, req.params.id);
    await recordMakerworldGrabImportFailure({ ...row, revision: body.revision ?? row.revision }, body.error);
    res.json({ ok: true });
  }),
);

export default router;
