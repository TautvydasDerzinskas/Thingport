import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { asyncHandler } from "../utils/asyncHandler";
import { parseBody } from "../utils/validate";
import { getActiveJob } from "../services/importJobService";
import { missingFilesScan, summarize, type MissingFilesSummary } from "../services/missingFilesService";
import {
  cancelModelRepairRun,
  currentModelRepairRun,
  startModelRepairRun,
  type ModelRepairRun,
} from "../services/modelRepairService";

// The models whose files are gone, and the repair of them. See services/missingFilesService.ts.

const router = Router();
router.use(requireAuth);

function runOut(run: ModelRepairRun | null) {
  if (!run) return null;
  return {
    action: run.action,
    running: run.running,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    total: run.total,
    done: run.done,
    repaired: run.repaired,
    queued: run.queued,
    deleted: run.deleted,
    skipped: run.skipped,
    failed: run.failed,
    cancelled: run.cancelled,
    stop_reason: run.stopReason,
    last_error: run.lastError,
  };
}

function summaryOut(summary: MissingFilesSummary) {
  return {
    total: summary.total,
    broken: summary.broken,
    server: summary.server,
    grab: summary.grab,
    no_source: summary.noSource,
    by_provider: summary.byProvider,
    sample: summary.sample,
    scanned_at: summary.scannedAt,
    prompt: summary.prompt,
  };
}

router.get(
  "/prints/missing-files",
  asyncHandler(async (req, res) => {
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    res.json(summaryOut(summarize(await missingFilesScan(req.userId!, { refresh }))));
  }),
);

router.get(
  "/prints/repair/run",
  asyncHandler(async (req, res) => {
    res.json({ run: runOut(currentModelRepairRun(req.userId!)) });
  }),
);

const startSchema = z.object({ action: z.enum(["reimport", "delete"]) });

router.post(
  "/prints/repair",
  asyncHandler(async (req, res) => {
    const { action } = parseBody(startSchema, req.body);
    // An import already going is the same providers being asked for files: one at a time.
    if (action === "reimport" && (await getActiveJob(req.userId!))) {
      throw new HttpError(409, "An import is already in progress; let it finish, then repair the rest");
    }
    const run = startModelRepairRun(req.userId!, action);
    if (!run) throw new HttpError(409, "A repair is already running");
    res.json({ run: runOut(run) });
  }),
);

router.post(
  "/prints/repair/cancel",
  asyncHandler(async (req, res) => {
    res.json({ run: runOut(cancelModelRepairRun(req.userId!)) });
  }),
);

export default router;
