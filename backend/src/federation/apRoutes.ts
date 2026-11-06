import express, { Router, type Request, type Response } from "express";
import { prisma } from "../db";
import { getBackendVersion } from "../services/versionService";
import { asyncHandler } from "../utils/asyncHandler";
import { originOf } from "./addresses";
import { canonicalHeaders, edgeFilter, keyIdOf } from "./edge";
import { instanceFingerprint } from "./keys";
import { getRuntime } from "./runtime";
import { isFederationLive } from "./settings";

// Mounted at /api/ap ahead of express.json: signatures cover the body exactly as it came.
const router = Router();
const MAX_INBOX_BODY = 256 * 1024;

// Off means absent: nothing here answers, so nothing tells a visitor this instance could federate. A partner's
// delivery is the exception: told to come back later, it keeps it and tries again once this is on.
router.use(
  asyncHandler(async (req, res, next) => {
    if (await isFederationLive()) {
      next();
      return;
    }
    const origin = req.method === "POST" ? originOf(keyIdOf(req.headers) ?? "") : null;
    const partner = origin
      ? await prisma.peer.findFirst({ where: { origin, status: { in: ["ACTIVE", "PAUSED"] } }, select: { id: true } })
      : null;
    if (partner) res.status(503).set("Retry-After", "3600").json({ error: "Paused" });
    else res.status(404).json({ error: "Not found" });
  }),
);

/** What another Thingport instance reads when an admin there looks this one up. */
router.get(
  "/instance",
  asyncHandler(async (_req, res) => {
    const runtime = await getRuntime();
    res.json({
      software: "thingport",
      version: getBackendVersion(),
      name: new URL(runtime.origin).host,
      actor: runtime.actorUrl.href,
      fingerprint: await instanceFingerprint(),
    });
  }),
);

router.post(
  ["/inbox", "/actors/:identifier/inbox"],
  express.raw({ type: () => true, limit: MAX_INBOX_BODY }),
  asyncHandler(edgeFilter),
  asyncHandler(viaFedify),
);
router.get("/actors/:identifier", asyncHandler(viaFedify));

router.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

/** Hands the request to Fedify at the address its Public URL gives it, and its answer back. */
async function viaFedify(req: Request, res: Response): Promise<void> {
  const runtime = await getRuntime();
  const body = req.method === "POST" && Buffer.isBuffer(req.body) ? req.body : undefined;
  const request = new Request(new URL(req.originalUrl, runtime.origin), {
    method: req.method,
    headers: canonicalHeaders(req.headers, runtime.origin),
    body,
  });
  const response = await runtime.federation.fetch(request, {
    contextData: undefined,
    onNotFound: () => new Response(JSON.stringify({ error: "Not found" }), { status: 404 }),
    onNotAcceptable: () => new Response(JSON.stringify({ error: "Not acceptable" }), { status: 406 }),
  });
  res.status(response.status);
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
  // A partner's delivery that went through: proof it can reach this instance.
  if (req.method === "POST" && response.ok) {
    const origin = originOf(keyIdOf(req.headers) ?? "");
    if (origin) {
      await prisma.peer
        .updateMany({ where: { origin }, data: { lastInboundAt: new Date(), lastSeenAt: new Date() } })
        .catch(() => {});
    }
  }
}

export default router;
