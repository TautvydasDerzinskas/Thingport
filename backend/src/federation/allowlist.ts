import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "../db";

/** What a link that ended leaves behind for a while (links.ts): why, for the instance that kept it, and that its address
 *  is still never fetched directly. */
export const LINK_ENDED_PREFIX = "thingport:link-ended:";
export const LINK_ONLY_PREFIX = "thingport:link-only:";

// Partners we're connected with or have asked: the only instances this one talks to. `linked`: the origins reached
// only through a link, each with the link ("peer:<id>" or "request:<id>"): never fetched directly, as such an address
// (a LAN one, usually) may lead to another machine from here.
let cached: { origins: Set<string>; linked: Map<string, string>; at: number } | null = null;
const CACHE_MS = 10_000;
// Bumped by every change: a read that started before one is read again, so a partner just paused or blocked isn't
// put back.
let generation = 0;

// Instances an admin is looking at right now: checking an address before connecting, or a request before approving.
const temporary = new Map<string, number>();

async function load(): Promise<NonNullable<typeof cached>> {
  for (;;) {
    if (cached && Date.now() - cached.at < CACHE_MS) return cached;
    const asked = generation;
    const [peers, linkedPeers, asking, ended] = await Promise.all([
      prisma.peer.findMany({ where: { status: { in: ["ACTIVE", "OUTGOING"] } }, select: { origin: true } }),
      prisma.peer.findMany({ where: { link: "theirs" }, select: { id: true, origin: true } }),
      prisma.peerRequest.findMany({
        where: { kind: "INCOMING", status: "PENDING", linkToken: { not: null } },
        orderBy: { createdAt: "asc" },
        select: { id: true, origin: true },
      }),
      prisma.federationKv.findMany({
        where: { key: { startsWith: LINK_ONLY_PREFIX }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        select: { key: true },
      }),
    ]);
    if (asked !== generation) continue;
    const linked = new Map<string, string>();
    for (const row of ended) linked.set(row.key.slice(LINK_ONLY_PREFIX.length), "ended");
    // The newest request from an address, and a partner's link over any request.
    for (const request of asking) linked.set(request.origin, `request:${request.id}`);
    for (const peer of linkedPeers) linked.set(peer.origin, `peer:${peer.id}`);
    cached = { origins: new Set(peers.map((peer) => peer.origin)), linked, at: Date.now() };
    return cached;
  }
}

async function peerOrigins(): Promise<Set<string>> {
  return (await load()).origins;
}

// A request an admin is looking at, from an instance that can't be reached from here: what's fetched from its
// address while they do goes through its own link, whichever other request from that address is newer.
const reviewing = new AsyncLocalStorage<{ origin: string; line: string }>();

/** The link `origin` is reached through, or null for one reached directly. "ended" for one whose link ended lately:
 *  reached no way at all. */
export async function lineFor(origin: string): Promise<string | null> {
  const review = reviewing.getStore();
  if (review?.origin === origin) return review.line;
  return (await load()).linked.get(origin) ?? null;
}

/** Runs `fn` with what it fetches from `origin` going through the link of request `requestId`. */
export function throughRequestLink<T>(origin: string, requestId: string, fn: () => Promise<T>): Promise<T> {
  return reviewing.run({ origin, line: `request:${requestId}` }, fn);
}

/** A partner's actor document as kept when its admin compared its key, for one reached through a link: what its
 *  signatures are checked against, so checking them asks it nothing. */
export async function keptActorDocument(url: string): Promise<unknown | null> {
  const actorUrl = url.split("#")[0];
  const peer = await prisma.peer.findFirst({
    where: { actorUrl, link: "theirs", status: { not: "BLOCKED" } },
    select: { actorDocument: true },
  });
  return peer?.actorDocument ?? null;
}

/** Whether this instance may fetch from, or accept signed requests from, `origin`. */
export async function isAllowedOrigin(origin: string): Promise<boolean> {
  return temporary.has(origin) || (await peerOrigins()).has(origin);
}

/** Lets `fn` talk to `origin` while it runs, for what an admin asked for: looking an instance up, or checking a request
 *  before approving it. */
export async function withAllowedOrigin<T>(origin: string, fn: () => Promise<T>): Promise<T> {
  temporary.set(origin, (temporary.get(origin) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    const left = (temporary.get(origin) ?? 1) - 1;
    if (left > 0) temporary.set(origin, left);
    else temporary.delete(origin);
  }
}

const listeners: (() => void)[] = [];

/** Called after every change to partners, as links follow them. */
export function onPartnersChanged(listener: () => void): void {
  listeners.push(listener);
}

/** After a partner is added, removed or changes status. */
export function invalidateAllowlist(): void {
  generation += 1;
  cached = null;
  for (const listener of listeners) listener();
}
