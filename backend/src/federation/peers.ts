import crypto from "node:crypto";
import type { webcrypto } from "node:crypto";
import type { Peer, Prisma } from "@prisma/client";
import type * as Vocab from "@fedify/vocab";
import { prisma } from "../db";
import { createLog } from "../services/auditLog";
import { createNotification } from "../services/notificationService";
import { HttpError } from "../utils/fileUtils";
import { originOf } from "./addresses";
import { invalidateAllowlist, isAllowedOrigin, withAllowedOrigin } from "./allowlist";
import { enqueueActivity, pendingDeliveryCounts } from "./delivery";
import { FederationFetchError, federationFetch, readJson } from "./fetch";
import { keyFingerprint } from "./keys";
import { AP_PREFIX, getRuntime, INSTANCE, type Runtime } from "./runtime";

type CryptoKey = webcrypto.CryptoKey;

const MAX_PENDING_INCOMING = 50;
const MAX_NOTE = 1000;

// ---------------------------------------------------------------------------------------------------------------------
// Looking an instance up

export type InstanceInfo = {
  origin: string;
  name: string;
  version: string | null;
  fingerprint: string;
  actorUrl: string;
  inboxUrl: string;
  publicKeys: unknown[];
  http: boolean;
};

/** An address as an admin typed it, as the instance's origin: `makerspace.example` means https. */
export function normalizeInstanceAddress(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const origin = originOf(withScheme);
  if (!origin) throw new HttpError(400, "That isn't an instance's address", "invalid_address");
  return origin;
}

/** What an instance says about itself, and its key: only fetched because an admin asked, and only from that
 *  instance. Checks it's a Thingport instance that takes connections, and that its actor is its own. */
export async function lookupInstance(input: string): Promise<InstanceInfo> {
  const origin = normalizeInstanceAddress(input);
  const runtime = await getRuntime();
  if (origin === runtime.origin) throw new HttpError(400, "That's this instance", "same_instance");
  return withAllowedOrigin(origin, async () => {
    let about: { software?: unknown; version?: unknown; name?: unknown; actor?: unknown };
    try {
      const response = await federationFetch(
        `${origin}${AP_PREFIX}/instance`,
        { headers: { Accept: "application/json" } },
        isAllowedOrigin,
      );
      if (response.status === 404) {
        throw new HttpError(422, "That instance doesn't take connections", "not_accepting");
      }
      if (!response.ok) throw new HttpError(502, `That instance answered ${response.status}`, "unreachable", true);
      about = ((await readJson(response)) ?? {}) as typeof about;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Couldn't reach ${origin}: ${(err as Error).message}`, "unreachable", true);
    }
    if (about.software !== "thingport" || typeof about.actor !== "string" || originOf(about.actor) !== origin) {
      throw new HttpError(422, "That isn't a Thingport instance", "not_thingport");
    }
    const actor = await fetchActor(runtime, about.actor);
    return {
      origin,
      name: typeof about.name === "string" && about.name.trim() ? about.name.trim().slice(0, 80) : new URL(origin).host,
      version: typeof about.version === "string" ? about.version.slice(0, 40) : null,
      ...actor,
      http: origin.startsWith("http:"),
    };
  });
}

async function fetchActor(
  runtime: Runtime,
  actorUrl: string,
): Promise<Pick<InstanceInfo, "fingerprint" | "actorUrl" | "inboxUrl" | "publicKeys">> {
  const options = { documentLoader: runtime.documentLoader as never, contextLoader: runtime.contextLoader as never };
  let actor: Vocab.Object;
  try {
    const { document } = await runtime.documentLoader(actorUrl);
    actor = await runtime.vocab.Object.fromJsonLd(document, options);
  } catch (err) {
    if (err instanceof FederationFetchError && err.code === "network") {
      throw new HttpError(502, `Couldn't reach that instance: ${err.message}`, "unreachable", true);
    }
    throw new HttpError(422, "That instance's actor couldn't be read", "not_thingport");
  }
  if (!runtime.vocab.isActor(actor) || actor.id?.href !== actorUrl) {
    throw new HttpError(422, "That instance's actor isn't its own", "not_thingport");
  }
  const rsa = await actor.getPublicKey(options);
  if (!rsa?.publicKey) throw new HttpError(422, "That instance publishes no key", "not_thingport");
  let ed25519: CryptoKey | null = null;
  for await (const method of actor.getAssertionMethods(options)) {
    if (method.publicKey && (method.publicKey as CryptoKey).algorithm.name === "Ed25519") {
      ed25519 = method.publicKey as CryptoKey;
      break;
    }
  }
  const inbox = actor.endpoints?.sharedInbox ?? actor.inboxId;
  if (!inbox || inbox.origin !== new URL(actorUrl).origin) {
    throw new HttpError(422, "That instance's inbox isn't its own", "not_thingport");
  }
  const publicKeys = [await runtime.fedify.exportJwk(rsa.publicKey as never)];
  if (ed25519) publicKeys.push(await runtime.fedify.exportJwk(ed25519 as never));
  return {
    fingerprint: await keyFingerprint(rsa.publicKey as CryptoKey, ed25519),
    actorUrl,
    inboxUrl: inbox.href,
    publicKeys,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Asking another instance (admin)

export async function connect(adminId: string, input: string, note: string | null, fingerprint: string) {
  const info = await lookupInstance(input);
  if (info.fingerprint !== fingerprint) {
    throw new HttpError(409, "That instance's key changed since you compared it. Look it up again.", "key_changed");
  }
  const existing = await prisma.peer.findUnique({ where: { origin: info.origin } });
  if (existing?.status === "BLOCKED")
    throw new HttpError(409, "You blocked that instance; unblock it first", "blocked");
  if (existing) throw new HttpError(409, "You're already connected with that instance, or asked it", "exists");
  // They may have asked us meanwhile: approving theirs is the same as asking them.
  const theirs = await prisma.peerRequest.findFirst({
    where: { kind: "INCOMING", status: "PENDING", origin: info.origin },
  });
  if (theirs) return approveRequest(adminId, theirs.id, info.fingerprint);

  const runtime = await getRuntime();
  const peer = await prisma.peer.create({
    data: {
      origin: info.origin,
      name: info.name,
      version: info.version,
      actorUrl: info.actorUrl,
      inboxUrl: info.inboxUrl,
      publicKeys: info.publicKeys as Prisma.InputJsonValue,
      fingerprint: info.fingerprint,
      status: "OUTGOING",
      initiatedBy: "us",
      note: clean(note),
    },
  });
  const follow = new runtime.vocab.Follow({
    id: new URL(`${AP_PREFIX}/follows/${peer.id}`, runtime.origin),
    actor: runtime.actorUrl,
    object: new URL(info.actorUrl),
    name: new URL(runtime.origin).host,
    content: peer.note ? escapeHtml(peer.note) : null,
  });
  await prisma.peer.update({ where: { id: peer.id }, data: { followId: follow.id!.href } });
  invalidateAllowlist();
  await enqueueActivity({
    origin: info.origin,
    inboxUrl: info.inboxUrl,
    peerId: peer.id,
    activity: await runtime.toJson(follow),
  });
  void createLog({
    userId: adminId,
    action: "federation_requested",
    targetId: peer.id,
    details: { origin: info.origin },
  });
  return { peer: peerOut(peer, 0) };
}

/** Ours, before they answer: withdrawn, and they're told. */
export async function cancelOutgoing(adminId: string, peerId: string): Promise<void> {
  const peer = await prisma.peer.findUnique({ where: { id: peerId } });
  if (!peer || peer.status !== "OUTGOING") throw new HttpError(404, "No such request", "not_found");
  await sayGoodbye(peer);
  await prisma.peer.delete({ where: { id: peer.id } });
  invalidateAllowlist();
  void createLog({
    userId: adminId,
    action: "federation_disconnected",
    targetId: peer.id,
    details: { origin: peer.origin },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Requests from other instances

type IncomingFollow = {
  type?: unknown;
  id?: unknown;
  actor?: unknown;
  object?: unknown;
  name?: unknown;
  content?: unknown;
  tag?: unknown;
};

/** A stranger's Follow of this instance, kept as it came for an admin: nothing in it is fetched or trusted until an
 *  admin opens it. Called by edge.ts before Fedify sees the request. */
export async function storeIncomingRequest(params: {
  origin: string;
  url: string;
  headers: Record<string, string>;
  raw: string;
  follow: IncomingFollow;
}): Promise<"stored" | "updated" | "full"> {
  const { follow } = params;
  const mentions = Array.isArray(follow.tag)
    ? (follow.tag as { type?: unknown; href?: unknown; name?: unknown }[])
    : [];
  const requester = mentions.find(
    (m) => m?.type === "Mention" && typeof m.href === "string" && originOf(m.href) === params.origin,
  );
  const target = mentions.find((m) => m?.type === "Mention" && m !== requester && typeof m.name === "string");
  const data = {
    url: params.url,
    headers: params.headers as Prisma.InputJsonValue,
    activity: params.raw,
    requesterName: null,
    requesterHandle: typeof requester?.name === "string" ? requester.name.replace(/^@/, "").slice(0, 200) : null,
    requesterUrl: typeof requester?.href === "string" ? requester.href.slice(0, 500) : null,
    targetHandle: typeof target?.name === "string" ? target.name.replace(/^@/, "").slice(0, 200) : null,
    note: typeof follow.content === "string" ? clean(stripHtml(follow.content)) : null,
  };
  const name = typeof follow.name === "string" ? follow.name.trim().slice(0, 80) || null : null;
  const pending = await prisma.peerRequest.findFirst({
    where: { kind: "INCOMING", status: "PENDING", origin: params.origin },
  });
  if (pending) {
    await prisma.peerRequest.update({ where: { id: pending.id }, data: { ...data, requesterName: name } });
    return "updated";
  }
  const count = await prisma.peerRequest.count({ where: { kind: "INCOMING", status: "PENDING" } });
  if (count >= MAX_PENDING_INCOMING) return "full";
  const created = await prisma.peerRequest.create({
    data: { ...data, requesterName: name, kind: "INCOMING", origin: params.origin },
  });
  const who = name ?? new URL(params.origin).host;
  await notifyAdmins({
    title: `${who} wants to connect`,
    body: data.note ?? `${params.origin} asks to connect with this instance.`,
    internalPath: `/admin-social?request=${created.id}`,
  });
  return "stored";
}

export type RequestDetails = InstanceInfo & { id: string; verified: true };

/** An incoming request, checked: its signature against the key the instance publishes now. Fetches from that
 *  instance, which is fine since an admin opened it. */
export async function requestDetails(id: string): Promise<RequestDetails> {
  const request = await prisma.peerRequest.findUnique({ where: { id } });
  if (!request || request.kind !== "INCOMING" || request.status !== "PENDING") {
    throw new HttpError(404, "No such request", "not_found");
  }
  const info = await lookupInstance(request.origin);
  await verifyStored(request.origin, request);
  return { ...info, id: request.id, verified: true };
}

async function verifyStored(
  origin: string,
  request: { url: string | null; headers: Prisma.JsonValue; activity: Prisma.JsonValue },
): Promise<Vocab.Follow> {
  const runtime = await getRuntime();
  return withAllowedOrigin(origin, async () => {
    const raw = typeof request.activity === "string" ? request.activity : "";
    const signed = new Request(request.url ?? `${runtime.origin}${AP_PREFIX}/inbox`, {
      method: "POST",
      headers: (request.headers ?? {}) as Record<string, string>,
      body: raw,
    });
    // An old signature is fine: the request waited for an admin, and the handshake after it proves both sides live.
    const key = await runtime.fedify
      .verifyRequest(signed, {
        documentLoader: runtime.documentLoader as never,
        contextLoader: runtime.contextLoader as never,
        timeWindow: false,
      })
      .catch(() => null);
    if (!key?.id || key.id.origin !== origin) {
      throw new HttpError(422, "That request's signature doesn't match the instance's key", "bad_signature");
    }
    const follow = await runtime.vocab.Follow.fromJsonLd(JSON.parse(raw), {
      documentLoader: runtime.documentLoader as never,
      contextLoader: runtime.contextLoader as never,
    });
    if (!follow.id || follow.actorId?.origin !== origin || follow.objectId?.href !== runtime.actorUrl.href) {
      throw new HttpError(422, "That request isn't a request to connect with this instance", "bad_signature");
    }
    return follow;
  });
}

export async function approveRequest(adminId: string, id: string, fingerprint: string) {
  const request = await prisma.peerRequest.findUnique({ where: { id } });
  if (!request || request.kind !== "INCOMING" || request.status !== "PENDING") {
    throw new HttpError(404, "No such request", "not_found");
  }
  const info = await lookupInstance(request.origin);
  if (info.fingerprint !== fingerprint) {
    throw new HttpError(
      409,
      "That instance's key changed since you compared it. Open the request again.",
      "key_changed",
    );
  }
  const follow = await verifyStored(request.origin, request);
  const runtime = await getRuntime();
  const existing = await prisma.peer.findUnique({ where: { origin: request.origin } });
  if (existing?.status === "BLOCKED")
    throw new HttpError(409, "You blocked that instance; unblock it first", "blocked");
  const data = {
    name: info.name,
    version: info.version,
    actorUrl: info.actorUrl,
    inboxUrl: info.inboxUrl,
    publicKeys: info.publicKeys as Prisma.InputJsonValue,
    fingerprint: info.fingerprint,
    status: "ACTIVE" as const,
    followId: follow.id!.href,
    initiatedBy: "them",
    connectedAt: new Date(),
    lastError: null,
  };
  const peer = existing
    ? await prisma.peer.update({ where: { id: existing.id }, data })
    : await prisma.peer.create({ data: { origin: request.origin, ...data } });
  await prisma.peerRequest.update({
    where: { id: request.id },
    data: { status: "APPROVED", decidedById: adminId, decidedAt: new Date() },
  });
  invalidateAllowlist();
  const accept = new runtime.vocab.Accept({
    id: activityId(runtime, "accept"),
    actor: runtime.actorUrl,
    object: follow,
  });
  await enqueueActivity({
    origin: peer.origin,
    inboxUrl: info.inboxUrl,
    peerId: peer.id,
    activity: await runtime.toJson(accept),
  });
  void createLog({
    userId: adminId,
    action: "federation_approved",
    targetId: peer.id,
    details: { origin: peer.origin },
  });
  return { peer: peerOut(peer, 0) };
}

/** Declined, and they're told when their request checks out; one that doesn't is just dropped. */
export async function declineRequest(adminId: string, id: string): Promise<void> {
  const request = await prisma.peerRequest.findUnique({ where: { id } });
  if (!request || request.kind !== "INCOMING" || request.status !== "PENDING") {
    throw new HttpError(404, "No such request", "not_found");
  }
  await prisma.peerRequest.update({
    where: { id },
    data: { status: "DECLINED", decidedById: adminId, decidedAt: new Date() },
  });
  void createLog({ userId: adminId, action: "federation_declined", targetId: id, details: { origin: request.origin } });
  try {
    const follow = await verifyStored(request.origin, request);
    const info = await lookupInstance(request.origin);
    const runtime = await getRuntime();
    const reject = new runtime.vocab.Reject({
      id: activityId(runtime, "reject"),
      actor: runtime.actorUrl,
      object: follow,
    });
    await enqueueActivity({ origin: request.origin, inboxUrl: info.inboxUrl, activity: await runtime.toJson(reject) });
  } catch {
    // Unreachable or not what it claimed: nothing to tell.
  }
}

/** Blocked without a word: this request is declined, and whatever comes from that instance later is dropped. */
export async function blockRequest(adminId: string, id: string): Promise<void> {
  const request = await prisma.peerRequest.findUnique({ where: { id } });
  if (!request || request.kind !== "INCOMING" || request.status !== "PENDING") {
    throw new HttpError(404, "No such request", "not_found");
  }
  await prisma.peerRequest.updateMany({
    where: { origin: request.origin, kind: "INCOMING", status: "PENDING" },
    data: { status: "DECLINED", decidedById: adminId, decidedAt: new Date() },
  });
  await prisma.peer.upsert({
    where: { origin: request.origin },
    create: { origin: request.origin, name: request.requesterName, status: "BLOCKED", initiatedBy: "them" },
    update: { status: "BLOCKED" },
  });
  invalidateAllowlist();
  void createLog({ userId: adminId, action: "federation_blocked", targetId: id, details: { origin: request.origin } });
}

// ---------------------------------------------------------------------------------------------------------------------
// Partners

export type PeerOut = {
  id: string;
  origin: string;
  name: string;
  version: string | null;
  fingerprint: string | null;
  status: Peer["status"];
  initiatedBy: string;
  note: string | null;
  http: boolean;
  createdAt: string;
  connectedAt: string | null;
  lastSeenAt: string | null;
  lastInboundAt: string | null;
  lastError: string | null;
  pending: number;
};

function peerOut(peer: Peer, pending: number): PeerOut {
  return {
    id: peer.id,
    origin: peer.origin,
    name: peer.name ?? new URL(peer.origin).host,
    version: peer.version,
    fingerprint: peer.fingerprint,
    status: peer.status,
    initiatedBy: peer.initiatedBy,
    note: peer.note,
    http: peer.origin.startsWith("http:"),
    createdAt: peer.createdAt.toISOString(),
    connectedAt: peer.connectedAt?.toISOString() ?? null,
    lastSeenAt: peer.lastSeenAt?.toISOString() ?? null,
    lastInboundAt: peer.lastInboundAt?.toISOString() ?? null,
    lastError: peer.lastError,
    pending,
  };
}

export async function listInstances() {
  const [peers, incoming, pending] = await Promise.all([
    prisma.peer.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.peerRequest.findMany({
      where: { kind: "INCOMING", status: "PENDING" },
      orderBy: { createdAt: "desc" },
    }),
    pendingDeliveryCounts(),
  ]);
  const out = (peer: Peer) => peerOut(peer, pending.get(peer.id) ?? 0);
  return {
    incoming: incoming.map((request) => ({
      id: request.id,
      origin: request.origin,
      // As the request named itself: confirmed only once an admin opens it.
      name: request.requesterName ?? new URL(request.origin).host,
      http: request.origin.startsWith("http:"),
      requesterHandle: request.requesterHandle,
      targetHandle: request.targetHandle,
      note: request.note,
      createdAt: request.createdAt.toISOString(),
    })),
    outgoing: peers.filter((peer) => peer.status === "OUTGOING").map(out),
    partners: peers.filter((peer) => peer.status === "ACTIVE" || peer.status === "PAUSED").map(out),
    blocked: peers.filter((peer) => peer.status === "BLOCKED").map(out),
  };
}

async function findPeer(id: string): Promise<Peer> {
  const peer = await prisma.peer.findUnique({ where: { id } });
  if (!peer) throw new HttpError(404, "No such instance", "not_found");
  return peer;
}

export async function pausePeer(adminId: string, id: string, paused: boolean): Promise<PeerOut> {
  const peer = await findPeer(id);
  if (peer.status !== "ACTIVE" && peer.status !== "PAUSED") throw new HttpError(409, "Not a partner", "not_partner");
  const updated = await prisma.peer.update({ where: { id }, data: { status: paused ? "PAUSED" : "ACTIVE" } });
  invalidateAllowlist();
  void createLog({
    userId: adminId,
    action: paused ? "federation_paused" : "federation_resumed",
    targetId: id,
    details: { origin: peer.origin },
  });
  return peerOut(updated, 0);
}

/** Disconnected: they're told, and everything of theirs cached here goes; copies people made stay. */
export async function disconnectPeer(adminId: string, id: string): Promise<void> {
  const peer = await findPeer(id);
  if (peer.status === "BLOCKED") throw new HttpError(409, "That instance is blocked", "blocked");
  await sayGoodbye(peer);
  await prisma.peer.delete({ where: { id } });
  invalidateAllowlist();
  void createLog({
    userId: adminId,
    action: "federation_disconnected",
    targetId: id,
    details: { origin: peer.origin },
  });
}

export async function blockPeer(adminId: string, id: string): Promise<PeerOut> {
  const peer = await findPeer(id);
  if (peer.status !== "BLOCKED") await sayGoodbye(peer);
  const updated = await prisma.peer.update({ where: { id }, data: { status: "BLOCKED", lastError: null } });
  invalidateAllowlist();
  void createLog({ userId: adminId, action: "federation_blocked", targetId: id, details: { origin: peer.origin } });
  return peerOut(updated, 0);
}

export async function unblockPeer(adminId: string, id: string): Promise<void> {
  const peer = await findPeer(id);
  if (peer.status !== "BLOCKED") throw new HttpError(409, "That instance isn't blocked", "not_blocked");
  await prisma.peer.delete({ where: { id } });
  invalidateAllowlist();
  void createLog({ userId: adminId, action: "federation_unblocked", targetId: id, details: { origin: peer.origin } });
}

/** Looks a partner up again: whether it answers, and whether its key is still the one compared. */
export async function checkPeer(id: string): Promise<PeerOut> {
  const peer = await findPeer(id);
  try {
    const info = await lookupInstance(peer.origin);
    const changed = peer.fingerprint && info.fingerprint !== peer.fingerprint;
    const updated = await prisma.peer.update({
      where: { id },
      data: {
        name: info.name,
        version: info.version,
        lastSeenAt: new Date(),
        lastError: changed ? `Its key changed: now ${info.fingerprint}` : null,
      },
    });
    return peerOut(updated, 0);
  } catch (err) {
    const updated = await prisma.peer.update({ where: { id }, data: { lastError: (err as Error).message } });
    return peerOut(updated, 0);
  }
}

/** Tells a partner, or an instance we asked, that we're done: Undo our Follow, or Reject theirs. */
async function sayGoodbye(peer: Peer): Promise<void> {
  if (!peer.followId || !peer.actorUrl || !peer.inboxUrl) return;
  const runtime = await getRuntime().catch(() => null);
  if (!runtime) return;
  const { Follow, Reject, Undo } = runtime.vocab;
  const activity =
    peer.initiatedBy === "us"
      ? new Undo({
          id: activityId(runtime, "undo"),
          actor: runtime.actorUrl,
          object: new Follow({ id: new URL(peer.followId), actor: runtime.actorUrl, object: new URL(peer.actorUrl) }),
        })
      : new Reject({
          id: activityId(runtime, "reject"),
          actor: runtime.actorUrl,
          object: new Follow({ id: new URL(peer.followId), actor: new URL(peer.actorUrl), object: runtime.actorUrl }),
        });
  await enqueueActivity({ origin: peer.origin, inboxUrl: peer.inboxUrl, activity: await runtime.toJson(activity) });
}

// ---------------------------------------------------------------------------------------------------------------------
// What partners send (inbox.ts), already verified

async function touch(origin: string): Promise<Peer | null> {
  const peer = await prisma.peer.findUnique({ where: { origin } });
  if (!peer) return null;
  return prisma.peer.update({ where: { id: peer.id }, data: { lastInboundAt: new Date(), lastSeenAt: new Date() } });
}

/** A Follow from an instance we asked (we both asked) or are connected with (it asks again): accepted. */
export async function onFollowReceived(origin: string, follow: Vocab.Follow): Promise<void> {
  const peer = await touch(origin);
  if (!peer || (peer.status !== "OUTGOING" && peer.status !== "ACTIVE")) return;
  const runtime = await getRuntime();
  if (follow.objectId?.href !== runtime.actorUrl.href || !peer.inboxUrl) return;
  if (peer.status === "OUTGOING") await becomeConnected(peer);
  const accept = new runtime.vocab.Accept({
    id: activityId(runtime, "accept"),
    actor: runtime.actorUrl,
    object: follow,
  });
  await enqueueActivity({ origin, inboxUrl: peer.inboxUrl, peerId: peer.id, activity: await runtime.toJson(accept) });
}

export async function onAcceptReceived(origin: string, objectId: string | null): Promise<void> {
  const peer = await touch(origin);
  if (!peer || peer.status !== "OUTGOING" || (objectId && peer.followId && objectId !== peer.followId)) return;
  await becomeConnected(peer);
}

export async function onRejectReceived(origin: string, objectId: string | null): Promise<void> {
  const peer = await prisma.peer.findUnique({ where: { origin } });
  if (!peer || peer.status === "BLOCKED") return;
  if (objectId && peer.followId && objectId !== peer.followId) return;
  await prisma.peer.delete({ where: { id: peer.id } });
  invalidateAllowlist();
  const who = peer.name ?? new URL(origin).host;
  await notifyAdmins(
    peer.status === "OUTGOING"
      ? { title: `${who} declined to connect`, body: null, internalPath: "/admin-social" }
      : {
          title: `${who} disconnected`,
          body: "It's no longer a partner of this instance.",
          internalPath: "/admin-social",
        },
  );
}

/** An Undo of their Follow, or a Block: they ended it. */
export async function onDisconnectReceived(origin: string, objectId: string | null): Promise<void> {
  const peer = await prisma.peer.findUnique({ where: { origin } });
  if (!peer || peer.status === "BLOCKED") return;
  if (objectId && peer.followId && objectId !== peer.followId) return;
  await prisma.peer.delete({ where: { id: peer.id } });
  invalidateAllowlist();
  const who = peer.name ?? new URL(origin).host;
  await notifyAdmins({
    title: peer.status === "OUTGOING" ? `${who} withdrew its request` : `${who} disconnected`,
    body: null,
    internalPath: "/admin-social",
  });
}

async function becomeConnected(peer: Peer): Promise<void> {
  await prisma.peer.update({
    where: { id: peer.id },
    data: { status: "ACTIVE", connectedAt: new Date(), lastError: null },
  });
  invalidateAllowlist();
  const who = peer.name ?? new URL(peer.origin).host;
  await notifyAdmins({ title: `Connected with ${who}`, body: `${who} accepted.`, internalPath: "/admin-social" });
}

// ---------------------------------------------------------------------------------------------------------------------

async function notifyAdmins(text: { title: string; body: string | null; internalPath: string }): Promise<void> {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  await Promise.all(
    admins.map((admin) => createNotification(admin.id, { type: "federation", ...text }).catch(() => {})),
  );
}

function activityId(runtime: Runtime, kind: string): URL {
  return new URL(`${AP_PREFIX}/activities/${kind}/${crypto.randomUUID()}`, runtime.origin);
}

function clean(text: string | null | undefined): string | null {
  const trimmed = (text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NOTE);
  return trimmed || null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeHtml(text: string): string {
  return `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}</p>`;
}

export { INSTANCE };
