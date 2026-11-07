import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Request, Response as ExpressResponse } from "express";
import { API_PORT } from "../config";
import { prisma } from "../db";
import { LINK_ENDED_PREFIX, LINK_ONLY_PREFIX, invalidateAllowlist, onPartnersChanged } from "./allowlist";
import { FederationFetchError, NOT_LINKED, federationFetch, readJson, routeLinksThrough } from "./fetch";
import { AP_PREFIX, getRuntime } from "./runtime";

/** A link: how an instance that can't be reached (on a home network, behind NAT) still has a partner that can be.
 *  The one behind NAT keeps asking its partner "anything for me?" (GET /api/ap/link, waiting up to POLL_MS), and
 *  everything the partner would send it or fetch from it comes back as the answer: it runs each on its own
 *  /api/ap routes and sends the response up (POST /api/ap/link/replies/<id>). What it sends its partner goes directly,
 *  as always. Every request to a partner passes federationFetch, which sends a linked one's here, so pairing, Explore,
 *  pictures, files, chats and the rest work as they do between two instances that reach each other.
 *
 *  The link is opened with a secret sent in the request to connect (`thingport:link` in the Follow, signed with it),
 *  so it works while that request waits for an admin too. Only /api/ap requests go down it, with only the headers a
 *  signed request needs. */

const POLL_MS = 10_000;
// Open while it asked lately: between two asks there's only the moment an answer takes.
const OPEN_MS = 25_000;
// A request its instance didn't pick up by then isn't going to be.
const PICKUP_MS = 15_000;
const MAX_QUEUED = 200;
const BATCH = 16;
const MAX_BODY = 2 * 1024 * 1024;
const ENDED_MS = 30 * 24 * 60 * 60 * 1000;

const REQUEST_HEADERS = [
  "accept",
  "content-type",
  "date",
  "digest",
  "content-digest",
  "signature",
  "signature-input",
  "user-agent",
];
const RESPONSE_HEADERS = [
  "content-type",
  "content-disposition",
  "cache-control",
  "etag",
  "last-modified",
  "retry-after",
  "x-content-type-options",
];

export const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
export const newLinkToken = () => crypto.randomBytes(32).toString("base64url");
const isToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);

/** The secret a request to connect says its link opens with, or null for one that keeps none. */
export function linkTokenIn(follow: Record<string, unknown>): string | null {
  const value = follow["thingport:link"];
  return isToken(value) ? value : null;
}

type ResponseBody = ConstructorParameters<typeof globalThis.Response>[0];

const pick = (headers: Record<string, string>, names: string[]) =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => names.includes(name.toLowerCase())));

// ---------------------------------------------------------------------------------------------------------------------
// The side that can be reached: partners' links end here.

// `startBy`: when it's too late to start it, its caller long gone.
type Sent = {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  startBy?: number;
};
type Waiting = {
  resolve: (response: Response, cancel: () => void) => void;
  fail: (message: string) => void;
  picked: boolean;
};
type Line = {
  waiter: ((batch: Sent[]) => void) | null;
  queue: Sent[];
  waiting: Map<string, Waiting>;
  lastAsked: number;
};
const lines = new Map<string, Line>();
const lineOf = (key: string): Line => {
  let line = lines.get(key);
  if (!line) {
    line = { waiter: null, queue: [], waiting: new Map(), lastAsked: 0 };
    lines.set(key, line);
  }
  return line;
};
const isOpen = (line: Line | undefined) => Boolean(line && (line.waiter || Date.now() - line.lastAsked < OPEN_MS));

// Lines and their bookkeeping for links closed a while, ended or not, go: pairing and disconnecting often leaves nothing
// behind.
const IDLE_MS = 60 * 60 * 1000;
let lastSweep = 0;
function sweep(): void {
  if (Date.now() - lastSweep < 60_000) return;
  lastSweep = Date.now();
  for (const [key, line] of lines) {
    if (!line.waiter && !line.waiting.size && !line.queue.length && Date.now() - line.lastAsked > IDLE_MS) {
      lines.delete(key);
    }
  }
  for (const [peerId, at] of seen) if (Date.now() - at > IDLE_MS) seen.delete(peerId);
}

/** Lets go of every partner's link: connected instances turned off. */
export function closeAllLines(): void {
  for (const line of lines.values()) {
    line.waiter?.([]);
    for (const waiting of line.waiting.values()) waiting.fail(NOT_LINKED);
  }
  lines.clear();
  seen.clear();
}

/** Whether a partner that reaches this instance through its link has it open now. */
export function linkOpen(peerId: string): boolean {
  return isOpen(lines.get(`peer:${peerId}`));
}

/** A request approved: its link, open as it is, becomes the partner's, so the answer goes down it at once. */
export function linkApproved(requestId: string, peerId: string): void {
  const line = lines.get(`request:${requestId}`);
  if (!line) return;
  lines.delete(`request:${requestId}`);
  lines.set(`peer:${peerId}`, line);
}

/** Whether the link of a request waiting here is open now. */
export function requestLinkOpen(requestId: string): boolean {
  return isOpen(lines.get(`request:${requestId}`));
}

function hand(line: Line): void {
  if (!line.waiter || !line.queue.length) return;
  const batch = line.queue.splice(0, BATCH);
  for (const sent of batch) {
    const waiting = line.waiting.get(sent.id);
    if (waiting) waiting.picked = true;
  }
  const waiter = line.waiter;
  line.waiter = null;
  waiter(batch);
}

async function bodyOf(body: RequestInit["body"]): Promise<string | undefined> {
  if (body === undefined || body === null) return undefined;
  const bytes =
    typeof body === "string"
      ? Buffer.from(body)
      : body instanceof Uint8Array
        ? Buffer.from(body)
        : body instanceof ArrayBuffer
          ? Buffer.from(body)
          : Buffer.from(await new globalThis.Response(body as ResponseBody).arrayBuffer());
  if (bytes.byteLength > MAX_BODY) throw new FederationFetchError("Too large to send through a link", "too_large");
  return bytes.toString("base64");
}

/** A request to a partner that keeps a link open to this instance: handed to it the next time it asks, its answer
 *  read as it comes up. */
async function throughLink(key: string, url: string, init: RequestInit): Promise<Response> {
  const line = lines.get(key);
  if (!isOpen(line)) throw new FederationFetchError(NOT_LINKED, "network");
  const cancelled = () => new FederationFetchError("The request took too long", "network");
  if (init.signal?.aborted) throw cancelled();
  const sent: Sent = {
    id: crypto.randomUUID(),
    method: (init.method ?? "GET").toUpperCase(),
    url,
    headers: Object.fromEntries(new Headers(init.headers).entries()),
    body: await bodyOf(init.body),
    startBy: Date.now() + PICKUP_MS * 2,
  };
  // Given up on while its body was read.
  if (init.signal?.aborted) throw cancelled();
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    // Its body, cut off once the caller's time is up, as a body fetched directly would be.
    let cancelBody: (() => void) | null = null;
    const done = () => {
      settled = true;
      clearTimeout(pickup);
      line!.waiting.delete(sent.id);
      const queued = line!.queue.indexOf(sent);
      if (queued >= 0) line!.queue.splice(queued, 1);
    };
    const fail = (message: string) => {
      if (settled) return;
      done();
      reject(new FederationFetchError(message, "network"));
    };
    const pickup = setTimeout(() => {
      if (!line!.waiting.get(sent.id)?.picked) fail(NOT_LINKED);
    }, PICKUP_MS);
    if (line!.queue.length >= MAX_QUEUED) return fail("Too much is waiting for their instance");
    line!.waiting.set(sent.id, {
      resolve: (response, cancel) => {
        if (settled) {
          cancel();
          return;
        }
        done();
        cancelBody = cancel;
        resolve(response);
      },
      fail,
      picked: false,
    });
    init.signal?.addEventListener(
      "abort",
      () => {
        if (settled) cancelBody?.();
        else fail("The request took too long");
      },
      { once: true },
    );
    line!.queue.push(sent);
    hand(line!);
  });
}

routeLinksThrough(throughLink);

type Found = { key: string; origin: string; peerId?: string; requestId?: string };

/** The partner, or the request waiting here, whose link `token` opens. */
async function findLine(token: string | null): Promise<Found | null> {
  if (!isToken(token)) return null;
  const hash = sha256(token);
  const peer = await prisma.peer.findUnique({
    where: { linkToken: hash },
    select: { id: true, origin: true, status: true, link: true },
  });
  if (peer && peer.link === "theirs" && peer.status !== "BLOCKED") {
    return { key: `peer:${peer.id}`, origin: peer.origin, peerId: peer.id };
  }
  const request = await prisma.peerRequest.findUnique({
    where: { linkToken: hash },
    select: { id: true, origin: true, status: true, kind: true },
  });
  if (request?.kind === "INCOMING" && request.status === "PENDING") {
    return { key: `request:${request.id}`, origin: request.origin, requestId: request.id };
  }
  return null;
}

const tokenOf = (req: Request): string | null => {
  const match = /^Link\s+(\S+)$/.exec(req.headers.authorization ?? "");
  return match ? match[1] : null;
};

const seen = new Map<string, number>();

/** A partner's link, open again after a while closed: what waited for it goes now, and what it shares is read. */
async function reopened(peerId: string): Promise<void> {
  await prisma.federationDelivery.updateMany({ where: { peerId }, data: { nextAttemptAt: new Date() } });
  const [{ kickDelivery }, { syncPeer }] = await Promise.all([import("./delivery"), import("./remoteIndex")]);
  kickDelivery();
  void syncPeer(peerId).catch(() => {});
}

/** GET /api/ap/link: a partner asking what's for it, answered as soon as there's something or after POLL_MS. */
export async function answerAsk(req: Request, res: ExpressResponse): Promise<void> {
  sweep();
  const token = tokenOf(req);
  const found = await findLine(token);
  if (!found) {
    const ended = isToken(token)
      ? await prisma.federationKv.findUnique({ where: { key: `${LINK_ENDED_PREFIX}${sha256(token)}` } })
      : null;
    if (ended && (!ended.expiresAt || ended.expiresAt > new Date())) {
      res.status(410).json({ reason: (ended.value as { reason?: string } | null)?.reason ?? "disconnected" });
    } else res.status(401).json({ error: "No such link" });
    return;
  }
  const line = lineOf(found.key);
  const wasClosed = !isOpen(line);
  line.lastAsked = Date.now();
  if (found.peerId) {
    if (wasClosed) void reopened(found.peerId).catch(() => {});
    if (Date.now() - (seen.get(found.peerId) ?? 0) > 60_000) {
      seen.set(found.peerId, Date.now());
      await prisma.peer
        .update({ where: { id: found.peerId }, data: { linkSeenAt: new Date(), lastSeenAt: new Date() } })
        .catch(() => {});
    }
  }
  // One ask at a time: an older one still open is answered, empty.
  line.waiter?.([]);
  const batch = await new Promise<Sent[]>((resolve) => {
    line.waiter = resolve;
    const timer = setTimeout(() => {
      if (line.waiter === resolve) {
        line.waiter = null;
        resolve([]);
      }
    }, POLL_MS);
    // The response's close, not the request's: that one comes once a request is read.
    res.on("close", () => {
      clearTimeout(timer);
      if (line.waiter === resolve) line.waiter = null;
    });
    hand(line);
  });
  line.lastAsked = Date.now();
  if (!res.writableEnded) res.json({ requests: batch });
}

/** POST /api/ap/link/replies/:id: the answer to one request sent down a link, its body as it comes. */
export async function answerReply(req: Request, res: ExpressResponse): Promise<void> {
  const found = await findLine(tokenOf(req));
  const line = found ? lines.get(found.key) : undefined;
  const waiting = line?.waiting.get(req.params.id);
  if (!line || !waiting?.picked) {
    res.status(410).json({ error: "Not waited for" });
    return;
  }
  const status = Number(req.headers["x-link-status"]);
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    waiting.fail("Their instance sent a broken answer");
    res.status(400).json({ error: "Bad status" });
    return;
  }
  let headers: Record<string, string> = {};
  try {
    const raw = JSON.parse(Buffer.from(String(req.headers["x-link-headers"] ?? ""), "base64url").toString("utf8"));
    if (raw && typeof raw === "object") {
      headers = pick(
        Object.fromEntries(Object.entries(raw).filter(([, value]) => typeof value === "string")) as Record<
          string,
          string
        >,
        [...RESPONSE_HEADERS, "content-length"],
      );
    }
  } catch {
    // None, then.
  }
  const empty = status === 204 || status === 205 || status === 304;
  if (empty) req.resume();
  req.on("end", () => {
    if (!res.headersSent) res.status(204).end();
  });
  req.on("error", () => {});
  const body = empty ? null : (Readable.toWeb(req) as unknown as WebReadableStream);
  waiting.resolve(new globalThis.Response(body as unknown as ResponseBody, { status, headers }), () => req.destroy());
}

/** Leaves a note that the link opened with `tokenHash` ended, and why, so the instance keeping it hears so the next
 *  time it asks; and, given `origin`, that it's still only ever reached through a link meanwhile. */
export async function linkEnded(
  tokenHash: string,
  origin: string | null,
  reason: "declined" | "disconnected",
): Promise<void> {
  const expiresAt = new Date(Date.now() + ENDED_MS);
  await prisma.$transaction(async (tx) => {
    await tx.federationKv.upsert({
      where: { key: `${LINK_ENDED_PREFIX}${tokenHash}` },
      create: { key: `${LINK_ENDED_PREFIX}${tokenHash}`, value: { reason }, expiresAt },
      update: { value: { reason }, expiresAt },
    });
    if (!origin) return;
    await tx.federationKv.upsert({
      where: { key: `${LINK_ONLY_PREFIX}${origin}` },
      create: { key: `${LINK_ONLY_PREFIX}${origin}`, value: {}, expiresAt },
      update: { expiresAt },
    });
  });
  invalidateAllowlist();
}

/** An address connected with directly again: no longer one reached only through a link. */
export async function reachedDirectly(origin: string): Promise<void> {
  const { count } = await prisma.federationKv.deleteMany({ where: { key: `${LINK_ONLY_PREFIX}${origin}` } });
  if (count) invalidateAllowlist();
}

// ---------------------------------------------------------------------------------------------------------------------
// The side behind NAT: links it keeps open to partners.

const MARK_HEADER = "x-thingport-link";
const MARK = crypto.randomBytes(16).toString("hex");

/** Whether a request came down one of this instance's links rather than from outside: no proof that it can be
 *  reached. */
export function cameThroughLink(headers: Request["headers"]): boolean {
  const value = headers[MARK_HEADER];
  return (
    typeof value === "string" &&
    value.length === MARK.length &&
    crypto.timingSafeEqual(Buffer.from(value), Buffer.from(MARK))
  );
}

/** Set while a request that came down a link is handled. */
export const throughOwnLink = new AsyncLocalStorage<true>();

type Kept = { origin: string; token: string; stop: AbortController; lastAnswered: number; lastSaved: number };
const kept = new Map<string, Kept>();
let refresher: NodeJS.Timeout | null = null;
const CONCURRENT = 8;

/** Runs at most `max` at once, the rest in turn. `room()` waits while as many again are waiting, so the link stops
 *  asking for more than it can start soon: what's left waits at the partner, whose callers give up in time. */
function limiter(max: number) {
  let active = 0;
  const queued: (() => void)[] = [];
  const roomWaiters: (() => void)[] = [];
  const freed = () => {
    while (queued.length < max && roomWaiters.length) roomWaiters.shift()?.();
  };
  const run = async (task: () => Promise<void>): Promise<void> => {
    if (active >= max) await new Promise<void>((resolve) => queued.push(resolve));
    active += 1;
    freed();
    try {
      await task();
    } finally {
      active -= 1;
      queued.shift()?.();
      freed();
    }
  };
  const room = (): Promise<void> =>
    queued.length < max ? Promise.resolve() : new Promise<void>((resolve) => roomWaiters.push(resolve));
  return { run, room };
}

/** Whether this instance's link to a partner got through lately. */
export function ownLinkOpen(peerId: string): boolean {
  const link = kept.get(peerId);
  return Boolean(link && Date.now() - link.lastAnswered < OPEN_MS);
}

/** Keeps a link open to every partner that needs one, while connected instances are on. */
export function startLinks(): void {
  if (refresher) return;
  refresher = setInterval(() => void refreshLinks().catch(() => {}), 30_000);
  refresher.unref();
  void refreshLinks().catch(() => {});
}

export function stopLinks(): void {
  if (refresher) clearInterval(refresher);
  refresher = null;
  for (const link of kept.values()) link.stop.abort();
  kept.clear();
  closeAllLines();
}

onPartnersChanged(() => {
  if (refresher) void refreshLinks().catch(() => {});
});

/** Opens the links partners need and closes the ones they no longer do. */
export async function refreshLinks(): Promise<void> {
  const peers = await prisma.peer.findMany({
    where: { link: "ours", linkToken: { not: null }, status: { in: ["OUTGOING", "ACTIVE", "PAUSED"] } },
    select: { id: true, origin: true, linkToken: true },
  });
  if (!refresher) return;
  const wanted = new Map(peers.map((peer) => [peer.id, peer]));
  for (const [id, link] of kept) {
    if (wanted.get(id)?.linkToken !== link.token) {
      link.stop.abort();
      kept.delete(id);
    }
  }
  for (const peer of peers) {
    if (kept.has(peer.id)) continue;
    const link: Kept = {
      origin: peer.origin,
      token: peer.linkToken!,
      stop: new AbortController(),
      lastAnswered: 0,
      lastSaved: 0,
    };
    kept.set(peer.id, link);
    void keepOpen(peer.id, link);
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    // Its listener goes with it, so a partner down for days leaves none behind.
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });

async function keepOpen(peerId: string, link: Kept): Promise<void> {
  const signal = link.stop.signal;
  const allowed = (origin: string) => origin === link.origin;
  let failures = 0;
  const limit = limiter(CONCURRENT);
  const abandoned = new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
  while (!signal.aborted) {
    // Busy with as much as it can take: asks for more once some of it has started.
    await Promise.race([limit.room(), abandoned]);
    if (signal.aborted) return;
    try {
      const response = await federationFetch(
        `${link.origin}${AP_PREFIX}/link`,
        {
          headers: { Authorization: `Link ${link.token}`, Accept: "application/json" },
          signal: AbortSignal.any([signal, AbortSignal.timeout(POLL_MS + 10_000)]),
        },
        allowed,
      );
      if (response.status === 410) {
        const { reason } = ((await readJson(response, 4096).catch(() => null)) ?? {}) as { reason?: string };
        const { linkEndedByThem } = await import("./peers");
        await linkEndedByThem(peerId, reason === "declined" ? "declined" : "disconnected");
        return;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new FederationFetchError(`HTTP ${response.status}`, "status", response.status);
      }
      const { requests } = ((await readJson(response, 32 * 1024 * 1024)) ?? {}) as { requests?: Sent[] };
      failures = 0;
      link.lastAnswered = Date.now();
      if (Date.now() - link.lastSaved > 60_000) {
        link.lastSaved = Date.now();
        await prisma.peer.update({ where: { id: peerId }, data: { linkSeenAt: new Date() } }).catch(() => {});
      }
      // Several at once, so a big download doesn't hold up the rest; one that waited past its time isn't started.
      for (const sent of Array.isArray(requests) ? requests : []) {
        void limit.run(async () => {
          if (typeof sent.startBy === "number" && Date.now() > sent.startBy) return;
          await serve(link, sent);
        });
      }
    } catch {
      if (signal.aborted) return;
      failures += 1;
      await sleep(Math.min(60_000, 1000 * 2 ** Math.min(failures, 6)), signal);
    }
  }
}

/** One request a partner sent down the link, run on this instance's own /api/ap routes, and its answer sent up. */
async function serve(link: Kept, sent: Sent): Promise<void> {
  let response: globalThis.Response;
  try {
    const runtime = await getRuntime();
    const target = new URL(sent.url);
    if (
      target.origin !== runtime.origin ||
      !target.pathname.startsWith(`${AP_PREFIX}/`) ||
      target.pathname.startsWith(`${AP_PREFIX}/link`) ||
      (sent.method !== "GET" && sent.method !== "POST")
    ) {
      throw new Error("Not something a link carries");
    }
    // Until its headers come; a file's body then takes as long as it takes.
    const headersBy = new AbortController();
    const timer = setTimeout(() => headersBy.abort(), 60_000);
    response = await fetch(`http://127.0.0.1:${API_PORT}${target.pathname}${target.search}`, {
      method: sent.method,
      headers: { ...pick(sent.headers ?? {}, REQUEST_HEADERS), [MARK_HEADER]: MARK },
      body: sent.body ? Buffer.from(sent.body, "base64") : undefined,
      redirect: "manual",
      signal: AbortSignal.any([headersBy.signal, link.stop.signal]),
    });
    clearTimeout(timer);
  } catch (err) {
    response = new globalThis.Response(JSON.stringify({ error: (err as Error).message || "Failed" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (RESPONSE_HEADERS.includes(name)) headers[name] = value;
  });
  // A length only for a body sent as it was: one decoded on the way here is longer.
  const length = response.headers.get("content-length");
  if (length && !response.headers.get("content-encoding")) headers["content-length"] = length;
  try {
    const reply = await federationFetch(
      `${link.origin}${AP_PREFIX}/link/replies/${encodeURIComponent(sent.id)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Link ${link.token}`,
          "Content-Type": "application/octet-stream",
          "X-Link-Status": String(response.status),
          "X-Link-Headers": Buffer.from(JSON.stringify(headers)).toString("base64url"),
        },
        body: response.body ?? undefined,
        duplex: "half",
        signal: AbortSignal.any([link.stop.signal, AbortSignal.timeout(60 * 60 * 1000)]),
      } as RequestInit,
      (origin) => origin === link.origin,
    );
    await reply.body?.cancel().catch(() => {});
  } catch {
    await response.body?.cancel().catch(() => {});
  }
}
