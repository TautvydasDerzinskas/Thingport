import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { prisma } from "../db";
import type { OpenedFile } from "../modelFiles/storageFs";
import { asyncHandler } from "../utils/asyncHandler";
import { attachmentDisposition, HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { handlePath } from "../services/fileReuse";
import { getPublicUrl } from "../services/settingsService";
import { sendPlacementSchema, sendTargetInputSchema, sendTargetUpdateSchema } from "../services/sendTargetFormat";
import {
  createSendTarget,
  deleteSendTarget,
  exportSendTargets,
  fileFromGrant,
  importSendTargets,
  openFileToSend,
  placeSendTarget,
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

/** Sends an open file by its handle (Fs 2): the bytes that were opened, whatever is at their path by now, with send's
 *  Range, ETag and 304 kept. Closes the handle once it's sent; errors go on as sendFile's own do. */
function sendOpened(res: Response, next: NextFunction, opened: OpenedFile): void {
  res.sendFile(handlePath(opened.handle), (err?: NodeJS.ErrnoException) => {
    void opened.handle.close().catch(() => undefined);
    if (err && err.code !== "ECONNABORTED" && err.syscall !== "write") next(err);
  });
}

// A file a Send to link names, by its signed grant: no sign-in, as whatever follows the link has none. Mounted before
// the routers that sign every path in.
export const sendFileRoutes = Router();
sendFileRoutes.get(
  "/send-file/:grant/:filename",
  asyncHandler(async (req, res, next) => {
    const file = await fileFromGrant(String(req.params.grant));
    const opened = await openFileToSend(file, "Not found");
    res.setHeader("Content-Type", file.mime);
    // A plain name where it is one, and the whole name as UTF-8 beside it where it isn't.
    res.setHeader("Content-Disposition", attachmentDisposition(file.filename));
    res.setHeader("Cache-Control", "private, no-store");
    sendOpened(res, next, opened);
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

// No API key or secret header: an export is for sharing.
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
    res.json(await updateSendTarget(req.userId!, String(req.params.id), parseBody(sendTargetUpdateSchema, req.body)));
  }),
);

router.put(
  "/me/send-targets/:id/placement",
  asyncHandler(async (req, res) => {
    const { placement } = parseBody(sendPlacementSchema, req.body);
    res.json(await placeSendTarget(req.userId!, String(req.params.id), placement));
  }),
);

router.delete(
  "/me/send-targets/:id",
  asyncHandler(async (req, res) => {
    await deleteSendTarget(req.userId!, String(req.params.id));
    res.status(204).end();
  }),
);

// A test of a new one's settings, before it's saved.
router.post(
  "/me/send-targets/test",
  asyncHandler(async (req, res) => {
    res.json(await testSendTarget(req.userId!, null, parseBody(sendTargetInputSchema, req.body)));
  }),
);

// A saved one's, as it's being edited (with its kept secrets where none are typed in), or as saved with no body.
router.post(
  "/me/send-targets/:id/test",
  asyncHandler(async (req, res) => {
    const draft = req.body?.how === undefined ? undefined : parseBody(sendTargetInputSchema, req.body);
    res.json(await testSendTarget(req.userId!, String(req.params.id), draft));
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
