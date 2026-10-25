import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { STORAGE, MODEL_PREVIEWS, NORMALIZED_3MFS, TAG_MOSAICS, ICONS } from "./config";

// THUMBS, PREVIEWS, DESCRIPTION_IMAGES and BUNDLES are only read now, for models the storage move hasn't reached.
for (const dir of [STORAGE, MODEL_PREVIEWS, NORMALIZED_3MFS, TAG_MOSAICS, ICONS]) {
  fs.mkdirSync(dir, { recursive: true });
}
// The cache's name before it became NORMALIZED_3MFS; nothing reads it any more.
fs.rmSync(path.join(STORAGE, "sanitized-3mf"), { recursive: true, force: true });

let client = new PrismaClient();
let activeDatabaseUrl = process.env.DATABASE_URL ?? "";

export function getActiveDatabaseUrl(): string {
  return activeDatabaseUrl;
}

// Forwards to whichever client is current, so databaseSettingsService.ts can swap it without
// every importer holding a stale reference.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    return Reflect.get(client as object, prop, client);
  },
});

/** Only called after the new connection has been verified. */
export function setActiveClient(next: PrismaClient, databaseUrl = activeDatabaseUrl): void {
  activeDatabaseUrl = databaseUrl;
  const old = client;
  client = next;
  void old.$disconnect().catch(() => undefined);
}
