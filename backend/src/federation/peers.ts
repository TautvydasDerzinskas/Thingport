import crypto from "node:crypto";
import type { webcrypto } from "node:crypto";
import { Prisma, type Peer, type PeerRequest } from "@prisma/client";
import type * as Vocab from "@fedify/vocab";
import { prisma } from "../db";
import { createLog } from "../services/auditLog";
import { createNotification } from "../services/notificationService";
import { ensureUsername } from "../services/usernames";
import { HttpError } from "../utils/fileUtils";
import { classifyHost, originOf } from "./addresses";
import { invalidateAllowlist, isAllowedOrigin, throughRequestLink, withAllowedOrigin } from "./allowlist";
import { enqueueActivity, kickDelivery, pendingDeliveryCounts } from "./delivery";
import { FederationFetchError, fetchDirectly, federationFetch, readJson } from "./fetch";
import { keyFingerprint } from "./keys";
import { onlyComparedKeys, publishedKeys } from "./pinning";
import {
  linkApproved,
  linkEnded,
  linkOpen,
  linkTokenIn,
  newLinkToken,
  ownLinkOpen,
  reachedDirectly,
  requestLinkOpen,
  sha256,
  throughOwnLink,
} from "./links";
import { getFederationSettings } from "./settings";
import { forgetPeerContent, syncPeer } from "./remoteIndex";
import { notifyRequesters, originsFor } from "./userRequests";
import { AP_PREFIX, getRuntime, INSTANCE, type Runtime } from "./runtime";
import { paragraphOf, textOfHtml } from "../utils/htmlEntities";

type CryptoKey = webcrypto.CryptoKey;

const MAX_PENDING_INCOMING = 50;
// A few per instance: a forged one under its address can't push out the one it really sent.
const MAX_PENDING_PER_ORIGIN = 3;
// New instances asking, an hour: a request can't be checked before an admin opens it (that would fetch from wherever a
// stranger says), so one sender inventing addresses fills the list, and admins' notifications, no faster than this.
export const MAX_NEW_INCOMING_PER_HOUR = 10;
const REQUESTS_LOCK = 74_210_305;
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
  /** Why this instance should keep a link open to it, if it should: nothing reaches this one at its Public URL
   *  (`unreachable`), or it's on the internet and this one is on a local network only (`local`) or on a public address
   *  nothing has confirmed (`unconfirmed`). */
  suggestLink?: LinkReason | null;
};

export type LinkReason = "unreachable" | "local" | "unconfirmed";

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
  try {
    const { info } = await lookupWithActor(input);
    return { ...info, suggestLink: await linkReason(info.origin) };
  } catch (err) {
    // Out of reach from here, but asked through a link: that request is the way to connect it.
    if (err instanceof HttpError && err.code === "unreachable") {
      const waiting = await prisma.peerRequest.count({
        where: {
          kind: "INCOMING",
          status: "PENDING",
          origin: normalizeInstanceAddress(input),
          linkToken: { not: null },
        },
      });
      if (waiting) {
        throw new HttpError(
          409,
          "That instance asked to connect through a link: answer its request",
          "asked_with_link",
        );
      }
    }
    throw err;
  }
}

/** Why an instance at `origin` likely can't reach this one, if it likely can't. */
async function linkReason(origin: string): Promise<LinkReason | null> {
  const kind = (await getFederationSettings()).reachability?.kind;
  // Not even this instance answered at its address: on the same network or not, no other one can.
  if (kind === "unreachable" || kind === "elsewhere") return "unreachable";
  if (kind !== "local" && kind !== "public_unverified") return null;
  const theirs = await classifyHost(new URL(origin).hostname).catch(() => null);
  if (theirs?.kind !== "public") return null;
  return kind === "local" ? "local" : "unconfirmed";
}

/** Fetches what `request` needs from its instance through the link it keeps open, if it keeps one: telling an admin
 *  that link isn't open, rather than that the instance can't be reached. */
async function viaItsLink<T>(request: PeerRequest, fn: () => Promise<T>): Promise<T> {
  if (!request.linkToken) return fn();
  try {
    return await throughRequestLink(request.origin, request.id, fn);
  } catch (err) {
    if (err instanceof HttpError && err.code === "unreachable") {
      throw new HttpError(409, "Its link isn't open right now: its instance may be off", "link_closed");
    }
    throw err;
  }
}

/** The actor document a lookup read, so a request can be checked against exactly the key an admin compared. */
type ActorDocument = { url: string; document: unknown };

async function lookupWithActor(input: string): Promise<{ info: InstanceInfo; actor: ActorDocument }> {
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
      if (!response.ok) await response.body?.cancel().catch(() => {});
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
    const { document, ...actor } = await fetchActor(runtime, about.actor);
    return {
      info: {
        origin,
        name:
          typeof about.name === "string" && about.name.trim() ? about.name.trim().slice(0, 80) : new URL(origin).host,
        version: typeof about.version === "string" ? about.version.slice(0, 40) : null,
        ...actor,
        http: origin.startsWith("http:"),
      },
      actor: { url: about.actor, document },
    };
  });
}

async function fetchActor(
  runtime: Runtime,
  actorUrl: string,
): Promise<Pick<InstanceInfo, "fingerprint" | "actorUrl" | "inboxUrl" | "publicKeys"> & { document: unknown }> {
  const options = { documentLoader: runtime.documentLoader as never, contextLoader: runtime.contextLoader as never };
  let actor: Vocab.Object;
  let document: unknown;
  try {
    ({ document } = await runtime.documentLoader(actorUrl));
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
    document,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Asking another instance (admin)

/** Asks another instance to connect. With `requestId`, on behalf of one of this instance's people, whose request it
 *  answers -- along with any other request here to reach someone there: the Follow names each of them and whom they
 *  want to reach. */
export async function connect(
  adminId: string,
  input: string,
  note: string | null,
  fingerprint: string,
  requestId: string | null = null,
  link = false,
) {
  const asked = requestId ? await prisma.peerRequest.findUnique({ where: { id: requestId } }) : null;
  if (requestId && (!asked || asked.kind !== "LOCAL" || asked.status !== "PENDING")) {
    throw new HttpError(404, "No such request", "not_found");
  }
  const info = await lookupInstance(input);
  if (info.fingerprint !== fingerprint) {
    throw new HttpError(409, "That instance's key changed since you compared it. Look it up again.", "key_changed");
  }
  const existing = await prisma.peer.findUnique({ where: { origin: info.origin } });
  if (existing?.status === "BLOCKED")
    throw new HttpError(409, "You blocked that instance; unblock it first", "blocked");
  if (existing) {
    // Someone's request for an instance already connected, or already asked: nothing more to send.
    if (asked) {
      const settled = await prisma.$transaction((tx) => settleUserRequests(tx, adminId, info, [asked.id]));
      if (!settled.length) throw new HttpError(409, "That request was answered meanwhile", "not_found");
      await tellRequesters(settled, info, existing.status === "OUTGOING" ? "sent" : "connected");
      return { peer: peerOut(existing, 0) };
    }
    throw new HttpError(409, "You're already connected with that instance, or asked it", "exists");
  }
  // They may have asked us meanwhile: approving theirs is the same as asking them. Only one checked against what was
  // just looked up: one with a link is answered under Requests, and none from that instance is asked as usual.
  const theirs = await prisma.peerRequest.findFirst({
    where: { kind: "INCOMING", status: "PENDING", origin: info.origin, linkToken: null },
  });
  const approved = theirs
    ? await approveRequest(adminId, theirs.id, info.fingerprint).catch((err) => {
        if (err instanceof HttpError && ["bad_signature", "withdrawn", "not_found"].includes(err.code ?? "")) {
          return null;
        }
        throw err;
      })
    : null;
  if (approved) {
    if (asked) {
      const settled = await prisma.$transaction((tx) => settleUserRequests(tx, adminId, info, [asked.id]));
      await tellRequesters(settled, info, "connected");
    }
    return approved;
  }

  const runtime = await getRuntime();
  if (asked && !note) note = asked.note;
  // Kept open by this instance, as theirs can't reach it: opened with a secret only the two know, sent in the request.
  const linkToken = link ? newLinkToken() : null;
  // Everyone here waiting to reach someone at that instance, whatever address their handle guessed.
  const host = new URL(info.origin).host;
  const waiting = await prisma.peerRequest.findMany({
    where: {
      kind: "LOCAL",
      status: "PENDING",
      OR: [...(requestId ? [{ id: requestId }] : []), { origin: { in: originsFor(info.origin) } }],
    },
    orderBy: { createdAt: "asc" },
  });
  // As they're called now (a username can change while a request waits), and at the address the admin checked.
  const ourHost = new URL(runtime.origin).host;
  const asks = (
    await Promise.all(
      waiting.map(async (request) => {
        if (!request.userId) return null;
        // One that can't be named fails the Connect, for the admin to try again: never a Follow without some of them.
        const username = await ensureUsername(request.userId);
        const targetName = request.targetHandle?.split("@")[0] ?? null;
        return {
          id: request.id,
          userId: request.userId,
          requesterHandle: `${username}@${ourHost}`,
          targetHandle: targetName ? `${targetName}@${host}` : null,
        };
      }),
    )
  ).filter((ask) => ask !== null);

  // The request, its sending, and the requests it answers, together: a peer waiting on a Follow that never went
  // out would wait for good, and a request withdrawn or declined meanwhile isn't sent on.
  const { peer, settled } = await prisma.$transaction(async (tx) => {
    const settledRows = await settleUserRequests(
      tx,
      adminId,
      info,
      asks.map((ask) => ask.id),
      asks,
    );
    if (asked && !settledRows.some((row) => row.id === asked.id)) {
      throw new HttpError(409, "That request was answered meanwhile", "not_found");
    }
    const sent = asks.filter((ask) => settledRows.some((row) => row.id === ask.id));
    const created = await tx.peer.create({
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
        link: linkToken ? "ours" : null,
        linkToken,
      },
    });
    const follow = new runtime.vocab.Follow({
      id: new URL(`${AP_PREFIX}/follows/${created.id}`, runtime.origin),
      actor: runtime.actorUrl,
      object: new URL(info.actorUrl),
      name: ourHost,
      content: created.note ? paragraphOf(created.note) : null,
      // Who asked here, each followed by whom they want to reach there, as Mentions their admin is shown.
      tags: sent.flatMap((ask) => [
        new runtime.vocab.Mention({
          href: new URL(`${AP_PREFIX}/actors/${ask.userId}`, runtime.origin),
          name: `@${ask.requesterHandle}`,
        }),
        ...(ask.targetHandle ? [new runtime.vocab.Mention({ name: `@${ask.targetHandle}` })] : []),
      ]),
    });
    const activity = (await runtime.toJson(follow)) as Record<string, unknown>;
    if (linkToken) activity["thingport:link"] = linkToken;
    await enqueueActivity({ origin: info.origin, inboxUrl: info.inboxUrl, peerId: created.id, activity }, tx);
    const saved = await tx.peer.update({ where: { id: created.id }, data: { followId: follow.id!.href } });
    return { peer: saved, settled: settledRows };
  });
  invalidateAllowlist();
  if (!linkToken) await reachedDirectly(info.origin);
  // Told before it can be answered: their answer finds these requests sent on already.
  await tellRequesters(settled, info, "sent");
  kickDelivery();
  void createLog({
    userId: adminId,
    action: "federation_requested",
    targetId: peer.id,
    details: { origin: info.origin },
  });
  return { peer: peerOut(peer, 0) };
}

/** People's requests, answered by an admin's Connect: only those still waiting, so one withdrawn or declined
 *  meanwhile stays so. Each now names the instance at the address the admin checked, and its people as they're
 *  called now. */
async function settleUserRequests(
  tx: Prisma.TransactionClient,
  adminId: string,
  info: Pick<InstanceInfo, "origin">,
  ids: string[],
  asks: { id: string; requesterHandle: string; targetHandle: string | null }[] = [],
): Promise<{ id: string; userId: string | null }[]> {
  const settled: { id: string; userId: string | null }[] = [];
  for (const id of ids) {
    const ask = asks.find((item) => item.id === id);
    const { count } = await tx.peerRequest.updateMany({
      where: { id, kind: "LOCAL", status: "PENDING" },
      data: {
        status: "APPROVED",
        origin: info.origin,
        decidedById: adminId,
        decidedAt: new Date(),
        ...(ask ? { requesterHandle: ask.requesterHandle, targetHandle: ask.targetHandle } : {}),
      },
    });
    if (count) {
      const row = await tx.peerRequest.findUniqueOrThrow({ where: { id }, select: { id: true, userId: true } });
      settled.push(row);
    }
  }
  return settled;
}

/** Those whose requests an admin sent on: told it went, or that the instance is already connected. */
async function tellRequesters(
  requests: { userId: string | null }[],
  info: Pick<InstanceInfo, "name">,
  outcome: "sent" | "connected",
): Promise<void> {
  const users = [...new Set(requests.flatMap((request) => (request.userId ? [request.userId] : [])))];
  await Promise.all(
    users.map((userId) =>
      createNotification(userId, {
        type: "federation",
        title:
          outcome === "sent"
            ? `Your admin asked ${info.name} to connect`
            : `${info.name} is connected with this instance`,
        body: outcome === "sent" ? `You'll be told when ${info.name} answers.` : null,
        internalPath: "/explore",
      }).catch(() => {}),
    ),
  );
}

const hostOrOrigin = (origin: string) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

/** Ours, before they answer: withdrawn, and they're told. */
export async function cancelOutgoing(adminId: string, peerId: string): Promise<void> {
  const peer = await prisma.peer.findUnique({ where: { id: peerId } });
  if (!peer || peer.status !== "OUTGOING") throw new HttpError(404, "No such request", "not_found");
  await dropQueued(peer.id);
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
 *  admin opens it. Called by edge.ts before Fedify sees the request. Another one under the same address is kept beside
 *  the first, not over it: either may be forged, and opening them tells which. */
export async function storeIncomingRequest(params: {
  origin: string;
  url: string;
  headers: Record<string, string>;
  raw: string;
  follow: IncomingFollow;
}): Promise<"stored" | "another" | "full"> {
  const { follow } = params;
  const [first] = asksIn(follow, params.origin);
  const token = linkTokenIn(follow as Record<string, unknown>);
  const linkToken = token ? sha256(token) : null;
  const name = typeof follow.name === "string" ? follow.name.trim().slice(0, 80) || null : null;
  const data = {
    kind: "INCOMING" as const,
    origin: params.origin,
    url: params.url,
    headers: params.headers as Prisma.InputJsonValue,
    activity: params.raw,
    requesterName: name,
    requesterHandle: first?.requesterHandle ?? null,
    requesterUrl: first?.requesterUrl ?? null,
    targetHandle: first?.targetHandle ?? null,
    note: typeof follow.content === "string" ? clean(textOfHtml(follow.content)) : null,
    linkToken,
  };
  // Counted and stored as one, so a burst can't slip past the limits.
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REQUESTS_LOCK})`;
    const waiting = { kind: "INCOMING" as const, status: "PENDING" as const };
    // The same request again (its delivery tried twice): kept once.
    if (linkToken && (await tx.peerRequest.findUnique({ where: { linkToken }, select: { id: true } }))) {
      return { kind: "another" as const };
    }
    const fromOrigin = await tx.peerRequest.count({ where: { ...waiting, origin: params.origin } });
    // Full: the sender is told to try again later, and its delivery does, for days.
    if (fromOrigin >= MAX_PENDING_PER_ORIGIN) return { kind: "full" as const };
    if (fromOrigin === 0) {
      const [all, lastHour] = await Promise.all([
        tx.peerRequest.count({ where: waiting }),
        tx.peerRequest.count({
          where: { kind: "INCOMING", createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
        }),
      ]);
      if (all >= MAX_PENDING_INCOMING || lastHour >= MAX_NEW_INCOMING_PER_HOUR) return { kind: "full" as const };
    }
    const created = await tx.peerRequest.create({ data });
    return { kind: fromOrigin ? ("another" as const) : ("stored" as const), id: created.id };
  });
  if (outcome.kind !== "stored") return outcome.kind;
  const who = name ?? new URL(params.origin).host;
  await notifyAdmins({
    title: `${who} wants to connect`,
    body: data.note ?? `${params.origin} asks to connect with this instance.`,
    internalPath: `/admin-social?request=${outcome.id}`,
  });
  return "stored";
}

export type Ask = { requesterHandle: string | null; requesterUrl: string | null; targetHandle: string | null };

/** Who on the asking instance wants to reach whom here, as a request's Mentions name them: each person asking (a
 *  Mention with their actor's address, on that instance), then whom they asked for (a Mention by name). A request an
 *  admin sent on for several people carries a pair for each. */
export function asksIn(follow: IncomingFollow, origin: string): Ask[] {
  // JSON-LD compaction leaves a lone Mention as an object rather than a one-item list.
  const tags = Array.isArray(follow.tag)
    ? follow.tag
    : follow.tag && typeof follow.tag === "object"
      ? [follow.tag]
      : [];
  const asks: Ask[] = [];
  const handle = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim().replace(/^@/, "").slice(0, 200) : null;
  for (const tag of tags as { type?: unknown; href?: unknown; name?: unknown }[]) {
    if (tag?.type !== "Mention") continue;
    if (typeof tag.href === "string" && originOf(tag.href) === origin) {
      asks.push({ requesterHandle: handle(tag.name), requesterUrl: tag.href.slice(0, 500), targetHandle: null });
    } else if (asks.length && asks[asks.length - 1].targetHandle === null) {
      asks[asks.length - 1].targetHandle = handle(tag.name);
    }
  }
  return asks.slice(0, 20);
}

/** A stored request's asks, from the activity kept as it came. */
function storedAsks(request: Pick<PeerRequest, "activity" | "origin">): Ask[] {
  try {
    return typeof request.activity === "string" ? asksIn(JSON.parse(request.activity), request.origin) : [];
  } catch {
    return [];
  }
}

export type RequestDetails = InstanceInfo & {
  id: string;
  verified: true;
  /** The person here they asked to reach, when the request names someone who's on this instance. */
  target: { username: string; displayName: string } | null;
  /** What the request that checked out says: a newer one under the same address, forged, may have said otherwise. */
  request: { requesterName: string | null; note: string | null; asks: (Ask & { target: LocalPersonOut | null })[] };
  /** It can't be reached from here, and keeps a link open to this instance instead. */
  link: boolean;
  /** For one with a link: another instance answering at its address directly, with its own key. */
  elsewhere: { name: string; fingerprint: string } | null;
};

type LocalPersonOut = { username: string; displayName: string };

/** The person on this instance a handle names, if it's one of ours. */
async function localPerson(
  handle: string | null,
): Promise<{ id: string; username: string; displayName: string } | null> {
  if (!handle) return null;
  const at = handle.lastIndexOf("@");
  if (at < 1) return null;
  const runtime = await getRuntime();
  // As a URL has it: `things.example:443` is `things.example`.
  let host: string;
  try {
    host = new URL(`${new URL(runtime.origin).protocol}//${handle.slice(at + 1).toLowerCase()}`).host;
  } catch {
    return null;
  }
  if (host !== new URL(runtime.origin).host) return null;
  return prisma.user.findUnique({
    where: { username: handle.slice(0, at).toLowerCase() },
    select: { id: true, username: true, displayName: true },
  }) as Promise<{ id: string; username: string; displayName: string } | null>;
}

/** An incoming request, checked: its signature against the key the instance publishes now, and that the instance
 *  still stands by it. Fetches from that instance, which is fine since an admin opened it. */
export async function requestDetails(id: string, options: AnswersAtOptions = {}): Promise<RequestDetails> {
  const asked = await pendingIncoming(id);
  if (!asked.linkToken) return { ...(await detailsOf(asked)), elsewhere: null };
  // A link's address is only what its request says: where that's an address on the internet, whatever answers there
  // directly is asked too, side by side, so another instance there is shown.
  const [details, there] = await Promise.all([
    viaItsLink(asked, () => detailsOf(asked)),
    answersAt(asked.origin, options),
  ]);
  return { ...details, elsewhere: there && there.fingerprint !== details.fingerprint ? there : null };
}

const ANSWERS_AT_MS = 8_000;

/** For tests: how an address is told to be on the internet, and how long to wait for one. */
export type AnswersAtOptions = { classify?: typeof classifyHost; timeoutMs?: number };

/** The instance answering at `origin` directly, if it's on the internet and does within ANSWERS_AT_MS: null for
 *  anything else, a home network's address among them (it may lead to another machine from here). Straight there,
 *  never down a link this instance knows for it, connecting only to an address on the internet whatever the name
 *  resolves to by then, and given up, fetches and all, once its time is up. */
export async function answersAt(
  origin: string,
  { classify = classifyHost, timeoutMs = ANSWERS_AT_MS }: AnswersAtOptions = {},
): Promise<{ name: string; fingerprint: string } | null> {
  const isPublic = async (host: string) => (await classify(host).catch(() => null))?.kind === "public";
  if (!(await isPublic(new URL(origin).hostname))) return null;
  try {
    const { info } = await fetchDirectly(origin, { signal: AbortSignal.timeout(timeoutMs), isPublic }, () =>
      lookupWithActor(origin),
    );
    return { name: info.name, fingerprint: info.fingerprint };
  } catch {
    return null;
  }
}

async function detailsOf(asked: PeerRequest): Promise<Omit<RequestDetails, "elsewhere">> {
  const { info, actor } = await lookupWithActor(asked.origin);
  const { request } = await currentRequest(asked.origin, actor, asked);
  const person = (found: { username: string; displayName: string } | null) =>
    found ? { username: found.username, displayName: found.displayName } : null;
  const asks = await Promise.all(
    storedAsks(request).map(async (ask) => ({ ...ask, target: person(await localPerson(ask.targetHandle)) })),
  );
  return {
    ...info,
    id: request.id,
    verified: true,
    target: person(await localPerson(request.targetHandle)),
    request: { requesterName: request.requesterName, note: request.note, asks },
    link: Boolean(request.linkToken),
  };
}

async function pendingIncoming(id: string): Promise<PeerRequest> {
  const request = await prisma.peerRequest.findUnique({ where: { id } });
  if (!request || request.kind !== "INCOMING" || request.status !== "PENDING") {
    throw new HttpError(404, "No such request", "not_found");
  }
  return request;
}

/** An instance's waiting requests, newest first, until one checks out: signed with the key an admin compared, and
 *  still wanted by the instance that sent it. Those that don't are dropped on the way. Failing to reach the instance
 *  stops it and drops nothing. */
async function currentRequest(
  origin: string,
  actor: ActorDocument,
  asked?: PeerRequest,
): Promise<{ request: PeerRequest; follow: Vocab.Follow }> {
  // One with a link answers for itself only: another under the same address may be a different instance there, its
  // network's, and isn't checked against this one's key.
  const candidates = asked?.linkToken
    ? [asked]
    : await prisma.peerRequest.findMany({
        where: { kind: "INCOMING", status: "PENDING", origin, linkToken: null },
        orderBy: { createdAt: "desc" },
      });
  let failure: unknown = new HttpError(404, "No such request", "not_found");
  for (const request of candidates) {
    try {
      const follow = await verifyStored(origin, request, actor);
      await assertStillAsked(origin, follow);
      return { request, follow };
    } catch (err) {
      const code = err instanceof HttpError ? err.code : null;
      if (code !== "bad_signature" && code !== "withdrawn") throw err;
      failure = err;
      await prisma.$transaction(async (tx) => {
        await tx.peerRequest.update({
          where: { id: request.id },
          data: { status: code === "withdrawn" ? "CANCELLED" : "DECLINED", decidedAt: new Date() },
        });
        // Its link is told it's over.
        if (request.linkToken) await linkEnded(tx, request.linkToken, "declined");
      });
    }
  }
  throw failure;
}

/** The stored request's signature, checked against the actor document the admin's lookup read: the key they compared,
 *  not one fetched again. */
async function verifyStored(
  origin: string,
  request: { url: string | null; headers: Prisma.JsonValue; activity: Prisma.JsonValue },
  actor: ActorDocument,
): Promise<Vocab.Follow> {
  const runtime = await getRuntime();
  const raw = typeof request.activity === "string" ? request.activity : "";
  const signed = new Request(request.url ?? `${runtime.origin}${AP_PREFIX}/inbox`, {
    method: "POST",
    headers: (request.headers ?? {}) as Record<string, string>,
    body: raw,
  });
  const fromLookup = async (url: string) => {
    if (url.split("#")[0] !== actor.url) throw new Error(`Not the compared actor: ${url}`);
    return { contextUrl: null, document: actor.document, documentUrl: actor.url };
  };
  // An old signature is fine: the request waited for an admin, and the handshake after it proves both sides live.
  const key = await runtime.fedify
    .verifyRequest(signed, {
      documentLoader: fromLookup as never,
      contextLoader: runtime.contextLoader as never,
      timeWindow: false,
    })
    .catch(() => null);
  if (!key?.id || key.id.origin !== origin) {
    throw new HttpError(422, "That request's signature doesn't match the instance's key", "bad_signature");
  }
  let follow: Vocab.Follow;
  try {
    follow = await runtime.vocab.Follow.fromJsonLd(JSON.parse(raw), {
      documentLoader: fromLookup as never,
      contextLoader: runtime.contextLoader as never,
    });
  } catch {
    throw new HttpError(422, "That request isn't a request to connect with this instance", "bad_signature");
  }
  if (
    follow.id?.origin !== origin ||
    follow.actorId?.href !== actor.url ||
    follow.objectId?.href !== runtime.actorUrl.href
  ) {
    throw new HttpError(422, "That request isn't a request to connect with this instance", "bad_signature");
  }
  return follow;
}

/** Whether the instance that sent a request still stands by it: it withdrew it, or it's one from before a disconnect
 *  played back, when its Follow no longer answers. */
async function assertStillAsked(origin: string, follow: Vocab.Follow): Promise<void> {
  let response: Response;
  try {
    response = await withAllowedOrigin(origin, () =>
      federationFetch(follow.id!.href, { headers: { Accept: "application/activity+json" } }, isAllowedOrigin),
    );
  } catch (err) {
    throw new HttpError(502, `Couldn't reach ${origin}: ${(err as Error).message}`, "unreachable", true);
  }
  await response.body?.cancel().catch(() => {});
  if (response.status === 404 || response.status === 410) {
    throw new HttpError(410, "That instance withdrew its request", "withdrawn");
  }
  if (!response.ok) throw new HttpError(502, `That instance answered ${response.status}`, "unreachable", true);
}

export async function approveRequest(adminId: string, id: string, fingerprint: string) {
  const asked = await pendingIncoming(id);
  // Only the checking goes through its link: what starts after (its answer, reading what it shares) runs apart from
  // this and finds the partner's link, as the request's is gone by then.
  const { info, actor, request, follow } = await viaItsLink(asked, async () => {
    const looked = await lookupWithActor(asked.origin);
    if (looked.info.fingerprint !== fingerprint) {
      throw new HttpError(
        409,
        "That instance's key changed since you compared it. Open the request again.",
        "key_changed",
      );
    }
    return { ...looked, ...(await currentRequest(asked.origin, looked.actor, asked)) };
  });
  const runtime = await getRuntime();
  const existing = await prisma.peer.findUnique({ where: { origin: request.origin } });
  if (existing?.status === "BLOCKED")
    throw new HttpError(409, "You blocked that instance; unblock it first", "blocked");
  // Another instance there already, one this reaches directly: two on different networks with the same address.
  if (existing && request.linkToken && existing.link !== "theirs") {
    throw new HttpError(409, "Another instance at that address is connected already", "address_taken");
  }
  // Its document is kept to check its signatures against, unasked: it may publish only the keys compared.
  if (request.linkToken) {
    const published = [...publishedKeys(actor.document), ...(await runtime.keysIn(actor.document))];
    if (!onlyComparedKeys(published, info.publicKeys as never)) {
      throw new HttpError(422, "That instance publishes a key other than the one compared", "bad_signature");
    }
  }
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
    // Reached through its link from now on, its signatures checked against the key just compared.
    link: request.linkToken ? "theirs" : null,
    linkToken: request.linkToken,
    linkSeenAt: request.linkToken ? new Date() : null,
    actorDocument: request.linkToken ? (actor.document as Prisma.InputJsonValue) : Prisma.DbNull,
  };
  const accept = new runtime.vocab.Accept({
    id: activityId(runtime, "accept"),
    actor: runtime.actorUrl,
    object: follow,
  });
  const activity = await runtime.toJson(accept);
  // Connected, answered and the rest of its requests settled, together.
  const peer = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.peer.update({ where: { id: existing.id }, data })
      : await tx.peer.create({ data: { origin: request.origin, ...data } });
    await tx.peerRequest.update({
      where: { id: request.id },
      data: { status: "APPROVED", decidedById: adminId, decidedAt: new Date() },
    });
    // Those declined with it that keep a link hear so the next time they ask, and stop.
    const others = await tx.peerRequest.findMany({
      where: { kind: "INCOMING", status: "PENDING", origin: request.origin, linkToken: { not: null } },
      select: { linkToken: true },
    });
    for (const other of others) await linkEnded(tx, other.linkToken!, "declined");
    await tx.peerRequest.updateMany({
      where: { kind: "INCOMING", status: "PENDING", origin: request.origin },
      data: { status: "DECLINED", decidedById: adminId, decidedAt: new Date() },
    });
    await enqueueActivity({ origin: saved.origin, inboxUrl: info.inboxUrl, peerId: saved.id, activity }, tx);
    return saved;
  });
  invalidateAllowlist();
  if (request.linkToken) linkApproved(request.id, peer.id);
  else await reachedDirectly(peer.origin);
  kickDelivery();
  // What it shares, once it has us as a partner too (its Accept on the way): tried again until it answers.
  void syncPeer(peer.id).catch(() => {});
  void createLog({
    userId: adminId,
    action: "federation_approved",
    targetId: peer.id,
    details: { origin: peer.origin },
  });
  // Everyone here they asked for hears who asked.
  for (const ask of storedAsks(request)) {
    const target = await localPerson(ask.targetHandle);
    if (!target || !ask.requesterHandle) continue;
    await createNotification(target.id, {
      type: "federation",
      title: `${ask.requesterHandle} asked to reach you`,
      body: `${info.name} is now connected with this instance.`,
      internalPath: "/explore",
    }).catch(() => {});
  }
  // We'd asked them too, for people here: those people hear it's connected.
  if (existing?.status === "OUTGOING") {
    await notifyRequesters(peer.origin, {
      title: `Connected with ${info.name}`,
      body: `You asked to reach someone there, and ${info.name} accepted.`,
    });
  }
  return { peer: peerOut(peer, 0) };
}

/** Declined, and they're told when their request checks out; one that doesn't is just dropped. */
export async function declineRequest(adminId: string, id: string): Promise<void> {
  const local = await prisma.peerRequest.findUnique({ where: { id } });
  // One of ours, who asked to reach someone elsewhere: only they need telling.
  if (local?.kind === "LOCAL") {
    // Only while it still waits: withdrawn, or sent on by another admin meanwhile, it stays as it is.
    const { count } = await prisma.peerRequest.updateMany({
      where: { id, kind: "LOCAL", status: "PENDING" },
      data: { status: "DECLINED", decidedById: adminId, decidedAt: new Date() },
    });
    if (!count) throw new HttpError(404, "No such request", "not_found");
    void createLog({ userId: adminId, action: "federation_declined", targetId: id, details: { origin: local.origin } });
    if (local.userId) {
      await createNotification(local.userId, {
        type: "federation",
        title: `Your admin won't connect with ${hostOrOrigin(local.origin)}`,
        body: local.targetHandle ? `You asked to reach ${local.targetHandle}.` : null,
        internalPath: "/explore",
      }).catch(() => {});
    }
    return;
  }
  const asked = await pendingIncoming(id);
  // One kept through a link hears it the next time it asks: nothing is sent to an address that isn't reached.
  if (asked.linkToken) {
    const token = asked.linkToken;
    const declined = await prisma.$transaction(async (tx) => {
      const { count } = await tx.peerRequest.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "DECLINED", decidedById: adminId, decidedAt: new Date() },
      });
      if (count) await linkEnded(tx, token, "declined");
      return count > 0;
    });
    if (!declined) throw new HttpError(404, "No such request", "not_found");
    void createLog({
      userId: adminId,
      action: "federation_declined",
      targetId: id,
      details: { origin: asked.origin, told: true },
    });
    return;
  }
  const candidates = await prisma.peerRequest.findMany({
    where: { kind: "INCOMING", status: "PENDING", origin: asked.origin, linkToken: null },
    orderBy: { createdAt: "desc" },
  });
  let told = false;
  try {
    const { info, actor } = await lookupWithActor(asked.origin);
    const runtime = await getRuntime();
    for (const request of candidates) {
      const follow = await verifyStored(asked.origin, request, actor).catch(() => null);
      if (!follow) continue;
      const reject = new runtime.vocab.Reject({
        id: activityId(runtime, "reject"),
        actor: runtime.actorUrl,
        object: follow,
      });
      await enqueueActivity({ origin: asked.origin, inboxUrl: info.inboxUrl, activity: await runtime.toJson(reject) });
      told = true;
      break;
    }
  } catch {
    // Unreachable or not what it claimed: nothing to tell.
  }
  await prisma.peerRequest.updateMany({
    where: { id: { in: candidates.map((request) => request.id) } },
    data: { status: "DECLINED", decidedById: adminId, decidedAt: new Date() },
  });
  void createLog({
    userId: adminId,
    action: "federation_declined",
    targetId: id,
    details: { origin: asked.origin, told },
  });
}

/** Blocked without a word: this request is declined, and whatever comes from that instance later is dropped. */
export async function blockRequest(adminId: string, id: string): Promise<void> {
  const request = await pendingIncoming(id);
  await prisma.$transaction(async (tx) => {
    // One keeping a link hears it was declined, as any other, and stops asking: not that it's blocked.
    const linked = await tx.peerRequest.findMany({
      where: { origin: request.origin, kind: "INCOMING", status: "PENDING", linkToken: { not: null } },
      select: { linkToken: true },
    });
    for (const { linkToken } of linked) await linkEnded(tx, linkToken!, "declined");
    await tx.peerRequest.updateMany({
      where: { origin: request.origin, kind: "INCOMING", status: "PENDING" },
      data: { status: "DECLINED", decidedById: adminId, decidedAt: new Date() },
    });
    await tx.peer.upsert({
      where: { origin: request.origin },
      create: { origin: request.origin, name: request.requesterName, status: "BLOCKED", initiatedBy: "them" },
      update: { status: "BLOCKED" },
    });
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
  /** "ours": this instance keeps a link open to it, as it can't reach this one; "theirs": it keeps one open to this
   *  instance. */
  link: "ours" | "theirs" | null;
  linkOpen: boolean | null;
  linkSeenAt: string | null;
  /** Another instance at this one's address connected with them already: theirs turned this one's request away. */
  addressTaken: boolean;
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
    link: peer.link === "ours" || peer.link === "theirs" ? peer.link : null,
    linkOpen: peer.link === "theirs" ? linkOpen(peer.id) : peer.link === "ours" ? ownLinkOpen(peer.id) : null,
    linkSeenAt: peer.linkSeenAt?.toISOString() ?? null,
    addressTaken: Boolean(peer.lastError?.includes("address_taken")),
  };
}

export async function listInstances() {
  const [peers, incoming, local, pending] = await Promise.all([
    prisma.peer.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.peerRequest.findMany({
      where: { kind: "INCOMING", status: "PENDING" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.peerRequest.findMany({
      where: { kind: "LOCAL", status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { displayName: true, username: true } } },
    }),
    pendingDeliveryCounts(),
  ]);
  const out = (peer: Peer) => peerOut(peer, pending.get(peer.id) ?? 0);
  // One row per instance: the newest of its requests, which opening it checks along with the rest. Each one with a link
  // has a row of its own: another under its address, forged or another network's, can't hide it.
  const seen = new Set<string>();
  const newest = incoming.filter((request) => {
    if (request.linkToken) return true;
    if (seen.has(request.origin)) return false;
    seen.add(request.origin);
    return true;
  });
  return {
    incoming: newest.map((request) => ({
      id: request.id,
      origin: request.origin,
      // As the request named itself: confirmed only once an admin opens it.
      name: request.requesterName ?? new URL(request.origin).host,
      http: request.origin.startsWith("http:"),
      requesterHandle: request.requesterHandle,
      targetHandle: request.targetHandle,
      /** Every person asking and whom they asked for, when their admin sent on several at once. */
      asks: storedAsks(request).map(({ requesterHandle, targetHandle }) => ({ requesterHandle, targetHandle })),
      note: request.note,
      createdAt: request.createdAt.toISOString(),
      link: Boolean(request.linkToken),
      linkOpen: request.linkToken ? requestLinkOpen(request.id) : null,
    })),
    // This instance's people asking to reach someone elsewhere: an admin's Connect sends it on.
    local: local.map((request) => ({
      id: request.id,
      origin: request.origin,
      http: request.origin.startsWith("http:"),
      userName: request.user?.displayName ?? request.requesterName,
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
  // Resumed: what waited for it goes now, in the order it was queued.
  if (!paused) {
    await prisma.federationDelivery.updateMany({ where: { peerId: id }, data: { nextAttemptAt: new Date() } });
    kickDelivery();
  }
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
  await dropQueued(peer.id);
  await sayGoodbye(peer);
  await forgetPeerContent(peer.id);
  await prisma.$transaction(async (tx) => {
    await tx.peer.delete({ where: { id } });
    if (peer.link === "theirs" && peer.linkToken) {
      await linkEnded(tx, peer.linkToken, "disconnected", peer.origin);
    }
  });
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
  await dropQueued(peer.id);
  if (peer.status !== "BLOCKED") await sayGoodbye(peer);
  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.peer.update({ where: { id }, data: { status: "BLOCKED", lastError: null } });
    // Told it was disconnected, as any other: not that it's blocked.
    if (peer.link === "theirs" && peer.linkToken) {
      await linkEnded(tx, peer.linkToken, "disconnected", peer.origin);
    }
    return saved;
  });
  await forgetPeerContent(peer.id);
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

/** Looks a partner up again: whether it answers, and whether its key is still the one compared; then reads what it
 *  shares again. */
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
    // And what it shares, read again.
    if (!changed && updated.status === "ACTIVE") await syncPeer(id).catch(() => {});
    return peerOut(updated, 0);
  } catch (err) {
    const updated = await prisma.peer.update({ where: { id }, data: { lastError: (err as Error).message } });
    return peerOut(updated, 0);
  }
}

/** What was waiting to go to an instance we're done with: a request or an answer sent after that would start it
 *  again over there. The goodbye that follows is queued apart from it. */
async function dropQueued(peerId: string): Promise<void> {
  await prisma.federationDelivery.deleteMany({ where: { peerId } });
}

/** Tells a partner, or an instance we asked, that we're done: Undo our Follow, or Reject theirs. */
async function sayGoodbye(peer: Peer): Promise<void> {
  // One reached through its link hears it there instead (linkEnded): its address is never sent to.
  if (peer.link === "theirs") return;
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

/** The instance we know at `actor`'s origin, when `actor` is the very instance actor connected with: any other actor
 *  there doesn't speak for it. */
async function peerOf(actor: URL, touch: boolean): Promise<Peer | null> {
  const peer = await prisma.peer.findUnique({ where: { origin: actor.origin } });
  if (!peer || peer.actorUrl !== actor.href) return null;
  if (!touch) return peer;
  // What came down this instance's own link proves nothing about reaching it.
  const data = throughOwnLink.getStore()
    ? { lastSeenAt: new Date() }
    : { lastInboundAt: new Date(), lastSeenAt: new Date() };
  return prisma.peer.update({ where: { id: peer.id }, data });
}

/** A Follow from an instance we asked (we both asked) or are connected with (it asks again): accepted. */
export async function onFollowReceived(actor: URL, follow: Vocab.Follow): Promise<void> {
  const peer = await peerOf(actor, true);
  if (!peer || (peer.status !== "OUTGOING" && peer.status !== "ACTIVE")) return;
  const runtime = await getRuntime();
  if (follow.objectId?.href !== runtime.actorUrl.href || !peer.inboxUrl) return;
  if (peer.status === "OUTGOING" && !(await becomeConnected(peer))) return;
  const accept = new runtime.vocab.Accept({
    id: activityId(runtime, "accept"),
    actor: runtime.actorUrl,
    object: follow,
  });
  await enqueueActivity({
    origin: peer.origin,
    inboxUrl: peer.inboxUrl,
    peerId: peer.id,
    activity: await runtime.toJson(accept),
  });
}

/** Their yes to our request: only to the one we sent. */
export async function onAcceptReceived(actor: URL, objectId: string | null): Promise<void> {
  const peer = await peerOf(actor, true);
  if (!peer || peer.status !== "OUTGOING" || !objectId || objectId !== peer.followId) return;
  await becomeConnected(peer);
}

/** Their no to our request, or their end of a connection they approved: either way about the Follow we keep. */
export async function onRejectReceived(actor: URL, objectId: string | null): Promise<void> {
  const peer = await peerOf(actor, false);
  if (!peer || peer.status === "BLOCKED" || !objectId || objectId !== peer.followId) return;
  await endedByThem(peer, peer.status === "OUTGOING" ? "declined" : "disconnected");
}

/** An Undo of their Follow of us (`theirFollow`; when both admins asked at once its id isn't the one we keep), or a
 *  Block of this instance: they ended it. */
export async function onDisconnectReceived(actor: URL, objectId: string | null, theirFollow: boolean): Promise<void> {
  const peer = await peerOf(actor, false);
  if (!peer || peer.status === "BLOCKED") return;
  if (!theirFollow && (!objectId || objectId !== peer.followId)) return;
  await endedByThem(peer, peer.status === "OUTGOING" ? "withdrew" : "disconnected");
}

/** A partner's answer, the next time this instance's link to it asked: the request declined, or the connection ended. */
export async function linkEndedByThem(peerId: string, reason: "declined" | "disconnected"): Promise<void> {
  const peer = await prisma.peer.findUnique({ where: { id: peerId } });
  if (!peer || peer.link !== "ours" || peer.status === "BLOCKED") return;
  await endedByThem(peer, peer.status === "OUTGOING" ? "declined" : reason === "declined" ? "disconnected" : reason);
}

async function endedByThem(peer: Peer, how: "declined" | "withdrew" | "disconnected"): Promise<void> {
  // Only as it was read: an admin's block meanwhile stays.
  const { count } = await prisma.peer.deleteMany({ where: { id: peer.id, status: peer.status } });
  if (!count) return;
  await forgetPeerContent(peer.id);
  invalidateAllowlist();
  const who = peer.name ?? new URL(peer.origin).host;
  // Those here who asked to reach someone there are told too.
  if (how === "declined") await notifyRequesters(peer.origin, { title: `${who} declined to connect`, body: null });
  await notifyAdmins(
    how === "declined"
      ? { title: `${who} declined to connect`, body: null, internalPath: "/admin-social" }
      : how === "withdrew"
        ? { title: `${who} withdrew its request`, body: null, internalPath: "/admin-social" }
        : {
            title: `${who} disconnected`,
            body: "It's no longer a partner of this instance.",
            internalPath: "/admin-social",
          },
  );
}

/** Connected, if it's still waiting on us: an admin may have blocked or withdrawn it meanwhile. */
async function becomeConnected(peer: Peer): Promise<boolean> {
  const { count } = await prisma.peer.updateMany({
    where: { id: peer.id, status: "OUTGOING" },
    data: { status: "ACTIVE", connectedAt: new Date(), lastError: null },
  });
  if (!count) return false;
  invalidateAllowlist();
  void syncPeer(peer.id).catch(() => {});
  const who = peer.name ?? new URL(peer.origin).host;
  await notifyAdmins({ title: `Connected with ${who}`, body: `${who} accepted.`, internalPath: "/admin-social" });
  await notifyRequesters(peer.origin, {
    title: `Connected with ${who}`,
    body: `You asked to reach someone there, and ${who} accepted.`,
  });
  return true;
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

export { INSTANCE };
