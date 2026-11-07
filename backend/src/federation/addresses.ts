import dns from "node:dns/promises";
import net from "node:net";

/** Where an address points, for talking to other instances:
 *  - `never`: this machine, link-local (cloud metadata) or reserved ranges; never fetched, whatever an admin approved.
 *  - `local`: a private network or a VPN (Tailscale's 100.64/10 among them); fine once an admin approved the instance.
 *  - `public`: the internet. */
export type AddressKind = "never" | "local" | "public";

// One list per family, each checked only with its own: a BlockList matches an IPv4 address against IPv6 rules in its
// IPv4-mapped form, so a ::ffff:0:0/96 rule would catch every IPv4 address.
const never4 = new net.BlockList();
never4.addSubnet("0.0.0.0", 8, "ipv4");
never4.addSubnet("127.0.0.0", 8, "ipv4");
never4.addSubnet("169.254.0.0", 16, "ipv4");
never4.addSubnet("192.0.0.0", 24, "ipv4");
never4.addSubnet("198.18.0.0", 15, "ipv4");
never4.addSubnet("224.0.0.0", 3, "ipv4");

const never6 = new net.BlockList();
never6.addAddress("::", "ipv6");
never6.addAddress("::1", "ipv6");
never6.addSubnet("fe80::", 10, "ipv6");
never6.addSubnet("ff00::", 8, "ipv6");
// IPv4 tunnelled in IPv6 could hide any address: IPv4-mapped, NAT64, 6to4 and Teredo.
never6.addSubnet("::ffff:0:0", 96, "ipv6");
never6.addSubnet("64:ff9b::", 96, "ipv6");
never6.addSubnet("2002::", 16, "ipv6");
never6.addSubnet("2001::", 32, "ipv6");

const local4 = new net.BlockList();
local4.addSubnet("10.0.0.0", 8, "ipv4");
local4.addSubnet("172.16.0.0", 12, "ipv4");
local4.addSubnet("192.168.0.0", 16, "ipv4");
local4.addSubnet("100.64.0.0", 10, "ipv4");

const local6 = new net.BlockList();
local6.addSubnet("fc00::", 7, "ipv6");

const globalUnicast6 = new net.BlockList();
globalUnicast6.addSubnet("2000::", 3, "ipv6");

/** Names that only mean something on a home or office network. */
const LOCAL_SUFFIXES = [".local", ".lan", ".home", ".home.arpa", ".internal", ".localdomain", ".intranet", ".corp"];

// Two instances on one machine, for tests and development only: otherwise this machine is never an instance to talk to.
const allowLoopback = () => process.env.FEDERATION_ALLOW_LOOPBACK === "1";

export function classifyIp(address: string): AddressKind {
  const family = net.isIP(address);
  if (!family) return "never";
  if (allowLoopback() && (address === "::1" || (family === 4 && address.startsWith("127.")))) return "local";
  if (family === 4) {
    if (never4.check(address, "ipv4")) return "never";
    return local4.check(address, "ipv4") ? "local" : "public";
  }
  if (never6.check(address, "ipv6")) return "never";
  if (local6.check(address, "ipv6")) return "local";
  // IPv6 outside global unicast is reserved.
  return globalUnicast6.check(address, "ipv6") ? "public" : "never";
}

export function isLocalName(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost") return false;
  // A single label (http://nas:8000) only resolves on the network it's on.
  if (!host.includes(".") && !net.isIP(host)) return true;
  return LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** The addresses a hostname resolves to, and what the most restricted of them is: one address this instance must
 *  never reach is enough to refuse it, and one public address is enough to call it public. */
export async function classifyHost(
  hostname: string,
  lookup: (host: string) => Promise<{ address: string }[]> = (host) => dns.lookup(host, { all: true, verbatim: true }),
): Promise<{ kind: AddressKind; addresses: string[] }> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [host] : (await lookup(host)).map((record) => record.address);
  if (!addresses.length) return { kind: "never", addresses };
  const kinds = new Set(addresses.map(classifyIp));
  if (kinds.has("never")) return { kind: "never", addresses };
  if (kinds.has("public") && !isLocalName(host)) return { kind: "public", addresses };
  return { kind: "local", addresses };
}

/** Scheme, host and port of an http(s) address, or null for anything else. */
export function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}
