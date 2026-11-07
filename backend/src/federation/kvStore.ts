import type { KvKey, KvStore, KvStoreListEntry, KvStoreSetOptions } from "@fedify/fedify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

// A key is a path of strings; stored joined, with a separator no part of Fedify's keys uses.
const SEP = "\u001f";
const encode = (key: KvKey): string => key.join(SEP);
const decode = (key: string): KvKey => key.split(SEP) as unknown as KvKey;

/** Fedify's store in our own table, so it's part of the Prisma schema and its migrations, not a table made aside. */
export class PrismaKvStore implements KvStore {
  async get<T = unknown>(key: KvKey): Promise<T | undefined> {
    const row = await prisma.federationKv.findUnique({ where: { key: encode(key) } });
    if (!row) return undefined;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return undefined;
    return row.value as T;
  }

  async set(key: KvKey, value: unknown, options?: KvStoreSetOptions): Promise<void> {
    const ttl = options?.ttl ? options.ttl.total({ unit: "millisecond" }) : null;
    const expiresAt = ttl === null ? null : new Date(Date.now() + ttl);
    const data = { value: (value ?? null) as Prisma.InputJsonValue, expiresAt };
    await prisma.federationKv.upsert({
      where: { key: encode(key) },
      create: { key: encode(key), ...data },
      update: data,
    });
  }

  async delete(key: KvKey): Promise<void> {
    await prisma.federationKv.deleteMany({ where: { key: encode(key) } });
  }

  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    const start = prefix ? encode(prefix) : "";
    const rows = await prisma.federationKv.findMany({
      where: {
        AND: [
          start ? { OR: [{ key: start }, { key: { startsWith: start + SEP } }] } : {},
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        ],
      },
    });
    for (const row of rows) yield { key: decode(row.key), value: row.value };
  }
}

/** Drops what has expired; run now and then. */
export async function purgeExpiredKv(now = new Date()): Promise<number> {
  const { count } = await prisma.federationKv.deleteMany({ where: { expiresAt: { lte: now } } });
  return count;
}
