import dns from "node:dns";
import net from "node:net";
import type { LookupFunction } from "node:net";
import { Agent } from "undici";
import { classifyIp, originOf } from "./addresses";

export class FederationFetchError extends Error {
  constructor(
    message: string,
    readonly code: "not_allowed" | "address" | "network" | "too_large" | "status" | "invalid",
    readonly status?: number,
  ) {
    super(message);
  }
}

// Resolved once per connection, and the same addresses handed to the socket, so a name can't be checked as one
// address and connect to another (DNS rebinding).
const lookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, records) => {
    if (error) return callback(error, [], 0);
    if (!records.length || records.some(({ address }) => classifyIp(address) === "never")) {
      return callback(new Error("That address points at this machine or a reserved range"), [], 0);
    }
    const selected = options.family ? records.filter(({ family }) => family === options.family) : records;
    if (!selected.length) return callback(new Error("Unable to resolve host"), [], 0);
    if (options.all) callback(null, selected, 0);
    else callback(null, selected[0].address, selected[0].family);
  });
};

const dispatcher = new Agent({
  connect: { lookup, timeout: 10_000 },
  headersTimeout: 15_000,
  bodyTimeout: 15_000,
});

const MAX_BODY = 1024 * 1024;
// For the whole exchange, body included: an instance dripping its answer out doesn't hold the request open.
const DEADLINE_MS = 30_000;

/** A request to another instance. Only to an origin `allowed` accepts, never to this machine, link-local (cloud
 *  metadata) or reserved addresses, and no redirects: an instance's documents live where it says they do. */
export async function federationFetch(
  url: string,
  init: RequestInit,
  allowed: (origin: string) => boolean | Promise<boolean>,
): Promise<Response> {
  const origin = originOf(url);
  if (!origin) throw new FederationFetchError("Not an http(s) address", "invalid");
  if (!(await allowed(origin))) throw new FederationFetchError(`Not a connected instance: ${origin}`, "not_allowed");
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  // The lookup above isn't asked about addresses written out as numbers.
  if (net.isIP(host) && classifyIp(host) === "never") {
    throw new FederationFetchError("That address points at this machine or a reserved range", "address");
  }
  try {
    return await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(DEADLINE_MS),
      redirect: "manual",
      dispatcher,
    } as RequestInit & { dispatcher: Agent });
  } catch (err) {
    const cause = (err as { cause?: Error }).cause;
    throw new FederationFetchError(cause?.message || (err as Error).message || "Network error", "network");
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
