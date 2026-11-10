import type { PeerStatus } from "@prisma/client";
import express, { Router, type Request, type Response } from "express";
import { prisma } from "../db";
import { getBackendVersion } from "../services/versionService";
import { asyncHandler } from "../utils/asyncHandler";
import { originOf } from "./addresses";
import { canonicalHeaders, edgeFilter, keyIdOf } from "./edge";
import { instanceFingerprint } from "./keys";
import { answerAsk, answerReply, cameThroughLink, throughOwnLink } from "./links";
import {
  collectionModelsPage,
  collectionsPage,
  directory,
  modelsPage,
  parseModelsCursor,
  person,
  collectionsSharedWith,
  personNamed,
  sendMedia,
  sendSharedFile,
  sharedCollectionDoc,
  sharedCollectionItems,
  signingPartner,
} from "./publish";
import { getRuntime, INSTANCE } from "./runtime";
import { isFederationLive } from "./settings";

// Mounted at /api/ap ahead of express.json: signatures cover the body exactly as it came.
const router = Router();
const MAX_INBOX_BODY = 256 * 1024;
const FOLLOW_PATH = /^\/follows\/([A-Za-z0-9_-]{1,64})$/;
const KNOWN: PeerStatus[] = ["ACTIVE", "PAUSED", "OUTGOING"];

// Off means absent: nothing here answers, so nothing tells a visitor this instance could federate. Partners, and an
// instance we asked, are the exception: told to come back later, they keep what they send (an answer to our request
// too) and try again once this is on.
router.use(
  asyncHandler(async (req, res, next) => {
    if (await isFederationLive()) {
      next();
      return;
    }
    const known = { status: { in: KNOWN } };
    let waiting = false;
    const signedBy = originOf(keyIdOf(req.headers) ?? "");
    if (signedBy) {
      // A partner sending, or reading what this instance shares.
      waiting = Boolean(await prisma.peer.findFirst({ where: { origin: signedBy, ...known }, select: { id: true } }));
    } else if (req.method === "GET" && FOLLOW_PATH.test(req.path)) {
      // An instance we asked, checking we still want what we asked for before its admin approves.
      const id = FOLLOW_PATH.exec(req.path)![1];
      waiting = Boolean(
        await prisma.peer.findFirst({ where: { id, initiatedBy: "us", ...known }, select: { id: true } }),
      );
    }
    if (waiting) res.status(503).set("Retry-After", "3600").json({ error: "Paused" });
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

// A partner that can't be reached, keeping its link open (links.ts): opened with its secret, not a signature.
router.get("/link", asyncHandler(answerAsk));
router.post("/link/replies/:id", asyncHandler(answerReply));

router.post(
  ["/inbox", "/actors/:identifier/inbox"],
  express.raw({ type: () => true, limit: MAX_INBOX_BODY }),
  asyncHandler(edgeFilter),
  asyncHandler(viaFedify),
);
router.get(
  "/actors/:identifier",
  asyncHandler(async (req, res) => {
    if (req.params.identifier === INSTANCE) return viaFedify(req, res);
    // A person here who shares something, at the id the directory gave them: for partners only, as the directory is.
    if (!(await signingPartner(req))) {
      res.status(401).json({ error: "Not a connected instance" });
      return;
    }
    const body = await person(req.params.identifier);
    if (body) activityJson(res, body);
    else res.status(404).json({ error: "Not found" });
  }),
);

/** Our request to connect, while it stands: the instance we asked reads it before its admin approves, so a request we
 *  withdrew, or one from before a disconnect played back to it, isn't approved. Says no more than its own ids. */
router.get(
  "/follows/:id",
  asyncHandler(async (req, res) => {
    const peer = await prisma.peer.findFirst({
      where: { id: req.params.id, initiatedBy: "us", status: { in: ["OUTGOING", "ACTIVE", "PAUSED"] } },
    });
    if (!peer?.followId || !peer.actorUrl) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const runtime = await getRuntime();
    res.type("application/activity+json").json({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: peer.followId,
      type: "Follow",
      actor: runtime.actorUrl.href,
      object: peer.actorUrl,
    });
  }),
);

// What this instance's people share, for partners only: see publish.ts.
const partnerOnly = asyncHandler(async (req, res, next) => {
  const peer = await signingPartner(req);
  if (!peer) {
    res.status(401).json({ error: "Not a connected instance" });
    return;
  }
  res.locals.peer = peer;
  next();
});
const activityJson = (res: Response, body: unknown) => res.type("application/activity+json").send(JSON.stringify(body));

router.get(
  "/directory",
  partnerOnly,
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 0);
    if (Number.isInteger(page) && page >= 0 && page < 1000) activityJson(res, await directory(page));
    else res.status(404).json({ error: "Not found" });
  }),
);
router.get(
  "/actors/:id/models",
  partnerOnly,
  asyncHandler(async (req, res) => {
    const after = typeof req.query.after === "string" ? parseModelsCursor(req.query.after) : null;
    const body = req.query.after === undefined || after ? await modelsPage(req.params.id, after) : null;
    if (body) activityJson(res, body);
    else res.status(404).json({ error: "Not found" });
  }),
);
router.get(
  "/actors/:id/collections",
  partnerOnly,
  asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 0);
    if (Number.isInteger(page) && page >= 0 && page < 100)
      activityJson(res, await collectionsPage(req.params.id, page));
    else res.status(404).json({ error: "Not found" });
  }),
);
router.get(
  "/collections/:id/models",
  partnerOnly,
  asyncHandler(async (req, res) => {
    const offset = Number(req.query.offset ?? 0);
    const body =
      Number.isInteger(offset) && offset >= 0 && offset < 1_000_000
        ? await collectionModelsPage(req.params.id, offset)
        : null;
    if (body) activityJson(res, body);
    else res.status(404).json({ error: "Not found" });
  }),
);
// The collections shared with people on the partner asking, each, and its models (sharedCollections.ts).
router.get(
  "/shared",
  partnerOnly,
  asyncHandler(async (req, res) => {
    const after = req.query.after;
    if (after !== undefined && (typeof after !== "string" || !/^[a-z0-9_-]{1,40}$/i.test(after))) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    activityJson(res, await collectionsSharedWith(res.locals.peer, after ?? null));
  }),
);
router.get(
  "/collections/:id",
  partnerOnly,
  asyncHandler(async (req, res) => {
    const body = await sharedCollectionDoc(req.params.id, res.locals.peer);
    if (body) activityJson(res, body);
    else res.status(404).json({ error: "Not found" });
  }),
);
router.get(
  "/collections/:id/items",
  partnerOnly,
  asyncHandler(async (req, res) => {
    const after = typeof req.query.after === "string" ? parseModelsCursor(req.query.after) : null;
    const body =
      req.query.after === undefined || after
        ? await sharedCollectionItems(req.params.id, res.locals.peer, after)
        : null;
    if (body) activityJson(res, body);
    else res.status(404).json({ error: "Not found" });
  }),
);
// Someone here by their exact username, for a partner's person sharing a collection with them.
router.get(
  "/people/:username",
  partnerOnly,
  asyncHandler(async (req, res) => {
    const body = /^[a-z0-9_.-]{1,40}$/i.test(req.params.username)
      ? await personNamed(req.params.username, res.locals.peer)
      : null;
    if (body) activityJson(res, body);
    else res.status(404).json({ error: "Not found" });
  }),
);
router.get(
  ["/files/:kind/:id", "/files/:kind/:id/:name"],
  partnerOnly,
  asyncHandler(async (req, res) => {
    await sendSharedFile(res, req.params.kind, req.params.id, res.locals.peer);
  }),
);
router.get(
  "/media/:kind/:id",
  partnerOnly,
  asyncHandler(async (req, res) => {
    await sendMedia(res, req.params.kind, req.params.id, res.locals.peer);
  }),
);

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
  const viaLink = cameThroughLink(req.headers);
  const handle = () =>
    runtime.federation.fetch(request, {
      contextData: undefined,
      onNotFound: () => new Response(JSON.stringify({ error: "Not found" }), { status: 404 }),
      onNotAcceptable: () => new Response(JSON.stringify({ error: "Not acceptable" }), { status: 406 }),
    });
  const response = await (viaLink ? throughOwnLink.run(true, handle) : handle());
  res.status(response.status);
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
  // A partner's delivery that went through: proof it can reach this instance, unless it came down this one's link.
  if (req.method === "POST" && response.ok && !viaLink) {
    const origin = originOf(keyIdOf(req.headers) ?? "");
    if (origin) {
      await prisma.peer
        .updateMany({ where: { origin }, data: { lastInboundAt: new Date(), lastSeenAt: new Date() } })
        .catch(() => {});
    }
  }
}

export default router;
