import { prisma } from "../db";
import { getSocialSettings } from "../services/settingsService";

/** What the last check found about who can reach this instance:
 *  - `local`: its Public URL leads back here and is on a private network or VPN.
 *  - `public`: the same, on a public address. Partners that reached it confirm it (`Peer.lastInboundAt`).
 *  - `public_unverified`: a public address that didn't answer this instance itself; some routers can't loop back.
 *  - `elsewhere` (answers, but isn't this instance), `unreachable`: nothing else could reach it either. It can still
 *    connect to instances it reaches, keeping a link open to each, unless its address is this machine (`reserved`).
 *  - `not_set`: no Public URL, so nothing to be known by. */
export type ReachabilityKind = "local" | "public" | "public_unverified" | "not_set" | "elsewhere" | "unreachable";

/** Why the Public URL didn't lead back here: `reserved` is this machine or a reserved range, never asked. */
export type ProbeFailure = "reserved" | "not_found" | "timeout" | "refused" | "certificate" | "redirect" | "failed";

export type Reachability = {
  kind: ReachabilityKind;
  url: string | null;
  addresses: string[];
  checkedAt: string;
  /** For `unreachable` and `public_unverified`. */
  reason?: ProbeFailure | null;
  /** What the failure said: the error, the redirect's target, or the status something else answered with. */
  detail?: string | null;
};

export type FederationSettings = {
  enabled: boolean;
  reachability: Reachability | null;
};

const SETTINGS_KEY = "federation";

// Read on every request to /api/ap, so kept for a moment; a change here clears it at once.
let cached: { value: FederationSettings; at: number } | null = null;
const CACHE_MS = 5_000;
// Bumped by every change: a read that started before one is read again, so turning it off isn't undone by a read
// that was already on its way.
let generation = 0;

export async function getFederationSettings(): Promise<FederationSettings> {
  for (;;) {
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
    const asked = generation;
    const row = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
    if (asked !== generation) continue;
    const stored = (row?.value ?? {}) as Partial<FederationSettings>;
    const value: FederationSettings = {
      enabled: stored.enabled === true,
      reachability: stored.reachability ?? null,
    };
    cached = { value, at: Date.now() };
    return value;
  }
}

/** Changes only the fields in `patch`, merged in the database: a check finishing while an admin turns it off can't
 *  put the old switch back. */
export async function updateFederationSettings(patch: Partial<FederationSettings>): Promise<FederationSettings> {
  const value = JSON.stringify(patch);
  await prisma.$executeRaw`
    INSERT INTO "Setting" ("key", "value") VALUES (${SETTINGS_KEY}, ${value}::jsonb)
    ON CONFLICT ("key") DO UPDATE SET "value" = CASE
      WHEN jsonb_typeof("Setting"."value") = 'object' THEN "Setting"."value" || EXCLUDED."value"
      ELSE EXCLUDED."value"
    END`;
  generation += 1;
  cached = null;
  return getFederationSettings();
}

/** On, and live: it builds on social features, so it's quiet while they're off too. */
export async function isFederationLive(): Promise<boolean> {
  const settings = await getFederationSettings();
  if (!settings.enabled) return false;
  return (await getSocialSettings()).enabled;
}

/** For tests: forget what was read. */
export function clearFederationSettingsCache(): void {
  generation += 1;
  cached = null;
}
