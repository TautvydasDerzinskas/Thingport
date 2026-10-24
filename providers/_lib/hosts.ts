/** Whether `hostname` is `domain` or one of its subdomains, so a look-alike such as `fake-makerworld.com` isn't. */
export function hostIs(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}
