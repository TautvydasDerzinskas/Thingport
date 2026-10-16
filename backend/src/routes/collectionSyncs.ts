import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import {
  disableSync,
  enableSync,
  lookupSync,
  syncForCollection,
  updateSyncSettings,
} from "../services/collectionSyncService";
import { releaseSync, reserveSync, runManualSync } from "../services/collectionSyncRunner";
import { getActiveJob } from "../services/importJobService";
import { SYNC_INTERVAL_HOURS, syncNowAvailableAt, type SyncIntervalHours } from "../services/collectionSyncSchedule";
import { toCollectionSyncOut } from "../dto";
import { enableSyncFromApp } from "../services/providerCollectionsService";
import { prisma } from "../db";
import { assertProviderEnabled } from "../services/providerSettingsService";

const router = Router();
router.use(requireAuth);

// Thingport Grab, on a provider's collection page: is it synced, and with which collection?
router.get(
  "/collection-sync",
  asyncHandler(async (req, res) => {
    const url = typeof req.query.url === "string" ? req.query.url.trim() : "";
    if (!url) throw new HttpError(400, "url is required");
    res.json(await lookupSync(req.userId!, url));
  }),
);

const enableSchema = z.object({
  url: z.string().min(1),
  title: z.string().max(500).nullable().optional(),
  known_ids: z.array(z.string().max(64)).max(10_000).default([]),
  collection_id: z.string().nullable().optional(),
});

// Only Grab turns sync on: it has seen the provider's collection, so it knows which models are
// already there and which are new from now on.
router.post(
  "/collection-sync",
  asyncHandler(async (req, res) => {
    const body = parseBody(enableSchema, req.body);
    res.json(
      await enableSync(req.userId!, {
        url: body.url,
        title: body.title,
        knownIds: body.known_ids,
        collectionId: body.collection_id,
      }),
    );
  }),
);

const settingsSchema = z
  .object({
    profile_scope: z.enum(["url", "designer", "all"]).optional(),
    interval_hours: z
      .number()
      .int()
      .refine((hours): hours is SyncIntervalHours => (SYNC_INTERVAL_HOURS as readonly number[]).includes(hours), {
        message: `Pick one of ${SYNC_INTERVAL_HOURS.join(", ")} hours`,
      })
      .optional(),
  })
  .refine((body) => body.profile_scope !== undefined || body.interval_hours !== undefined, {
    message: "Nothing to change",
  });

router.patch(
  "/collection/:id/sync",
  asyncHandler(async (req, res) => {
    const body = parseBody(settingsSchema, req.body);
    res.json(
      await updateSyncSettings(req.userId!, req.params.id, {
        profileScope: body.profile_scope,
        intervalHours: body.interval_hours,
      }),
    );
  }),
);

const enableFromAppSchema = z.object({
  url: z.string().min(1),
  profile_scope: z.enum(["url", "designer", "all"]).optional(),
  interval_hours: z
    .number()
    .int()
    .refine((hours): hours is SyncIntervalHours => (SYNC_INTERVAL_HOURS as readonly number[]).includes(hours))
    .optional(),
});

// The app's Browse tab: links this collection to a provider's. Thingport Grab uses POST
// /collection-sync instead, with the model ids it saw on the page.
router.post(
  "/collection/:id/sync",
  asyncHandler(async (req, res) => {
    const body = parseBody(enableFromAppSchema, req.body);
    res.json(
      await enableSyncFromApp(req.userId!, req.params.id, {
        url: body.url,
        profileScope: body.profile_scope,
        intervalHours: body.interval_hours,
      }),
    );
  }),
);

// Answers once the sync has started; how it went arrives as a notification, since reading a large
// collection is paced and can take minutes.
router.post(
  "/collection/:id/sync/run",
  asyncHandler(async (req, res) => {
    const sync = await syncForCollection(req.userId!, req.params.id);
    // Claimed before anything else is awaited, so two clicks at once can't both start a sync.
    if (!reserveSync(sync.id)) throw new HttpError(409, "This collection is already syncing");
    let started;
    try {
      // Answered here, so the click gets the reason, rather than a sync that quietly doesn't run.
      await assertProviderEnabled(sync.provider);
      const availableAt = syncNowAvailableAt(sync.lastCheckedAt);
      if (availableAt && availableAt.getTime() > Date.now()) {
        const minutes = Math.ceil((availableAt.getTime() - Date.now()) / 60_000);
        throw new HttpError(429, `It was checked a moment ago. Sync now is available again in ${minutes} min.`);
      }
      if (await getActiveJob(req.userId!)) {
        throw new HttpError(409, "An import is already in progress. Try again once it's done.");
      }
      // Marked checked as it starts, so the cool-down runs from the click.
      started = await prisma.collectionSync.update({ where: { id: sync.id }, data: { lastCheckedAt: new Date() } });
    } catch (err) {
      releaseSync(sync.id);
      throw err;
    }
    void runManualSync(sync.id, { reserved: true });
    res.status(202).json(toCollectionSyncOut(started));
  }),
);

router.delete(
  "/collection/:id/sync",
  asyncHandler(async (req, res) => {
    await disableSync(req.userId!, req.params.id);
    res.json({ ok: true });
  }),
);

export default router;
