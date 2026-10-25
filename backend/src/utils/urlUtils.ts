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
  // Canonicalise alternate spellings before checking IPv6 ranges.
  // This also rejects IPv4-mapped/compatible addresses, link-local /10, ULA,
  // unspecified and multicast without textual bypasses.
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  // DNS64's well-known /96 prefix preserves the destination in its last 32 bits.
  // Apply the IPv4 policy there too, so NAT64 cannot reach private destinations.
  if (canonical.startsWith("64:ff9b::")) {
    const tail = canonical.slice("64:ff9b::".length).split(":").filter(Boolean);
    if (tail.length > 2) return true;
    const low = parseInt(tail.pop() || "0", 16);
    const high = parseInt(tail.pop() || "0", 16);
    return isBlockedIp(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
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

// Whether a host is a domain or its subdomain, never a look-alike (`fake-makerworld.com`) that would be sent the
// user's cookie or token for the provider.
export { hostIs } from "../providers/index.generated";
