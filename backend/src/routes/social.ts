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
import { exploreOverview, exploreUser, exploreUserModels, socialStatus } from "../services/socialService";
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

router.get(
  "/explore",
  asyncHandler(async (req, res) => {
    await assertSocialOn();
    res.json(await exploreOverview(req.userId!));
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
