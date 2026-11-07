import { AsyncLocalStorage } from "node:async_hooks";
import dns from "node:dns";
import net from "node:net";
import type { LookupFunction } from "node:net";
import { Agent } from "undici";
import { classifyIp, originOf } from "./addresses";
import { lineFor } from "./allowlist";

export class FederationFetchError extends Error {
  constructor(
    message: string,
    readonly code: "not_allowed" | "address" | "network" | "too_large" | "status" | "invalid",
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

// Resolved once per connection, and the same addresses handed to the socket, so a name can't be checked as one
// address and connect to another (DNS rebinding). `refused` turns away every address it says no to.
const guardedLookup =
  (refused: (address: string) => boolean | Promise<boolean>, why: string): LookupFunction =>
  (hostname, options, callback) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (error, records) => {
      if (error) return callback(error, [], 0);
      void Promise.all(records.map(({ address }) => refused(address))).then(
        (refusals) => {
          if (!records.length || refusals.some(Boolean)) return callback(new Error(why), [], 0);
          const selected = options.family ? records.filter(({ family }) => family === options.family) : records;
          if (!selected.length) return callback(new Error("Unable to resolve host"), [], 0);
          if (options.all) callback(null, selected, 0);
          else callback(null, selected[0].address, selected[0].family);
        },
        (err: Error) => callback(err, [], 0),
      );
    });
  };

const agentWith = (lookup: LookupFunction) =>
  new Agent({ connect: { lookup, timeout: 10_000 }, headersTimeout: 15_000, bodyTimeout: 15_000 });

const dispatcher = agentWith(
  guardedLookup(
    (address) => classifyIp(address) === "never",
    "That address points at this machine or a reserved range",
  ),
);

/** A lookup of an address as it is on the internet, whatever this instance knows of it: never down a link (a
 *  partner's there, or a request's), connecting only to addresses `isPublic` takes, and given up with `signal`. */
type Direct = {
  origin: string;
  signal: AbortSignal;
  isPublic: (address: string) => Promise<boolean>;
  dispatcher: Agent;
};
const direct = new AsyncLocalStorage<Direct>();

/** Runs `fn` with what it fetches from `origin` going straight to it, as `Direct` says. */
export async function fetchDirectly<T>(
  origin: string,
  options: { signal: AbortSignal; isPublic: (address: string) => Promise<boolean> },
  fn: () => Promise<T>,
): Promise<T> {
  const agent = agentWith(
    guardedLookup(async (address) => !(await options.isPublic(address)), "That isn't an address on the internet"),
  );
  try {
    return await direct.run({ origin, ...options, dispatcher: agent }, fn);
  } finally {
    await agent.destroy().catch(() => {});
  }
}

const MAX_BODY = 1024 * 1024;
// For the whole exchange, body included: an instance dripping its answer out doesn't hold the request open.
const DEADLINE_MS = 30_000;

/** Sends a request down an instance's link (links.ts), set once that's loaded. */
type LinkRoute = (line: string, url: string, init: RequestInit) => Promise<Response>;
let linkRoute: LinkRoute | null = null;
export function routeLinksThrough(route: LinkRoute): void {
  linkRoute = route;
}

export const NOT_LINKED = "Their instance isn't connected right now";

// For tests: origins this instance acts as if it can't reach, as one behind NAT can't be.
const unreachable = () =>
  new Set(
    (process.env.FEDERATION_UNREACHABLE ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

/** A request to another instance. Only to an origin `allowed` accepts, never to this machine, link-local (cloud
 *  metadata) or reserved addresses, and no redirects: an instance's documents live where it says they do. One that
 *  can't be reached from here goes through the link it keeps open, never to its address. */
export async function federationFetch(
  url: string,
  init: RequestInit,
  allowed: (origin: string) => boolean | Promise<boolean>,
): Promise<Response> {
  const origin = originOf(url);
  if (!origin) throw new FederationFetchError("Not an http(s) address", "invalid");
  if (!(await allowed(origin))) throw new FederationFetchError(`Not a connected instance: ${origin}`, "not_allowed");
  const straight = direct.getStore()?.origin === origin ? direct.getStore()! : null;
  const line = straight ? null : await lineFor(origin);
  if (line) {
    if (line === "ended" || !linkRoute) throw new FederationFetchError(NOT_LINKED, "network");
    return linkRoute(line, url, { ...init, signal: init.signal ?? AbortSignal.timeout(DEADLINE_MS) });
  }
  if (unreachable().has(origin)) throw new FederationFetchError(`Couldn't connect to ${origin}`, "network");
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  // The lookup above isn't asked about addresses written out as numbers.
  if (net.isIP(host) && classifyIp(host) === "never") {
    throw new FederationFetchError("That address points at this machine or a reserved range", "address");
  }
  if (straight && net.isIP(host) && !(await straight.isPublic(host))) {
    throw new FederationFetchError("That isn't an address on the internet", "address");
  }
  const signal = init.signal ?? AbortSignal.timeout(DEADLINE_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: straight ? AbortSignal.any([signal, straight.signal]) : signal,
      redirect: "manual",
      dispatcher: straight?.dispatcher ?? dispatcher,
    } as RequestInit & { dispatcher: Agent });
  } catch (err) {
    const cause = (err as { cause?: Error }).cause;
    // The cause kept, for its code: a certificate nothing trusts reads differently from nothing answering.
    throw new FederationFetchError(cause?.message || (err as Error).message || "Network error", "network", undefined, {
      cause: cause ?? err,
    });
  }
}

/** The body as JSON, refusing anything over 1 MB: an instance's documents are small. */
export async function readJson(response: Response, max = MAX_BODY): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > max) {
    await response.body?.cancel().catch(() => {});
    throw new FederationFetchError("Response too large", "too_large");
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new FederationFetchError("Response too large", "too_large");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new FederationFetchError("Not JSON", "invalid");
  }
}
