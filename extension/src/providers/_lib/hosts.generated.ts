// GENERATED from providers/_lib/hosts.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
/** Whether `hostname` is `domain` or one of its subdomains, so a look-alike such as `fake-makerworld.com` isn't. */
export function hostIs(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

/** Whether `hostname` is `domain` or its www, the hosts a site's pages are on. */
export function hostIsSite(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  return host === domain || host === `www.${domain}`;
}
