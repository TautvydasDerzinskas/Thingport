import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { getSocialSettings } from "../services/settingsService";

/** What the last check found about who can reach this instance:
 *  - `local`: its Public URL leads back here and is on a private network or VPN.
 *  - `public`: the same, on a public address. Partners that reached it confirm it (`Peer.lastInboundAt`).
 *  - `public_unverified`: a public address that didn't answer this instance itself; some routers can't loop back.
 *  - `not_set`, `elsewhere` (answers, but isn't this instance), `unreachable`: nothing else could reach it either. */
export type ReachabilityKind = "local" | "public" | "public_unverified" | "not_set" | "elsewhere" | "unreachable";

export type Reachability = {
  kind: ReachabilityKind;
  url: string | null;
  addresses: string[];
  checkedAt: string;
};

export type FederationSettings = {
  enabled: boolean;
  reachability: Reachability | null;
};

const SETTINGS_KEY = "federation";

// Read on every request to /api/ap, so kept for a moment; a change here clears it at once.
let cached: { value: FederationSettings; at: number } | null = null;
const CACHE_MS = 5_000;

export async function getFederationSettings(): Promise<FederationSettings> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const row = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  const stored = (row?.value ?? {}) as Partial<FederationSettings>;
  const value: FederationSettings = {
    enabled: stored.enabled === true,
    reachability: stored.reachability ?? null,
  };
  cached = { value, at: Date.now() };
  return value;
}

export async function updateFederationSettings(patch: Partial<FederationSettings>): Promise<FederationSettings> {
  const next = { ...(await getFederationSettings()), ...patch };
  await prisma.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: next as unknown as Prisma.InputJsonValue },
    update: { value: next as unknown as Prisma.InputJsonValue },
  });
  cached = { value: next, at: Date.now() };
  return next;
}

/** On, and live: it builds on social features, so it's quiet while they're off too. */
export async function isFederationLive(): Promise<boolean> {
  const settings = await getFederationSettings();
  if (!settings.enabled) return false;
  return (await getSocialSettings()).enabled;
}

/** For tests: forget what was read. */
export function clearFederationSettingsCache(): void {
  cached = null;
}
