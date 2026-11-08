import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../auth";
import { createLog } from "../services/auditLog";
import { getPublicUrl, getSocialSettings } from "../services/settingsService";
import { asyncHandler } from "../utils/asyncHandler";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { startDeliveryWorker, stopDeliveryWorker } from "../federation/delivery";
import { startLinks, stopLinks } from "../federation/links";
import { hasInstanceKeys, getInstanceKeys, instanceFingerprint } from "../federation/keys";
import {
  approveRequest,
  blockPeer,
  blockRequest,
  cancelOutgoing,
  checkPeer,
  connect,
  declineRequest,
  disconnectPeer,
  listInstances,
  lookupInstance,
  pausePeer,
  requestDetails,
  unblockPeer,
} from "../federation/peers";
import { canTurnOn, confirmedByPartners, probeProof, runReachabilityCheck } from "../federation/reachability";
import { getFederationSettings, updateFederationSettings } from "../federation/settings";
import { cancelUserRequest, createUserRequest, listMyRequests } from "../federation/userRequests";
import { prisma } from "../db";

/** Without signing in, so mounted beside the health check, ahead of the routers that ask for it: the reachability
 *  check fetches this from the instance's own Public URL, and only this instance can answer with its secret. */
export const federationProbeRoutes = Router();
federationProbeRoutes.get("/federation/probe/:nonce", (req, res) => {
  const { nonce } = req.params;
  if (!/^[a-f0-9]{16,64}$/.test(nonce)) {
    res.status(400).json({ error: "Bad nonce" });
    return;
  }
  res.json({ proof: probeProof(nonce) });
});

const router = Router();
router.use("/federation", requireAuth, requireAdmin);

async function settingsOut() {
  const [settings, social, publicUrl, keys] = await Promise.all([
    getFederationSettings(),
    getSocialSettings(),
    getPublicUrl(),
    hasInstanceKeys(),
  ]);
  return {
    enabled: settings.enabled,
    socialEnabled: social.enabled,
    publicUrl: publicUrl || null,
    reachability: settings.reachability,
    confirmedBy: settings.enabled ? await confirmedByPartners() : 0,
    fingerprint: keys ? await instanceFingerprint() : null,
  };
}

router.get(
  "/federation/settings",
  asyncHandler(async (_req, res) => {
    res.json(await settingsOut());
  }),
);

router.post(
  "/federation/check",
  asyncHandler(async (_req, res) => {
    const reachability = await runReachabilityCheck();
    res.json({ reachability, canTurnOn: canTurnOn(reachability) });
  }),
);

router.patch(
  "/federation/settings",
  asyncHandler(async (req, res) => {
    const { enabled } = parseBody(z.object({ enabled: z.boolean() }), req.body);
    if (enabled) {
      if (!(await getSocialSettings()).enabled) {
        throw new HttpError(409, "Turn social features on first", "social_off");
      }
      // Checked again here, not taken from the dialog: the address may have changed since. Not being reachable
      // doesn't stop it: this instance keeps a link open to each instance it connects to instead.
      const reachability = await runReachabilityCheck();
      if (!canTurnOn(reachability)) {
        throw reachability.kind === "not_set"
          ? new HttpError(409, "Set this instance's Public URL first: partners know it by that", "no_public_url")
          : new HttpError(
              422,
              "This instance's Public URL is this machine or a reserved range, which other instances never connect to",
              "reserved_address",
            );
      }
      await getInstanceKeys();
      await updateFederationSettings({ enabled: true });
      startDeliveryWorker();
      startLinks();
    } else {
      await updateFederationSettings({ enabled: false });
      stopDeliveryWorker();
      stopLinks();
    }
    void createLog({ userId: req.userId!, action: "federation_settings_changed", details: { enabled } });
    res.json(await settingsOut());
  }),
);

/** Looking an instance up and connecting need this instance's own identity, which exists once it's turned on, and
 *  social features, which it builds on and is quiet without. */
async function assertOn(): Promise<void> {
  if (!(await getFederationSettings()).enabled) {
    throw new HttpError(409, "Turn connected instances on first", "federation_off");
  }
  if (!(await getSocialSettings()).enabled) {
    throw new HttpError(409, "Turn social features on first", "social_off");
  }
}

router.get(
  "/federation/lookup",
  asyncHandler(async (req, res) => {
    await assertOn();
    const address = parseBody(z.string().min(1).max(500), req.query.address);
    res.json(await lookupInstance(address));
  }),
);

const connectSchema = z.object({
  address: z.string().min(1).max(500),
  fingerprint: z.string().min(1).max(64),
  note: z.string().max(1000).nullish(),
  /** One of this instance's people asked for it: their request is answered, and the Follow names them. */
  requestId: z.string().min(1).max(64).nullish(),
  /** Theirs can't reach this instance: this one keeps a link open to it instead. */
  link: z.boolean().optional(),
});
router.post(
  "/federation/connect",
  asyncHandler(async (req, res) => {
    await assertOn();
    const body = parseBody(connectSchema, req.body);
    res
      .status(201)
      .json(
        await connect(
          req.userId!,
          body.address,
          body.note ?? null,
          body.fingerprint,
          body.requestId ?? null,
          body.link ?? false,
        ),
      );
  }),
);

router.get(
  "/federation/instances",
  asyncHandler(async (_req, res) => {
    res.json(await listInstances());
  }),
);

router.get(
  "/federation/requests/:id",
  asyncHandler(async (req, res) => {
    await assertOn();
    res.json(await requestDetails(req.params.id));
  }),
);

router.post(
  "/federation/requests/:id/approve",
  asyncHandler(async (req, res) => {
    await assertOn();
    const { fingerprint } = parseBody(z.object({ fingerprint: z.string().min(1).max(64) }), req.body);
    res.json(await approveRequest(req.userId!, req.params.id, fingerprint));
  }),
);

router.post(
  "/federation/requests/:id/decline",
  asyncHandler(async (req, res) => {
    await declineRequest(req.userId!, req.params.id);
    res.status(204).end();
  }),
);

router.post(
  "/federation/requests/:id/block",
  asyncHandler(async (req, res) => {
    await blockRequest(req.userId!, req.params.id);
    res.status(204).end();
  }),
);

router.post(
  "/federation/peers/:id/pause",
  asyncHandler(async (req, res) => {
    const { paused } = parseBody(z.object({ paused: z.boolean() }), req.body);
    res.json(await pausePeer(req.userId!, req.params.id, paused));
  }),
);

router.post(
  "/federation/peers/:id/check",
  asyncHandler(async (req, res) => {
    await assertOn();
    res.json(await checkPeer(req.params.id));
  }),
);

/** A partner disconnected, or our own request to one withdrawn. */
router.post(
  "/federation/peers/:id/disconnect",
  asyncHandler(async (req, res) => {
    const peer = await prisma.peer.findUnique({ where: { id: req.params.id }, select: { status: true } });
    if (peer?.status === "OUTGOING") await cancelOutgoing(req.userId!, req.params.id);
    else await disconnectPeer(req.userId!, req.params.id);
    res.status(204).end();
  }),
);

router.post(
  "/federation/peers/:id/block",
  asyncHandler(async (req, res) => {
    res.json(await blockPeer(req.userId!, req.params.id));
  }),
);

router.post(
  "/federation/peers/:id/unblock",
  asyncHandler(async (req, res) => {
    await unblockPeer(req.userId!, req.params.id);
    res.status(204).end();
  }),
);

// People's own requests to reach someone on an instance this one isn't connected with: kept for the admins, nothing
// fetched (federation/userRequests.ts).
router.get(
  "/me/connection-requests",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await listMyRequests(req.userId!));
  }),
);

const userRequestSchema = z.object({
  handle: z.string().min(3).max(300),
  note: z.string().max(1000).nullish(),
});
router.post(
  "/me/connection-requests",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseBody(userRequestSchema, req.body);
    res.status(201).json(await createUserRequest(req.userId!, body.handle, body.note ?? null));
  }),
);

router.delete(
  "/me/connection-requests/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    await cancelUserRequest(req.userId!, req.params.id);
    res.status(204).end();
  }),
);

export default router;
