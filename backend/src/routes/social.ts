import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { createLog } from "../services/auditLog";
import { copyPrintToLibrary } from "../services/modelCopyService";
import { printOutById } from "../services/printLoader";
import { getSocialSettings, setSocialSettings } from "../services/settingsService";
import {
  EMPTY_EXPLORE,
  exploreOverview,
  exploreUser,
  exploreUserModels,
  socialStatus,
} from "../services/socialService";
import { sendRemoteMedia } from "../federation/media";
import {
  instancesOut,
  remoteCollection,
  remoteModel,
  remoteOverview,
  remotePerson,
  remotePersonModels,
} from "../federation/remoteExplore";
import { remoteCopyStatus, startRemoteCopy } from "../federation/remoteCopy";
import { sendRemoteZip, streamRemoteFile } from "../federation/remoteFiles";
import { syncStale } from "../federation/remoteIndex";
import { isFederationLive } from "../federation/settings";
import { parseSortMode, splitList } from "../services/printQuery";

const router = Router();
router.use(requireAuth);

// For everyone: whether the sidebar offers Explore and Chats, and whether a collection's form offers making it public.
router.get(
  "/social",
  asyncHandler(async (_req, res) => {
    res.json(await socialStatus());
  }),
);

router.get(
  "/social/settings",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(await getSocialSettings());
  }),
);

const socialSettingsSchema = z.object({ enabled: z.boolean(), chats: z.boolean() }).partial();
router.patch(
  "/social/settings",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const patch = parseBody(socialSettingsSchema, req.body);
    const settings = await setSocialSettings(patch);
    res.json(settings);
    void createLog({ userId: req.userId!, action: "social_settings_changed", details: patch });
  }),
);

/** Explore is gone with social features: what's public then stays where its owner put it, unseen. */
async function assertSocialOn(): Promise<void> {
  if (!(await getSocialSettings()).enabled) throw new HttpError(404, "Social features are off", "social_off");
}

// Index older than this when someone opens Explore: read again in the background, for the next look.
const EXPLORE_FRESH_MS = 2 * 60 * 1000;

/** Explore, with partners' people, models and collections beside this instance's own while connected instances are
 *  on: ?scope=all (the default), here, or a partner's id for only theirs. `elsewhere` is read-only for now. */
router.get(
  "/explore",
  asyncHandler(async (req, res) => {
    await assertSocialOn();
    const scope = typeof req.query.scope === "string" ? req.query.scope : "all";
    const live = await isFederationLive();
    const local = !live || scope === "all" || scope === "here" ? await exploreOverview(req.userId!) : EMPTY_EXPLORE;
    if (!live) {
      res.json({ ...local, elsewhere: { people: [], recent_models: [], recent_collections: [] }, instances: [] });
      return;
    }
    void syncStale(EXPLORE_FRESH_MS).catch(() => {});
    const [elsewhere, instances] = await Promise.all([
      scope === "here"
        ? Promise.resolve({ people: [], recent_models: [], recent_collections: [] })
        : remoteOverview(scope === "all" ? null : scope),
      instancesOut(),
    ]);
    res.json({ ...local, elsewhere, instances });
  }),
);

/** Someone on a partner instance, a model or a collection of theirs, and their pictures: from what this instance keeps
 *  of what partners share (federation/remoteExplore.ts), while connected instances are on. */
async function assertElsewhere(): Promise<void> {
  await assertSocialOn();
  if (!(await isFederationLive())) throw new HttpError(404, "Connected instances are off", "federation_off");
}

router.get(
  "/explore/elsewhere/person/:id",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    const page = await remotePerson(req.params.id);
    if (!page) throw new HttpError(404, "Not found");
    res.json(page);
  }),
);

router.get(
  "/explore/elsewhere/person/:id/models",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    const limit = Number(req.query.limit ?? 24);
    const offset = Number(req.query.offset ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, "Invalid limit");
    if (!Number.isInteger(offset) || offset < 0) throw new HttpError(400, "Invalid offset");
    const page = await remotePersonModels(req.params.id, limit, offset);
    if (!page) throw new HttpError(404, "Not found");
    res.setHeader("X-Total-Count", String(page.total));
    res.setHeader("X-Has-More", offset + page.models.length < page.total ? "true" : "false");
    res.json(page.models);
  }),
);

router.get(
  "/explore/elsewhere/model/:id",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    const model = await remoteModel(req.params.id, req.userId!);
    if (!model) throw new HttpError(404, "Not found");
    res.json(model);
  }),
);

// A partner's model's files, through this instance: one as it comes (its name last, for slicers), or all zipped.
const sendRemoteFile = asyncHandler(async (req, res) => {
  await assertElsewhere();
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) throw new HttpError(404, "Not found");
  await streamRemoteFile(req, res, req.params.id, index);
});
router.get("/explore/elsewhere/model/:id/files/:index", sendRemoteFile);
router.get("/explore/elsewhere/model/:id/files/:index/:filename", sendRemoteFile);

router.get(
  "/explore/elsewhere/model/:id/files.zip",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    await sendRemoteZip(res, req.params.id);
  }),
);

// Copying a partner's model into the user's library runs in the background; GET says how it's going.
router.post(
  "/explore/elsewhere/model/:id/copy",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    res.json(await startRemoteCopy(req.userId!, req.params.id));
  }),
);

router.get(
  "/explore/elsewhere/model/:id/copy",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    res.json(await remoteCopyStatus(req.userId!, req.params.id));
  }),
);

router.get(
  "/explore/elsewhere/collection/:id",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    const page = await remoteCollection(req.params.id);
    if (!page) throw new HttpError(404, "Not found");
    res.json(page);
  }),
);

router.get(
  "/explore/elsewhere/media/:token",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    await sendRemoteMedia(req.params.token, res);
  }),
);

router.get(
  "/explore/user/:id",
  asyncHandler(async (req, res) => {
    await assertSocialOn();
    const page = await exploreUser(req.userId!, req.params.id);
    if (!page) throw new HttpError(404, "User not found");
    res.json(page);
  }),
);

// A user's own models, once they made them public: answered like GET /prints, a page with its count in the headers.
router.get(
  "/explore/user/:id/models",
  asyncHandler(async (req, res) => {
    await assertSocialOn();
    const limit = Number(req.query.limit ?? 24);
    const offset = Number(req.query.offset ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, "Invalid limit");
    if (!Number.isInteger(offset) || offset < 0) throw new HttpError(400, "Invalid offset");
    const page = await exploreUserModels(
      req.userId!,
      req.params.id,
      {
        generative: req.query.generative === "1" || req.query.generative === "true",
        excludeProviders: splitList(req.query.hide_providers),
      },
      { sort: parseSortMode(req.query.orderBy), limit, offset },
    );
    if (!page) throw new HttpError(404, "This user's models aren't public");
    res.setHeader("X-Has-More", page.hasMore ? "true" : "false");
    res.setHeader("X-Next-Offset", String(page.nextOffset));
    res.setHeader("X-Total-Count", String(page.total));
    res.json(page.prints);
  }),
);

// Another user's model, from one of their public collections, into the user's library. A model they already have isn't
// copied again: that one comes back. Filing one into a collection goes through the collection's own routes, which copy
// it first.
router.post(
  "/print/:id/copy",
  asyncHandler(async (req, res) => {
    const { print, copied } = await copyPrintToLibrary(req.userId!, req.params.id);
    res.json({ print: await printOutById(req.userId!, print.id), copied });
  }),
);

export default router;
