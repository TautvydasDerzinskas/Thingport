import dns from "node:dns/promises";
import net from "node:net";
import { HttpError } from "./fileUtils";

export function isBlockedIp(address: string): boolean {
  const type = net.isIP(address);
  if (!type) return true;
  if (type === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // shared address space
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  // Canonicalise alternate spellings; only global unicast IPv6 is routable here.
  // This also rejects IPv4-mapped/compatible addresses, link-local /10, ULA,
  // unspecified, multicast and translation prefixes without textual bypasses.
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const first = parseInt(canonical.split(":")[0], 16);
  if (first < 0x2000 || first > 0x3fff || !Number.isFinite(first)) return true;
  // Teredo and 6to4 can encapsulate private IPv4 destinations.
  return canonical.startsWith("2001:0:") || canonical.startsWith("2001::") || canonical.startsWith("2002:");
}

export async function validateRemoteHost(host: string): Promise<void> {
  host = host.replace(/^\[|\]$/g, "");
  if (!host) throw new HttpError(400, "Invalid URL host");
  const lowered = host.toLowerCase();
  if (lowered === "localhost" || lowered.endsWith(".local")) {
    throw new HttpError(400, "Local addresses are not allowed");
  }
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new HttpError(400, "Local addresses are not allowed");
    return;
  }
  let records: string[];
  try {
    const [v4, v6] = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)]);
    records = [...(v4.status === "fulfilled" ? v4.value : []), ...(v6.status === "fulfilled" ? v6.value : [])];
  } catch {
    throw new HttpError(400, "Unable to resolve host");
  }
  if (records.length === 0) throw new HttpError(400, "Unable to resolve host");
  for (const ip of records) {
    if (isBlockedIp(ip)) throw new HttpError(400, "Local addresses are not allowed");
  }
}

export async function validateRemoteUrl(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, "Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, "URL must start with http:// or https://");
  }
  if (parsed.username || parsed.password) {
    throw new HttpError(400, "Credentials in URL are not allowed");
  }
  if (!parsed.hostname) throw new HttpError(400, "Invalid URL");
  await validateRemoteHost(parsed.hostname);
  return url;
}

export async function normalizeImportUrl(raw: string | null | undefined): Promise<string> {
  let value = (raw || "").trim();
  if (!value) throw new HttpError(400, "URL is required");
  if (!value.includes("://")) value = `https://${value}`;
  return validateRemoteUrl(value);
}

/** True for `domain` itself and any subdomain of it (`www.makerworld.com`), never for a look-alike that merely ends
 *  in the same letters (`fake-makerworld.com`). A bare `endsWith(domain)` would let such a host pass for the
 *  provider, and be sent the user's cookie or token for it. */
export function hostIs(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}
