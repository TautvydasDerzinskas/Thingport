import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../auth";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { createLog } from "../services/auditLog";
import { addModelsToCollection } from "../services/collectionService";
import { copyPrintToLibrary } from "../services/modelCopyService";
import { printOutById } from "../services/printLoader";
import { getSocialSettings, setSocialSettings } from "../services/settingsService";
import { exploreOverview, exploreUser, socialStatus } from "../services/socialService";

const router = Router();
router.use(requireAuth);

// For everyone: whether the sidebar offers Explore, and whether a collection's form offers making it public.
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

const socialSettingsSchema = z.object({ enabled: z.boolean() }).partial();
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

// Another user's model, from one of their public collections, into the user's library; into one of their collections
// too with `collection_id`. A model they already have isn't copied again: that one is filed instead.
const copySchema = z.object({ collection_id: z.string().optional() });
router.post(
  "/print/:id/copy",
  asyncHandler(async (req, res) => {
    const body = parseBody(copySchema, req.body ?? {});
    if (body.collection_id) {
      const collection = await prisma.collection.findFirst({ where: { id: body.collection_id, userId: req.userId } });
      if (!collection || collection.toolId) throw new HttpError(404, "Collection not found");
    }
    const { print, copied } = await copyPrintToLibrary(req.userId!, req.params.id);
    if (body.collection_id) await addModelsToCollection(req.userId!, body.collection_id, [print.id]);
    res.json({ print: await printOutById(req.userId!, print.id), copied });
  }),
);

export default router;
