import crypto from "node:crypto";
import type { webcrypto } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

type CryptoKey = webcrypto.CryptoKey;
type StoredPair = { privateKey: webcrypto.JsonWebKey; publicKey: webcrypto.JsonWebKey };
type StoredKeys = { rsa: StoredPair; ed25519: StoredPair; createdAt: string };

export type InstanceKeys = {
  /** Signs HTTP requests (draft-cavage and RFC 9421). */
  rsa: webcrypto.CryptoKeyPair;
  /** For object proofs, published as the actor's Multikey. */
  ed25519: webcrypto.CryptoKeyPair;
};

// Apart from the "federation" setting, so reading that can never hand out a private key.
const KEYS_KEY = "federation_keys";

let loaded: Promise<InstanceKeys> | null = null;

/** The instance's key pairs, made the first time federation is turned on. They are its identity to partners: a new
 *  pair would make every partner see a different instance. */
export function getInstanceKeys(): Promise<InstanceKeys> {
  loaded ??= loadOrCreate().catch((err) => {
    loaded = null;
    throw err;
  });
  return loaded;
}

async function loadOrCreate(): Promise<InstanceKeys> {
  const { exportJwk, generateCryptoKeyPair, importJwk } = await import("@fedify/fedify");
  const row = await prisma.setting.findUnique({ where: { key: KEYS_KEY } });
  if (row) {
    const stored = row.value as unknown as StoredKeys;
    const pair = async (p: StoredPair): Promise<webcrypto.CryptoKeyPair> => ({
      privateKey: (await importJwk(p.privateKey as never, "private")) as CryptoKey,
      publicKey: (await importJwk(p.publicKey as never, "public")) as CryptoKey,
    });
    return { rsa: await pair(stored.rsa), ed25519: await pair(stored.ed25519) };
  }
  const rsa = (await generateCryptoKeyPair("RSASSA-PKCS1-v1_5")) as webcrypto.CryptoKeyPair;
  const ed25519 = (await generateCryptoKeyPair("Ed25519")) as webcrypto.CryptoKeyPair;
  const store = async (p: webcrypto.CryptoKeyPair): Promise<StoredPair> => ({
    privateKey: (await exportJwk(p.privateKey as never)) as webcrypto.JsonWebKey,
    publicKey: (await exportJwk(p.publicKey as never)) as webcrypto.JsonWebKey,
  });
  const value: StoredKeys = {
    rsa: await store(rsa),
    ed25519: await store(ed25519),
    createdAt: new Date().toISOString(),
  };
  // Two first enables at once keep whichever was written first, so both end up with the same identity.
  await prisma.setting.upsert({
    where: { key: KEYS_KEY },
    create: { key: KEYS_KEY, value: value as unknown as Prisma.InputJsonValue },
    update: {},
  });
  const saved = await prisma.setting.findUniqueOrThrow({ where: { key: KEYS_KEY } });
  if (JSON.stringify(saved.value) !== JSON.stringify(value)) {
    loaded = null;
    return loadOrCreate();
  }
  return { rsa, ed25519 };
}

/** Whether keys were ever made: the fingerprint is shown only then. */
export async function hasInstanceKeys(): Promise<boolean> {
  return (await prisma.setting.count({ where: { key: KEYS_KEY } })) > 0;
}

/** Six groups of four hex digits from the SHA-256 of the public keys, RSA then Ed25519: short enough for two admins to
 *  read out to each other, long enough (96 bits) that no one can make a key to match. The same on both sides, since
 *  each computes it from the keys the actor publishes. */
export async function keyFingerprint(rsaPublic: CryptoKey, ed25519Public?: CryptoKey | null): Promise<string> {
  const parts = [Buffer.from(await crypto.subtle.exportKey("spki", rsaPublic))];
  if (ed25519Public) parts.push(Buffer.from(await crypto.subtle.exportKey("spki", ed25519Public)));
  const hex = crypto.createHash("sha256").update(Buffer.concat(parts)).digest("hex").toUpperCase().slice(0, 24);
  return hex.match(/.{4}/g)!.join(" ");
}

export async function instanceFingerprint(): Promise<string> {
  const keys = await getInstanceKeys();
  return keyFingerprint(keys.rsa.publicKey, keys.ed25519.publicKey);
}

/** For tests. */
export function forgetInstanceKeys(): void {
  loaded = null;
}
