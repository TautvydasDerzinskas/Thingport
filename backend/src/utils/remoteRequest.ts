import { browserFetch } from "./browserFetch";
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

// Impit cannot pin DNS. Its exception is confined to provider-controlled origins;
// never extend this to suffix matches, arbitrary ports or caller-provided hosts.
const BROWSER_ORIGINS = new Set([
  "https://thingiverse.com",
  "https://www.thingiverse.com",
  "https://api.thingiverse.com",
  "https://myminifactory.com",
  "https://www.myminifactory.com",
  "https://thangs.com",
  "https://www.thangs.com",
]);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Follow redirects only after checking each destination, including anonymous imports. */
export async function remoteRequest(url: string, init: RequestInit = {}, browser = false): Promise<Response> {
  let current = url;
  let method = (init.method || "GET").toUpperCase();
  let body = init.body;
  const headers = new Headers(init.headers);
  for (let hop = 0; hop <= 10; hop++) {
    await validateRemoteUrl(current);
    const response =
      browser && BROWSER_ORIGINS.has(new URL(current).origin)
        ? await browserFetch(current, {
            method: method as "GET" | "POST",
            body: body as string | undefined,
            headers: Object.fromEntries(headers.entries()),
            signal: init.signal || undefined,
            redirect: "manual",
          })
        : await fetch(current, {
            ...init,
            method,
            body,
            headers,
            redirect: "manual",
            dispatcher: remoteDispatcher,
          } as RequestInit & { dispatcher: Agent });
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
