import { prisma } from "../db";

// Partners we're connected with or have asked: the only instances this one talks to.
let cached: { origins: Set<string>; at: number } | null = null;
const CACHE_MS = 10_000;

// Instances an admin is looking at right now: checking an address before connecting, or a request before approving.
const temporary = new Map<string, number>();

async function peerOrigins(): Promise<Set<string>> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.origins;
  const peers = await prisma.peer.findMany({
    where: { status: { in: ["ACTIVE", "OUTGOING"] } },
    select: { origin: true },
  });
  cached = { origins: new Set(peers.map((peer) => peer.origin)), at: Date.now() };
  return cached.origins;
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

/** After a partner is added, removed or changes status. */
export function invalidateAllowlist(): void {
  cached = null;
}
