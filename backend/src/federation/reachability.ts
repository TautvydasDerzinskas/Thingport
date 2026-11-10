import crypto from "node:crypto";
import { AUTH_SECRET } from "../config";
import { prisma } from "../db";
import { getPublicUrl } from "../services/settingsService";
import { classifyHost, originOf, type AddressKind } from "./addresses";
import { FederationFetchError, federationFetch, readJson } from "./fetch";
import { updateFederationSettings, type ProbeFailure, type Reachability, type ReachabilityKind } from "./settings";

const PROBE_TIMEOUT_MS = 8_000;
const DETAIL_MAX = 300;

const NOT_FOUND = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NONAME", "ENODATA", "ESERVFAIL"]);
const TIMEOUTS = new Set(["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
// OpenSSL's verify errors (self-signed, unknown issuer, expired) and Node's for a name the certificate doesn't cover.
const CERTIFICATE = /CERT|SELF_SIGNED|UNABLE_TO_(GET_ISSUER|VERIFY_LEAF)/;

/** Node's code for why a request failed, wherever it is among the causes. */
function codeOf(err: unknown): string | null {
  let at = err;
  for (let depth = 0; at && depth < 5; depth += 1) {
    // Ours names its kind, not the cause.
    const code = at instanceof FederationFetchError ? null : (at as { code?: unknown }).code;
    if (typeof code === "string") return code;
    at = (at as { cause?: unknown }).cause;
  }
  return null;
}

/** What went wrong, told apart enough for an admin to know what to fix. */
function failureOf(err: unknown, timedOut: boolean): { reason: ProbeFailure; detail: string | null } {
  const code = codeOf(err);
  const reason: ProbeFailure =
    timedOut || (code && TIMEOUTS.has(code))
      ? "timeout"
      : code && NOT_FOUND.has(code)
        ? "not_found"
        : code === "ECONNREFUSED"
          ? "refused"
          : code && CERTIFICATE.test(code)
            ? "certificate"
            : "failed";
  const message = err instanceof Error ? err.message : String(err);
  // Node adds a hint to a certificate's error about its own options, which in a container is the wrong fix.
  const said = reason === "certificate" ? message.split(";")[0] : message;
  return { reason, detail: said.slice(0, DETAIL_MAX) || null };
}

/** What /api/federation/probe answers for a nonce: only this instance can, as it takes its secret. */
export function probeProof(nonce: string): string {
  return crypto.createHmac("sha256", AUTH_SECRET).update(`thingport-federation-probe:${nonce}`).digest("hex");
}

type Deps = {
  publicUrl?: () => Promise<string>;
  classify?: (host: string) => Promise<{ kind: AddressKind; addresses: string[] }>;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
};

/** Whether other instances could reach this one at its Public URL: that the address leads back here (it answers a
 *  nonce with this instance's secret), and what kind of network it's on. Nothing leaves for a third party. */
export async function checkReachability(deps: Deps = {}): Promise<Reachability> {
  const checkedAt = new Date().toISOString();
  const url = await (deps.publicUrl ?? getPublicUrl)();
  const result = (
    kind: ReachabilityKind,
    addresses: string[] = [],
    failure: { reason?: ProbeFailure; detail?: string | null } = {},
  ): Reachability => ({
    kind,
    url: url || null,
    addresses,
    checkedAt,
    reason: failure.reason ?? null,
    detail: failure.detail ?? null,
  });
  if (!url) return result("not_set");

  let address: { kind: AddressKind; addresses: string[] };
  try {
    address = await (deps.classify ?? classifyHost)(new URL(url).hostname);
  } catch (err) {
    return result("unreachable", [], failureOf(err, false));
  }
  // This machine itself, or a reserved range: no other instance could reach it there.
  if (address.kind === "never") return result("unreachable", address.addresses, { reason: "reserved" });

  const nonce = crypto.randomBytes(16).toString("hex");
  const signal = AbortSignal.timeout(deps.timeoutMs ?? PROBE_TIMEOUT_MS);
  let answered: "self" | "other" | "none" = "none";
  let failure: { reason?: ProbeFailure; detail?: string | null } = {};
  try {
    // Through the same guard as every request to another instance: only to the Public URL's own origin, never to
    // this machine or a reserved range whatever its name resolves to now, and no redirects.
    const probe = `${url}/api/federation/probe/${nonce}`;
    const init = { signal, headers: { Accept: "application/json" } };
    const response = await (
      deps.fetch ?? ((target, options) => federationFetch(target, options, (origin) => origin === originOf(url)))
    )(probe, init);
    if (response.status >= 300 && response.status < 400) {
      // Never followed, by this check or by other instances: what they ask for lives where it says it does.
      await response.body?.cancel().catch(() => {});
      failure = { reason: "redirect", detail: response.headers.get("location")?.slice(0, DETAIL_MAX) || null };
    } else {
      let body = null as { proof?: unknown } | null;
      try {
        body = (await readJson(response, 64 * 1024)) as typeof body;
      } catch (err) {
        // Not JSON, or too big: something else answers. Cut off on the way: no answer, below.
        if (!(err instanceof FederationFetchError)) throw err;
      }
      answered = body?.proof === probeProof(nonce) ? "self" : "other";
      if (answered === "other" && !response.ok) failure = { detail: `HTTP ${response.status}` };
    }
  } catch (err) {
    console.warn(
      `[federation] This instance couldn't reach itself at ${url}:`,
      (err as Error).message,
      (err as { cause?: unknown }).cause ?? "",
    );
    answered = "none";
    failure = failureOf(err, signal.aborted);
  }

  if (answered === "other") return result("elsewhere", address.addresses, failure);
  if (answered === "self") return result(address.kind === "local" ? "local" : "public", address.addresses);
  // A public address that didn't answer from here may still answer from outside: some routers can't loop back.
  return result(address.kind === "public" ? "public_unverified" : "unreachable", address.addresses, failure);
}

/** Whether a result lets federation be turned on. One that nothing reaches at its Public URL still connects to the
 *  instances it reaches, keeping a link open to each, but it needs an address to be known by that isn't this machine
 *  or a reserved range: no other instance connects to those. */
export function canTurnOn(reachability: Pick<Reachability, "kind" | "reason">): boolean {
  return reachability.kind !== "not_set" && reachability.reason !== "reserved";
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
