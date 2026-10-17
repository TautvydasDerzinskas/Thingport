import { Router } from "express";
import { z } from "zod";
import { issueToken, requireAuth } from "../auth";
import { prisma } from "../db";
import { toUserOut } from "../dto";
import { createLog } from "../services/auditLog";
import { CHALLENGE_PATTERN, approvePairing, claimPairing, grabConnectionUser } from "../services/grabPairingService";
import { asyncHandler } from "../utils/asyncHandler";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";

// Thingport Grab connected by approval instead of a saved password (see grabPairingService.ts). Mounted before
// the settings routes, whose router signs every /api request in: the extension's own calls here are public.
const router = Router();

// Its sessions don't count as a recent sign-in: holding the extension's token isn't proof of who's at the keyboard.
const NOT_A_SIGN_IN = new Date(0);

router.post(
  "/grab/pairings",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        challenge: z.string().regex(CHALLENGE_PATTERN, "This connection request is malformed"),
        name: z.string().trim().min(1).max(80),
      }),
      req.body,
    );
    res.json({ code: approvePairing(req.userId!, body.challenge, body.name) });
  }),
);

router.post(
  "/grab/pairings/claim",
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ code: z.string().min(1), verifier: z.string().min(43).max(128) }), req.body);
    const { token: connectionToken, userId } = await claimPairing(body.code, body.verifier);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const { token, expiresIn } = await issueToken(user.id, user.role, NOT_A_SIGN_IN);
    res.json({ connection_token: connectionToken, token, expires_in: expiresIn, user: toUserOut(user) });
    void createLog({ userId, action: "grab_connected" });
  }),
);

// What the extension calls instead of /login when its session runs out.
router.post(
  "/grab/session",
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ connection_token: z.string().min(1).max(200) }), req.body);
    const user = await grabConnectionUser(body.connection_token);
    if (!user) {
      throw new HttpError(401, "This browser's Thingport Grab connection was removed in Thingport. Connect it again.");
    }
    const { token, expiresIn } = await issueToken(user.id, user.role, NOT_A_SIGN_IN);
    res.json({ token, expires_in: expiresIn, user: toUserOut(user) });
  }),
);

router.get(
  "/profile/grab-connections",
  requireAuth,
  asyncHandler(async (req, res) => {
    const connections = await prisma.grabConnection.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: "desc" },
    });
    res.json(
      connections.map((connection) => ({
        id: connection.id,
        name: connection.name,
        connected_at: connection.createdAt,
        last_used_at: connection.lastUsedAt,
      })),
    );
  }),
);

router.delete(
  "/profile/grab-connections/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const deleted = await prisma.grabConnection.deleteMany({ where: { id: req.params.id, userId: req.userId! } });
    if (!deleted.count) throw new HttpError(404, "Connection not found");
    res.status(204).end();
    void createLog({ userId: req.userId!, action: "grab_disconnected" });
  }),
);

export default router;
