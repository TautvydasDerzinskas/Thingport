import { browserFetch, needsBrowserFetch } from "./browserFetch";
import dns from "node:dns";
import type { LookupFunction } from "node:net";
import { Agent } from "undici";
import { isBlockedIp, validateRemoteUrl } from "./urlUtils";

// Resolve exactly once for each new socket and hand those same validated addresses
// to net.connect. A separate validation lookup alone is vulnerable to rebinding.
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, records) => {
    if (error) return callback(error, [], 0);
    if (!records.length || records.some(({ address }) => isBlockedIp(address))) {
      return callback(new Error("Local addresses are not allowed"), [], 0);
    }
    const selected = options.family ? records.filter(({ family }) => family === options.family) : records;
    if (!selected.length) return callback(new Error("Unable to resolve host"), [], 0);
    if (options.all) callback(null, selected, 0);
    else callback(null, selected[0].address, selected[0].family);
  });
};
const remoteDispatcher = new Agent({ connect: { lookup: guardedLookup } });

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** One checked request without following redirects; callers must validate the next hop separately. */
export async function fetchRemoteHop(url: string, init: RequestInit = {}, browser = false): Promise<Response> {
  await validateRemoteUrl(url);
  // Impit has no connection-time DNS hook; its exception stays limited to provider-owned exact HTTPS origins.
  return browser && needsBrowserFetch(url)
    ? browserFetch(url, {
        method: (init.method || "GET") as "GET" | "POST",
        body: init.body as string | undefined,
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        signal: init.signal || undefined,
        redirect: "manual",
      })
    : fetch(url, { ...init, redirect: "manual", dispatcher: remoteDispatcher } as RequestInit & { dispatcher: Agent });
}

/** Follow redirects only after checking each destination, including anonymous imports. */
export async function remoteRequest(url: string, init: RequestInit = {}, browser = false): Promise<Response> {
  let current = url;
  let method = (init.method || "GET").toUpperCase();
  let body = init.body;
  const headers = new Headers(init.headers);
  for (let hop = 0; hop <= 10; hop++) {
    const response = await fetchRemoteHop(current, { ...init, method, body, headers }, browser);
    const location = response.headers.get("location");
    if (!REDIRECT_STATUSES.has(response.status) || !location) return response;
    await response.body?.cancel();
    if (hop === 10) throw new Error("Too many remote redirects");
    const next = new URL(location, current).href;
    if (new URL(next).origin !== new URL(current).origin) {
      headers.delete("authorization");
      headers.delete("cookie");
      headers.delete("proxy-authorization");
    }
    if (
      (response.status === 303 && method !== "HEAD") ||
      ((response.status === 301 || response.status === 302) && method === "POST")
    ) {
      method = "GET";
      body = undefined;
      for (const name of ["content-type", "content-length", "content-encoding", "content-language", "content-location"])
        headers.delete(name);
    }
    current = next;
  }
  throw new Error("Too many remote redirects");
}
