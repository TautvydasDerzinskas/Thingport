import crypto from "node:crypto";
import { prisma } from "../db";
import { originOf } from "./addresses";
import { FederationFetchError } from "./fetch";

/** An instance's keys are the ones its admin compared when connecting (`Peer.publicKeys`): a document from it that
 *  publishes any other isn't taken, so a key swapped in on the way, which plain HTTP allows, can't sign for it. */

type Jwk = { kty?: string; n?: string; e?: string; crv?: string; x?: string };

/** The keys a document publishes under their usual names, as an actor (`publicKey`, `assertionMethod`) or as a key
 *  of its own. Renamed through a JSON-LD context they're missed here, which is why Fedify's own reading is checked
 *  too. */
export function publishedKeys(document: unknown): Jwk[] {
  const keys: Jwk[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const node = value as { publicKeyPem?: unknown; publicKeyMultibase?: unknown };
    if (typeof node.publicKeyPem === "string") keys.push(rsaJwk(node.publicKeyPem));
    if (typeof node.publicKeyMultibase === "string") keys.push(multikeyJwk(node.publicKeyMultibase));
  };
  const list = (value: unknown) => (Array.isArray(value) ? value : [value]);
  visit(document);
  if (document && typeof document === "object") {
    const doc = document as { publicKey?: unknown; assertionMethod?: unknown };
    list(doc.publicKey).forEach(visit);
    list(doc.assertionMethod).forEach(visit);
  }
  return keys;
}

function rsaJwk(pem: string): Jwk {
  try {
    const { kty, n, e } = crypto.createPublicKey(pem).export({ format: "jwk" });
    return { kty, n, e };
  } catch {
    return { kty: "unreadable" };
  }
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** A Multikey: base58btc (`z`), then a multicodec saying which kind: Ed25519 (0xed 0x01, then the 32-byte key) or
 *  RSA (0x85 0x24, then the key as PKCS#1 DER). */
function multikeyJwk(multibase: string): Jwk {
  if (!multibase.startsWith("z")) return { kty: "unreadable" };
  let value = 0n;
  for (const char of multibase.slice(1)) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return { kty: "unreadable" };
    value = value * 58n + BigInt(digit);
  }
  const hex = value.toString(16);
  const bytes = Buffer.from(hex.length % 2 ? `0${hex}` : hex, "hex");
  if (bytes.length === 34 && bytes[0] === 0xed && bytes[1] === 0x01) {
    return { kty: "OKP", crv: "Ed25519", x: bytes.subarray(2).toString("base64url") };
  }
  if (bytes[0] === 0x85 && bytes[1] === 0x24) {
    try {
      const key = crypto.createPublicKey({ key: bytes.subarray(2), format: "der", type: "pkcs1" });
      const { kty, n, e } = key.export({ format: "jwk" });
      return { kty, n, e };
    } catch {
      return { kty: "unreadable" };
    }
  }
  return { kty: "unreadable" };
}

function sameKey(a: Jwk, b: Jwk): boolean {
  if (a.kty !== b.kty) return false;
  return a.kty === "RSA" ? a.n === b.n && a.e === b.e : a.crv === b.crv && a.x === b.x;
}

/** Whether every one of `published` is one of `compared`. */
export function onlyComparedKeys(published: Jwk[], compared: Jwk[]): boolean {
  return published.every((key) => compared.some((known) => sameKey(key, known)));
}

/** Refuses a document from a connected (or asked) instance that publishes a key other than the ones compared.
 *  `published` is what both a plain read and Fedify's own (JSON-LD aware, see runtime.ts) find in it. */
export async function assertComparedKeys(url: string, published: Jwk[]): Promise<void> {
  const origin = originOf(url);
  if (!origin) return;
  const peer = await prisma.peer.findUnique({ where: { origin }, select: { status: true, publicKeys: true } });
  if (!peer || peer.status === "BLOCKED" || !Array.isArray(peer.publicKeys)) return;
  if (!onlyComparedKeys(published, peer.publicKeys as Jwk[])) {
    await prisma.peer
      .update({ where: { origin }, data: { lastError: "It signed with a key other than the one compared" } })
      .catch(() => {});
    throw new FederationFetchError(`${origin} published a key other than the one compared`, "invalid");
  }
}
