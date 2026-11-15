import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { STORAGE, MODEL_PREVIEWS, ADAPTED_3MFS, TAG_MOSAICS, ICONS, COVERS, AVATARS } from "./config";

// THUMBS, PREVIEWS, DESCRIPTION_IMAGES and BUNDLES are only read now, for models the storage move hasn't reached.
for (const dir of [STORAGE, MODEL_PREVIEWS, ADAPTED_3MFS, TAG_MOSAICS, ICONS, COVERS, path.join(AVATARS, "gravatar")]) {
  fs.mkdirSync(dir, { recursive: true });
}
// The cache's names before it became ADAPTED_3MFS; nothing reads them any more.
for (const old of ["sanitized-3mf", "normalized-3mf"]) {
  fs.rmSync(path.join(STORAGE, old), { recursive: true, force: true });
}

let client = new PrismaClient();

// Forwards to whichever client is current, so databaseSettingsService.ts can swap it without
// every importer holding a stale reference.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    return Reflect.get(client as object, prop, client);
  },
});

/** Only called after the new connection has been verified. */
export function setActiveClient(next: PrismaClient): void {
  const old = client;
  client = next;
  void old.$disconnect().catch(() => undefined);
}
