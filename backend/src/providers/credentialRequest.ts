/** Destinations that may receive a provider credential. URL recognition is deliberately broader than this list. */
import { browserFetch } from "../utils/browserFetch";
import { CREDENTIAL_HOSTS, type CredentialDestination } from "./credentialHosts.generated";

/** Check the request that actually carries a secret, not just the URL originally classified as a provider link. */
export function assertCredentialDestination(destination: CredentialDestination, input: string | URL): URL {
  const url = input instanceof URL ? input : new URL(input);
  const rule = CREDENTIAL_HOSTS[destination];
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    (!(rule.exact as readonly string[]).includes(host) &&
      !("suffix" in rule && (rule.suffix as readonly string[]).some((suffix) => host.endsWith(suffix))))
  ) {
    throw new Error(`Refusing to send ${destination} credentials to ${url.origin}`);
  }
  return url;
}

type Transport = (url: string, init: RequestInit) => Promise<Response>;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Follow redirects ourselves so every hop is checked before the credential-bearing request is sent. */
export async function credentialRequest(
  destination: CredentialDestination,
  input: string | URL,
  init: RequestInit,
  transport: Transport = fetch,
): Promise<Response> {
  let url = assertCredentialDestination(destination, input);
  let request = { ...init, redirect: "manual" as const };
  for (let hop = 0; hop < 5; hop++) {
    const res = await transport(url.toString(), request);
    const location = res.headers.get("location");
    if (!REDIRECT_STATUSES.has(res.status) || !location) return res;
    let next: URL;
    try {
      next = assertCredentialDestination(destination, new URL(location, url));
    } finally {
      await res.body?.cancel().catch(() => undefined);
    }
    // A different origin must never inherit the current request's headers or body.
    if (next.origin !== url.origin) {
      throw new Error(`Refusing to redirect ${destination} credentials to ${next.origin}`);
    }
    if (
      res.status === 303 ||
      ((res.status === 301 || res.status === 302) && request.method?.toUpperCase() === "POST")
    ) {
      const headers = new Headers(request.headers);
      headers.delete("content-type");
      request.method = "GET";
      request.body = undefined;
      request.headers = headers;
    }
    url = next;
  }
  throw new Error(`Too many redirects for ${destination}`);
}

/** The same boundary for providers that need a browser TLS fingerprint to reach their API. */
export function browserCredentialRequest(
  destination: CredentialDestination,
  input: string | URL,
  init: Parameters<typeof browserFetch>[1],
): Promise<Response> {
  return credentialRequest(destination, input, init as RequestInit, (url, request) =>
    browserFetch(url, {
      ...init,
      method: request.method as "GET" | "POST" | undefined,
      body: request.body as string | undefined,
      headers:
        request.headers instanceof Headers
          ? Object.fromEntries(request.headers.entries())
          : (request.headers as Record<string, string> | undefined),
      redirect: "manual",
    }),
  );
}
