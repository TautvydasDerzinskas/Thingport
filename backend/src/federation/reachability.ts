import crypto from "node:crypto";
import { AUTH_SECRET } from "../config";
import { prisma } from "../db";
import { getPublicUrl } from "../services/settingsService";
import { classifyHost, originOf, type AddressKind } from "./addresses";
import { FederationFetchError, federationFetch, readJson } from "./fetch";
import { updateFederationSettings, type Reachability, type ReachabilityKind } from "./settings";

const PROBE_TIMEOUT_MS = 8_000;

/** What /api/federation/probe answers for a nonce: only this instance can, as it takes its secret. */
export function probeProof(nonce: string): string {
  return crypto.createHmac("sha256", AUTH_SECRET).update(`thingport-federation-probe:${nonce}`).digest("hex");
}

type Deps = {
  publicUrl?: () => Promise<string>;
  classify?: (host: string) => Promise<{ kind: AddressKind; addresses: string[] }>;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
};

/** Whether other instances could reach this one at its Public URL: that the address leads back here (it answers a
 *  nonce with this instance's secret), and what kind of network it's on. Nothing leaves for a third party. */
export async function checkReachability(deps: Deps = {}): Promise<Reachability> {
  const checkedAt = new Date().toISOString();
  const url = await (deps.publicUrl ?? getPublicUrl)();
  const result = (kind: ReachabilityKind, addresses: string[] = []): Reachability => ({
    kind,
    url: url || null,
    addresses,
    checkedAt,
  });
  if (!url) return result("not_set");

  let address: { kind: AddressKind; addresses: string[] };
  try {
    address = await (deps.classify ?? classifyHost)(new URL(url).hostname);
  } catch {
    return result("unreachable");
  }
  // This machine itself, or a reserved range: no other instance could reach it there.
  if (address.kind === "never") return result("unreachable", address.addresses);

  const nonce = crypto.randomBytes(16).toString("hex");
  let answered: "self" | "other" | "none" = "none";
  try {
    // Through the same guard as every request to another instance: only to the Public URL's own origin, never to
    // this machine or a reserved range whatever its name resolves to now, and no redirects.
    const probe = `${url}/api/federation/probe/${nonce}`;
    const init = { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), headers: { Accept: "application/json" } };
    const response = await (
      deps.fetch ?? ((target, options) => federationFetch(target, options, (origin) => origin === originOf(url)))
    )(probe, init);
    let body = null as { proof?: unknown } | null;
    try {
      body = (await readJson(response, 64 * 1024)) as typeof body;
    } catch (err) {
      // Not JSON, or too big: something else answers. Cut off on the way: no answer, below.
      if (!(err instanceof FederationFetchError)) throw err;
    }
    answered = body?.proof === probeProof(nonce) ? "self" : "other";
  } catch (err) {
    console.warn(
      `[federation] This instance couldn't reach itself at ${url}:`,
      (err as Error).message,
      (err as { cause?: unknown }).cause ?? "",
    );
    answered = "none";
  }

  if (answered === "other") return result("elsewhere", address.addresses);
  if (answered === "self") return result(address.kind === "local" ? "local" : "public", address.addresses);
  // A public address that didn't answer from here may still answer from outside: some routers can't loop back.
  return result(address.kind === "public" ? "public_unverified" : "unreachable", address.addresses);
}

/** Whether a result lets federation be turned on. */
export function canTurnOn(kind: ReachabilityKind): boolean {
  return kind === "local" || kind === "public" || kind === "public_unverified";
}

export async function runReachabilityCheck(deps?: Deps): Promise<Reachability> {
  const reachability = await checkReachability(deps);
  await updateFederationSettings({ reachability });
  return reachability;
}

/** Partners that reached this instance lately: proof from outside that it can be reached. */
export async function confirmedByPartners(days = 30): Promise<number> {
  return prisma.peer.count({
    where: { status: { in: ["ACTIVE", "PAUSED"] }, lastInboundAt: { gte: new Date(Date.now() - days * 86_400_000) } },
  });
}
