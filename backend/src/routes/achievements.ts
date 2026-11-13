import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../auth";
import { asyncHandler } from "../utils/asyncHandler";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { createLog } from "../services/auditLog";
import { getAchievementSettings, setAchievementSettings } from "../services/settingsService";
import {
  claimSecret,
  creditEveryone,
  markAchievementsSeen,
  ownAchievements,
  unseenAchievements,
} from "../services/achievementService";

// Achievements (services/achievementService.ts). Off means absent: a user's routes answer 404 while an admin has them
// off, and the web app shows no trace of them.

const router = Router();
router.use(requireAuth);

async function assertOn(): Promise<void> {
  if (!(await getAchievementSettings()).enabled) throw new HttpError(404, "Achievements are off", "achievements_off");
}

router.get(
  "/achievements/settings",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(await getAchievementSettings());
  }),
);

router.patch(
  "/achievements/settings",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { enabled } = parseBody(z.object({ enabled: z.boolean() }), req.body);
    const was = (await getAchievementSettings()).enabled;
    const settings = await setAchievementSettings({ enabled });
    res.json(settings);
    void createLog({ userId: req.userId!, action: "achievement_settings_changed", details: { enabled } });
    // Turned on: everyone gets what they'd earned already, in the background.
    if (enabled && !was) void creditEveryone().catch((err: unknown) => console.error("[achievements] crediting", err));
  }),
);

/** The user's own badges, best first, with how far each one's next tier is; `?unseen=1` for only the ones the app
 *  hasn't shown them yet, without the counts. */
router.get(
  "/me/achievements",
  asyncHandler(async (req, res) => {
    await assertOn();
    res.json(req.query.unseen === "1" ? await unseenAchievements(req.userId!) : await ownAchievements(req.userId!));
  }),
);

const badgeIds = z.array(z.string().min(1).max(100)).max(200);

/** The app has shown these, as they are now. */
router.post(
  "/me/achievements/seen",
  asyncHandler(async (req, res) => {
    await assertOn();
    const { badges } = parseBody(z.object({ badges: badgeIds }), req.body);
    await markAchievementsSeen(req.userId!, badges);
    res.status(204).end();
  }),
);

/** A secret a widget or tool gave away (`thingport.achievements.unlock`): `<its slug>/<key>`. */
router.post(
  "/me/achievements/secret",
  asyncHandler(async (req, res) => {
    await assertOn();
    const { secret } = parseBody(z.object({ secret: z.string().min(1).max(100) }), req.body);
    if (!(await claimSecret(req.userId!, secret))) throw new HttpError(404, "No such secret", "no_such_secret");
    res.status(204).end();
  }),
);

export default router;
