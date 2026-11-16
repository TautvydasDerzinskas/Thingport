import path from "node:path";
import { Router, type Request } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { prisma } from "../db";
import { asyncHandler } from "../utils/asyncHandler";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { getPublicUrl } from "../services/settingsService";
import { sendTargetInputSchema } from "../services/sendTargetFormat";
import {
  createSendTarget,
  deleteSendTarget,
  exportSendTargets,
  fileFromGrant,
  importSendTargets,
  listSendTargets,
  sendToTarget,
  testSendTarget,
  updateSendTarget,
} from "../services/sendTargetService";

/** The instance's own address as the user reaches it: the one an admin set, else the page's. A plain http address on
 *  the local network is as good as any. */
async function instanceOrigin(req: Request): Promise<string> {
  const set = await getPublicUrl();
  if (set) return set;
  const origin = req.get("origin");
  if (origin && /^https?:\/\/[^/\s]+$/i.test(origin)) return origin;
  return `${req.protocol}://${req.get("host")}`;
}

// A file a Send to link names, by its signed grant: no sign-in, as whatever follows the link has none. Mounted before
// the routers that sign every path in.
export const sendFileRoutes = Router();
sendFileRoutes.get(
  "/send-file/:grant/:filename",
  asyncHandler(async (req, res) => {
    const file = await fileFromGrant(String(req.params.grant));
    res.setHeader("Content-Type", file.mime);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.filename)}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.sendFile(path.resolve(file.path));
  }),
);

// The user's destinations, under Configuration → Send to, and sending a model's file to one.
const router = Router();
router.use(requireAuth);

router.get(
  "/me/send-targets",
  asyncHandler(async (req, res) => {
    res.json({ targets: await listSendTargets(req.userId!) });
  }),
);

router.post(
  "/me/send-targets",
  asyncHandler(async (req, res) => {
    res.json(await createSendTarget(req.userId!, parseBody(sendTargetInputSchema, req.body)));
  }),
);

// Never a secret: an export is for sharing.
router.get(
  "/me/send-targets/export",
  asyncHandler(async (req, res) => {
    res.json(await exportSendTargets(req.userId!));
  }),
);

router.post(
  "/me/send-targets/import",
  asyncHandler(async (req, res) => {
    res.json({ targets: await importSendTargets(req.userId!, req.body) });
  }),
);

router.put(
  "/me/send-targets/:id",
  asyncHandler(async (req, res) => {
    res.json(await updateSendTarget(req.userId!, String(req.params.id), parseBody(sendTargetInputSchema, req.body)));
  }),
);

router.delete(
  "/me/send-targets/:id",
  asyncHandler(async (req, res) => {
    await deleteSendTarget(req.userId!, String(req.params.id));
    res.status(204).end();
  }),
);

router.post(
  "/me/send-targets/:id/test",
  asyncHandler(async (req, res) => {
    res.json(await testSendTarget(req.userId!, String(req.params.id)));
  }),
);

// `file` is the model page's own: a plate's id, or "prepared" for the prepared print.
const sendSchema = z.object({ file: z.string().min(1).max(100) });
router.post(
  "/print/:id/send/:targetId",
  asyncHandler(async (req, res) => {
    const { file } = parseBody(sendSchema, req.body);
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { id: true, displayName: true } });
    if (!user) throw new HttpError(401, "Unauthorized");
    res.json(
      await sendToTarget(user, String(req.params.id), file, String(req.params.targetId), await instanceOrigin(req)),
    );
  }),
);

export default router;
