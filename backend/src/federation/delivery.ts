import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { federationFetch, readJson } from "./fetch";
import { purgeExpiredKv } from "./kvStore";
import { syncStale } from "./remoteIndex";
import { getRuntime } from "./runtime";
import { isFederationLive } from "./settings";

// Retried this long after a failure, then given up: about three days in all.
const BACKOFF_MS = [30, 120, 600, 1800, 3600, 3 * 3600, 6 * 3600, 12 * 3600, 24 * 3600, 24 * 3600].map((s) => s * 1000);
const BATCH = 20;
const TICK_MS = 5_000;
const PURGE_EVERY_MS = 60 * 60 * 1000;
// How often partners' indexes are looked at; each is read again every 15 minutes (remoteIndex.ts).
const SYNC_CHECK_MS = 60 * 1000;

/** Queues an activity for one instance. `origin` is the only place it may go, which also lets a goodbye reach an
 *  instance that's no longer a partner. Those with one `orderKey` go in the order they were queued. Inside a caller's
 *  transaction (`tx`), the caller kicks the worker once it's committed. */
export async function enqueueActivity(
  params: {
    origin: string;
    inboxUrl: string;
    peerId?: string | null;
    activity: unknown;
    orderKey?: string | null;
  },
  tx?: Prisma.TransactionClient,
): Promise<void> {
  await (tx ?? prisma).federationDelivery.create({
    data: {
      origin: params.origin,
      inboxUrl: params.inboxUrl,
      peerId: params.peerId ?? null,
      actor: "instance",
      activity: params.activity as Prisma.InputJsonValue,
      orderKey: params.orderKey ?? null,
    },
  });
  if (!tx) kick();
}

let timer: NodeJS.Timeout | null = null;
let running = false;
let again = false;
let lastPurge = 0;
let lastSyncCheck = 0;

export function startDeliveryWorker(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  kick();
}

export function stopDeliveryWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

function kick(): void {
  if (!timer) return;
  setImmediate(() => void tick());
}

/** Sends what's queued now rather than at the next tick. */
export function kickDelivery(): void {
  kick();
}

/** Sends what's due. One run at a time; a kick during a run runs once more after it. */
export async function tick(now = () => new Date()): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      if (!(await isFederationLive())) return;
      const due = await prisma.federationDelivery.findMany({
        where: { nextAttemptAt: { lte: now() } },
        orderBy: { createdAt: "asc" },
        take: BATCH,
      });
      for (const row of due) {
        // Turned off meanwhile: the rest wait for it to be on again.
        if (!(await isFederationLive())) return;
        await deliver(row, now());
      }
      if (Date.now() - lastSyncCheck > SYNC_CHECK_MS) {
        lastSyncCheck = Date.now();
        void syncStale().catch(() => {});
      }
      if (Date.now() - lastPurge > PURGE_EVERY_MS) {
        lastPurge = Date.now();
        await purgeExpiredKv().catch(() => 0);
      }
    } while (again);
  } catch (err) {
    console.error("[federation] Delivery run failed:", err);
  } finally {
    running = false;
  }
}

type DeliveryRow = Awaited<ReturnType<typeof prisma.federationDelivery.findMany>>[number];

async function deliver(row: DeliveryRow, now: Date): Promise<void> {
  const peer = row.peerId ? await prisma.peer.findUnique({ where: { id: row.peerId } }) : null;
  // Blocked since it was queued: nothing more goes to it.
  if (peer?.status === "BLOCKED") {
    await prisma.federationDelivery.delete({ where: { id: row.id } }).catch(() => {});
    return;
  }
  // Waits for what was queued before it, waiting to be tried again: a message in a room never overtakes the update
  // that took someone out of it.
  if (row.orderKey) {
    const before = await prisma.federationDelivery.findFirst({
      where: { peerId: row.peerId, orderKey: row.orderKey, createdAt: { lt: row.createdAt } },
      orderBy: { nextAttemptAt: "desc" },
      select: { nextAttemptAt: true },
    });
    if (before) {
      const after = before.nextAttemptAt > now ? before.nextAttemptAt : new Date(now.getTime() + 1000);
      await prisma.federationDelivery.update({ where: { id: row.id }, data: { nextAttemptAt: after } }).catch(() => {});
      return;
    }
  }
  // Paused: kept, and tried again once it's resumed.
  if (peer?.status === "PAUSED") {
    await prisma.federationDelivery.update({
      where: { id: row.id },
      data: { nextAttemptAt: new Date(now.getTime() + 10 * 60 * 1000) },
    });
    return;
  }
  let failure = "";
  let permanent = false;
  try {
    const runtime = await getRuntime();
    const body = JSON.stringify(row.activity);
    const signed = await runtime.fedify.signRequest(
      new Request(row.inboxUrl, {
        method: "POST",
        headers: { "Content-Type": "application/activity+json", Accept: "application/activity+json" },
        body,
      }),
      runtime.keys.rsa.privateKey as never,
      runtime.keyId,
    );
    const response = await federationFetch(
      row.inboxUrl,
      { method: "POST", headers: signed.headers, body },
      (origin) => origin === row.origin,
    );
    // Refused with a reason a person can act on: kept with the error.
    const code =
      response.status === 409
        ? ((await readJson(response, 4096).catch(() => null)) as { code?: unknown } | null)?.code
        : undefined;
    await response.body?.cancel().catch(() => {});
    if (response.ok) {
      await prisma.federationDelivery.delete({ where: { id: row.id } }).catch(() => {});
      if (peer) await prisma.peer.update({ where: { id: peer.id }, data: { lastSeenAt: now, lastError: null } });
      return;
    }
    failure = `HTTP ${response.status}${typeof code === "string" ? ` ${code.slice(0, 40)}` : ""}`;
    // Refused for good; a busy or failing partner is tried again.
    permanent = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
  } catch (err) {
    failure = (err as Error).message || "Network error";
  }
  const attempts = row.attempts + 1;
  if (permanent || attempts > BACKOFF_MS.length) {
    await prisma.federationDelivery.delete({ where: { id: row.id } }).catch(() => {});
  } else {
    await prisma.federationDelivery.update({
      where: { id: row.id },
      data: { attempts, lastError: failure, nextAttemptAt: new Date(now.getTime() + BACKOFF_MS[attempts - 1]) },
    });
  }
  if (peer) await prisma.peer.update({ where: { id: peer.id }, data: { lastError: failure } }).catch(() => {});
}

/** Activities still waiting for each partner. */
export async function pendingDeliveryCounts(): Promise<Map<string, number>> {
  const groups = await prisma.federationDelivery.groupBy({ by: ["peerId"], _count: { id: true } });
  return new Map(groups.filter((g) => g.peerId).map((g) => [g.peerId!, g._count.id]));
}
