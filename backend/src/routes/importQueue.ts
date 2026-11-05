// Someone's own imports: what's running, waiting and finished, and what they can do about it. Another person's job reads
// as if it weren't there. No captcha here: an import passed one when it was added.

import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { toQueueOut } from "../dto";
import {
  clearFinishedJobs,
  deleteQueueJob,
  getQueueJob,
  pauseAll,
  pauseQueueJob,
  readOwnQueue,
  removeQueueItem,
  retryAllFailed,
  setStartGrabLinks,
  startAllPaused,
  type StartedJob,
  startQueueJob,
} from "../services/importQueueService";
import { asyncHandler } from "../utils/asyncHandler";
import { parseBody } from "../utils/validate";

const router = Router();
router.use(requireAuth);

router.get(
  "/import/queue",
  asyncHandler(async (req, res) => {
    res.json(toQueueOut(await readOwnQueue(req.userId!)));
  }),
);

const settingsSchema = z.object({ start_grab_links: z.boolean() });

router.put(
  "/import/queue/settings",
  asyncHandler(async (req, res) => {
    const { start_grab_links } = parseBody(settingsSchema, req.body);
    await setStartGrabLinks(req.userId!, start_grab_links);
    res.json({ start_grab_links });
  }),
);

const placeOut = ({ job, position, syncWaiting }: StartedJob) => ({
  job_id: job.id,
  status: job.status,
  position,
  sync_waiting: syncWaiting,
});

router.post(
  "/import/queue/jobs/:id/start",
  asyncHandler(async (req, res) => {
    const job = await getQueueJob(req.params.id, req.userId!);
    res.status(202).json(placeOut(await startQueueJob(job, { manual: true, asOffered: true })));
  }),
);

router.post(
  "/import/queue/jobs/:id/retry",
  asyncHandler(async (req, res) => {
    const job = await getQueueJob(req.params.id, req.userId!);
    res.status(202).json(placeOut(await startQueueJob(job, { retryFailed: true, manual: true, asOffered: true })));
  }),
);

router.post(
  "/import/queue/jobs/:id/pause",
  asyncHandler(async (req, res) => {
    await pauseQueueJob(await getQueueJob(req.params.id, req.userId!));
    res.json({ ok: true });
  }),
);

router.delete(
  "/import/queue/jobs/:id",
  asyncHandler(async (req, res) => {
    await deleteQueueJob(req.params.id, req.userId!);
    res.json({ ok: true });
  }),
);

router.delete(
  "/import/queue/items/:id",
  asyncHandler(async (req, res) => {
    res.json(await removeQueueItem(req.params.id, req.userId!));
  }),
);

router.post(
  "/import/queue/start-all",
  asyncHandler(async (req, res) => {
    res.status(202).json({ queued: await startAllPaused({ ownerId: req.userId!, line: true }) });
  }),
);

router.post(
  "/import/queue/retry-failed",
  asyncHandler(async (req, res) => {
    res.status(202).json({ queued: await retryAllFailed({ ownerId: req.userId!, line: true }) });
  }),
);

router.post(
  "/import/queue/pause-all",
  asyncHandler(async (req, res) => {
    res.json({ paused: await pauseAll({ ownerId: req.userId!, line: true }) });
  }),
);

router.post(
  "/import/queue/clear-finished",
  asyncHandler(async (req, res) => {
    res.json({ deleted: await clearFinishedJobs({ ownerId: req.userId!, line: true }) });
  }),
);

export default router;
