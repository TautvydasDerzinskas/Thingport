import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Peer } from "@prisma/client";
import type { Request as ExpressRequest, Response } from "express";
import { prisma } from "../db";
import { resolveAvatar } from "../services/avatarService";
import { previewImagePath } from "../services/previewImageService";
import { resolvePlateFilePath } from "../services/printCreation";
import { managedPrintFilePath } from "../services/printFileService";
import { plateThumbPath } from "../services/printService";
import { coverOut, coverPath } from "../services/publicProfileService";
import { sharedAtOf, sharedModelCounts, sharedModelsWhere, sharers } from "../services/socialService";
import { originOf } from "./addresses";
import { canonicalHeaders, keyIdOf } from "./edge";
import { AP_PREFIX, getRuntime, type Runtime } from "./runtime";

/** What this instance's people share, as partners read it: the people (a directory), each one's models and public
 *  collections, and their pictures. Only an ACTIVE partner's signed request is answered, and it gets what a signed-in
 *  person here sees of the others, nothing more. Shaped like Manyfold's (models as `Service`, collections as `Group`,
 *  each with `f3di:concreteType`), so a bridge to it later reads the same; what Thingport adds is under `thingport:`. */

export const CONTEXT = [
  "https://www.w3.org/ns/activitystreams",
  { f3di: "http://purl.org/f3di/ns#", thingport: "https://github.com/TautvydasDerzinskas/Thingport#" },
];
// A page a partner reads has to fit the 1 MB its fetch takes, whatever is in it.
export const PAGE_BYTES = 900 * 1024;
// Models a page at most, fewer when they're big: a page ends before it would pass PAGE_BYTES.
export const MODELS_PAGE = 50;
// People a page, each no bigger than PERSON_MAX_BYTES.
export const DIRECTORY_PAGE = 50;
export const PERSON_MAX_BYTES = 18 * 1024;
// What a partner keeps (remoteIndex.ts), so nothing more goes: of a name (no limit of its own here), and of a model's
// and a collection's text, files and pictures.
const NAME_MAX = 120;
const MODEL_NAME_MAX = 300;
const MODEL_DESCRIPTION_MAX = 20_000;
const MODEL_FILES_MAX = 100;
const MODEL_IMAGES_MAX = 20;
const COLLECTION_NAME_MAX = 200;
const COLLECTION_DESCRIPTION_MAX = 5000;
const DIRECTORY_LIMIT = 500;
const COLLECTIONS_LIMIT = 200;
// Collections a page, each at most about 30 KB (its text as cut above, and its first model ids): 12 fit a page.
export const COLLECTIONS_PAGE = 12;
// A collection's models by id: the first ones come with it, the rest a page at a time.
export const COLLECTION_FIRST_IDS = 200;
export const COLLECTION_IDS_PAGE = 1000;

// A partner's key, kept for a while: every page a partner reads would otherwise fetch its actor again. Kept under the
// partner as it's connected now, keys compared and all, so one that reconnects with new keys under the same ids never
// gets its old one back.
const keys = new Map<string, { key: unknown; at: number }>();
const KEY_TTL_MS = 10 * 60 * 1000;
const keyCacheFor = (peer: Peer) => {
  const slot = (keyId: URL) => `${peer.id} ${peer.fingerprint ?? ""} ${peer.connectedAt?.getTime() ?? 0} ${keyId.href}`;
  return {
    async get(keyId: URL) {
      const hit = keys.get(slot(keyId));
      return hit && Date.now() - hit.at < KEY_TTL_MS ? (hit.key as never) : undefined;
    },
    async set(keyId: URL, key: unknown) {
      for (const [name, entry] of keys) if (Date.now() - entry.at >= KEY_TTL_MS) keys.delete(name);
      if (key) keys.set(slot(keyId), { key, at: Date.now() });
      else keys.delete(slot(keyId));
    },
  };
};

/** The ACTIVE partner a GET is signed by, its signature checked against the key compared when connecting; null for
 *  anyone else. */
export async function signingPartner(req: ExpressRequest): Promise<Peer | null> {
  const origin = originOf(keyIdOf(req.headers) ?? "");
  if (!origin) return null;
  const peer = await prisma.peer.findUnique({ where: { origin } });
  if (!peer || peer.status !== "ACTIVE" || !peer.actorUrl) return null;
  const runtime = await getRuntime();
  const request = new Request(new URL(req.originalUrl, runtime.origin), {
    method: req.method,
    headers: canonicalHeaders(req.headers, runtime.origin),
  });
  const key = await runtime.fedify
    .verifyRequest(request, {
      documentLoader: runtime.pinnedLoader as never,
      contextLoader: runtime.contextLoader as never,
      keyCache: keyCacheFor(peer) as never,
    })
    .catch(() => null);
  if (!key?.id || key.id.href.split("#")[0] !== peer.actorUrl) return null;
  return peer;
}

const actorUrl = (runtime: Runtime, userId: string) => `${runtime.origin}${AP_PREFIX}/actors/${userId}`;
const mediaUrl = (runtime: Runtime, kind: string, id: string, version?: number | string) =>
  `${runtime.origin}${AP_PREFIX}/media/${kind}/${id}${version !== undefined ? `?v=${version}` : ""}`;
const markdown = (content: string | null) => (content ? { content, mediaType: "text/markdown" } : undefined);

function mtime(file: string): number | null {
  try {
    return Math.round(fs.statSync(file).mtimeMs);
  } catch {
    return null;
  }
}

/** Everyone here who shares something, newest sharer first, a page at a time: each a Person with what they share
 *  counted. */
export async function directory(page = 0): Promise<unknown> {
  const runtime = await getRuntime();
  const shared = (await sharers()).slice(0, DIRECTORY_LIMIT);
  const base = `${runtime.origin}${AP_PREFIX}/directory`;
  return {
    "@context": CONTEXT,
    id: `${base}?page=${page}`,
    type: "OrderedCollectionPage",
    partOf: base,
    totalItems: shared.length,
    next: (page + 1) * DIRECTORY_PAGE < shared.length ? `${base}?page=${page + 1}` : undefined,
    orderedItems: await people(runtime, shared.slice(page * DIRECTORY_PAGE, (page + 1) * DIRECTORY_PAGE)),
  };
}

/** One person here who shares something, at the id the directory gives them; null for anyone else. */
export async function person(userId: string): Promise<unknown | null> {
  const runtime = await getRuntime();
  const shared = (await sharers()).find((row) => row.userId === userId);
  const [found] = shared ? await people(runtime, [shared]) : [];
  return found ? { "@context": CONTEXT, ...found } : null;
}

async function people(runtime: Runtime, shared: { userId: string; at: Date }[]): Promise<Record<string, unknown>[]> {
  const userIds = shared.map((row) => row.userId);
  const [users, collections, modelCount] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        username: true,
        displayName: true,
        bio: true,
        profileLinks: true,
        backgroundUrl: true,
        coverPreset: true,
        coverPositionY: true,
        createdAt: true,
        email: true,
        avatarUrl: true,
        avatarStyle: true,
      },
    }),
    prisma.collection.groupBy({ by: ["userId"], where: { userId: { in: userIds }, isPublic: true }, _count: true }),
    sharedModelCounts(userIds),
  ]);
  const byId = new Map(users.map((user) => [user.id, user]));
  const collectionCount = new Map(collections.map((row) => [row.userId, row._count]));
  const items = await Promise.all(
    shared.map(async ({ userId, at }) => {
      const user = byId.get(userId);
      if (!user) return null;
      const id = actorUrl(runtime, userId);
      const cover = coverOut(user);
      const ownCover = /^\/api\/covers\/([a-f0-9]{32}\.webp)$/.exec(cover.background_url ?? "")?.[1];
      const coverFile = ownCover ? coverPath(ownCover) : null;
      const icon = await avatarIcon(runtime, userId);
      return {
        id,
        type: "Person",
        "f3di:concreteType": "User",
        preferredUsername: user.username ?? undefined,
        name: user.displayName.slice(0, NAME_MAX),
        source: markdown(user.bio),
        attachment: user.profileLinks.map((href) => ({ type: "Link", href })),
        icon: icon ? { type: "Image", url: icon } : undefined,
        image:
          coverFile && mtime(coverFile) !== null
            ? { type: "Image", url: mediaUrl(runtime, "cover", userId, mtime(coverFile)!) }
            : undefined,
        published: user.createdAt.toISOString(),
        "thingport:coverPreset": cover.cover_preset ?? undefined,
        "thingport:coverPositionY": cover.cover_position_y,
        "thingport:sharedAt": at.toISOString(),
        "thingport:modelCount": modelCount.get(userId) ?? 0,
        "thingport:collectionCount": collectionCount.get(userId) ?? 0,
        "thingport:models": `${id}/models`,
        "thingport:collections": `${id}/collections`,
      };
    }),
  );
  return items.filter((item): item is NonNullable<typeof item> => item !== null).map(fitPerson);
}

/** Where a partner gets someone's avatar, versioned so a new one gets a new address: a drawn one by what's drawn. Null
 *  for none. */
export async function avatarIcon(runtime: Runtime, userId: string): Promise<string | null> {
  const avatar = await resolveAvatar(userId).catch(() => null);
  const version =
    avatar?.kind === "file"
      ? mtime(avatar.path)
      : avatar?.kind === "svg"
        ? crypto.createHash("sha256").update(avatar.svg).digest("hex").slice(0, 16)
        : null;
  return version === null ? null : mediaUrl(runtime, "avatar", userId, version);
}

/** Someone here in a chat with people on `peer`: their avatar is that partner's to show too. */
async function inChatWith(userId: string, peerId: string): Promise<boolean> {
  return (
    (await prisma.chat.count({
      where: {
        members: { some: { userId } },
        OR: [{ hostPeerId: peerId }, { remoteMembers: { some: { person: { peerId } } } }],
      },
    })) > 0
  );
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/** A person as published, cut to PERSON_MAX_BYTES should their text grow too much as JSON (escaped characters take
 *  up to six bytes each): their links go first, then their bio is shortened until it fits. */
export function fitPerson<T extends Record<string, unknown>>(doc: T): T {
  if (bytes(doc) <= PERSON_MAX_BYTES) return doc;
  const fitted: Record<string, unknown> = { ...doc, attachment: [] };
  let bio = (doc.source as { content?: string } | undefined)?.content ?? "";
  while (bytes(fitted) > PERSON_MAX_BYTES && bio) {
    bio = bio.slice(0, Math.floor(bio.length / 2));
    fitted.source = markdown(bio);
  }
  return fitted as T;
}

/** Where a page of someone's models goes on from: after the model added at `at` with id `id`, in their order. */
export type ModelsCursor = { at: Date; id: string };
const cursorOf = (print: { createdAt: Date; id: string }) => `${print.createdAt.getTime()}.${print.id}`;

/** A page's `after`, or null for one this didn't make. */
export function parseModelsCursor(value: string): ModelsCursor | null {
  const match = /^(\d{1,15})\.([A-Za-z0-9_-]{1,64})$/.exec(value);
  return match ? { at: new Date(Number(match[1])), id: match[2] } : null;
}

/** A page of what one person shares of their models, the latest added first, from the start or `after` a model; null
 *  for someone who shares none. Pages go on by the last model in them, so each can be as long as fits. */
export async function modelsPage(userId: string, after: ModelsCursor | null = null): Promise<unknown | null> {
  const runtime = await getRuntime();
  const where = await sharedModelsWhere(userId);
  const total = await prisma.print.count({ where });
  if (!total) return null;
  const prints = await prisma.print.findMany({
    where: after
      ? { AND: [where, { OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { gt: after.id } }] }] }
      : where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    // One more than a page: whether there's a next one.
    take: MODELS_PAGE + 1,
    select: {
      id: true,
      userId: true,
      name: true,
      title: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      assetsPath: true,
      plates: { orderBy: { position: "asc" }, select: { id: true, filename: true, mime: true, size: true } },
      previewImages: { orderBy: { position: "asc" }, select: { id: true } },
      files: { select: { id: true, filename: true, mime: true, size: true } },
    },
  });
  const sharedAt = await sharedAtOf(prints);
  const base = `${actorUrl(runtime, userId)}/models`;
  const items = prints.slice(0, MODELS_PAGE).map((print) => {
    const images = print.previewImages.flatMap((image) => {
      const version = mtime(previewImagePath(image.id, print.assetsPath));
      return version === null ? [] : [{ type: "Image", url: mediaUrl(runtime, "image", image.id, version) }];
    });
    // No pictures of its own: its plates' thumbnails instead.
    const pictures = images.length
      ? images
      : print.plates.flatMap((plate) => {
          const version = mtime(plateThumbPath(plate.id, print.assetsPath));
          return version === null ? [] : [{ type: "Image", url: mediaUrl(runtime, "plate", plate.id, version) }];
        });
    return {
      id: `${runtime.origin}${AP_PREFIX}/models/${print.id}`,
      type: "Service",
      "f3di:concreteType": "3DModel",
      name: (print.title?.trim() || print.name).slice(0, MODEL_NAME_MAX),
      attributedTo: actorUrl(runtime, userId),
      source: markdown(print.notes?.slice(0, MODEL_DESCRIPTION_MAX) ?? null),
      image: pictures.slice(0, MODEL_IMAGES_MAX),
      // Each file where a partner fetches it, signed: to download, open in a slicer or copy.
      attachment: [
        ...print.plates.map((file) => ({ kind: "plate", file })),
        ...print.files.map((file) => ({ kind: "file", file })),
      ]
        .slice(0, MODEL_FILES_MAX)
        .map(({ kind, file }) => ({
          type: "Document",
          name: file.filename,
          mediaType: file.mime,
          url: `${runtime.origin}${AP_PREFIX}/files/${kind}/${file.id}/${encodeURIComponent(file.filename)}`,
          "thingport:size": file.size,
        })),
      published: (sharedAt.get(print.id) ?? print.createdAt).toISOString(),
      updated: print.updatedAt.toISOString(),
    };
  });
  // As many as fit, one at least (none is near the size alone, cut as it is).
  const orderedItems: unknown[] = [];
  let size = 4096;
  for (const item of items) {
    size += bytes(item) + 1;
    if (orderedItems.length && size > PAGE_BYTES) break;
    orderedItems.push(item);
  }
  const last = prints[orderedItems.length - 1];
  return {
    "@context": CONTEXT,
    id: after ? `${base}?after=${cursorOf({ createdAt: after.at, id: after.id })}` : base,
    type: "OrderedCollectionPage",
    partOf: base,
    totalItems: total,
    next: prints.length > orderedItems.length ? `${base}?after=${cursorOf(last)}` : undefined,
    orderedItems,
  };
}

const collectionUrl = (runtime: Runtime, id: string) => `${runtime.origin}${AP_PREFIX}/collections/${id}`;

/** A page of a collection's models by their ids, from `offset`, the latest filed first. */
function idsPage(runtime: Runtime, collectionId: string, offset: number, printIds: string[], total: number) {
  const base = `${collectionUrl(runtime, collectionId)}/models`;
  const end = offset + printIds.length;
  return {
    id: `${base}?offset=${offset}`,
    type: "OrderedCollectionPage",
    partOf: base,
    totalItems: total,
    next: end < total ? `${base}?offset=${end}` : undefined,
    orderedItems: printIds.map((id) => `${runtime.origin}${AP_PREFIX}/models/${id}`),
  };
}

/** A page of one person's public collections, the latest changed first, each with its first models by their ids
 *  (`thingport:models`, a collection whose `next` pages through the rest). */
export async function collectionsPage(userId: string, page = 0): Promise<unknown> {
  const runtime = await getRuntime();
  const total = Math.min(await prisma.collection.count({ where: { userId, isPublic: true } }), COLLECTIONS_LIMIT);
  const offset = page * COLLECTIONS_PAGE;
  const take = Math.max(0, Math.min(COLLECTIONS_PAGE, total - offset));
  // The latest changed first, by the same measure as `updated` below: renamed, made public, or something filed in it.
  const ranked = take
    ? await prisma.$queryRaw<{ id: string }[]>`
        SELECT c.id FROM "Collection" c
        LEFT JOIN "CollectionItem" i ON i."collectionId" = c.id
        WHERE c."isPublic" AND c."userId" = ${userId}
        GROUP BY c.id
        ORDER BY GREATEST(c."updatedAt", COALESCE(MAX(i."createdAt"), c."updatedAt")) DESC, c.id
        LIMIT ${take} OFFSET ${offset}`
    : [];
  const order = new Map(ranked.map((row, index) => [row.id, index]));
  const found = await prisma.collection.findMany({
    where: { id: { in: ranked.map((row) => row.id) } },
    select: {
      id: true,
      name: true,
      description: true,
      updatedAt: true,
      _count: { select: { items: true } },
      items: {
        orderBy: [{ createdAt: "desc" }, { printId: "asc" }],
        take: COLLECTION_FIRST_IDS,
        select: { printId: true, createdAt: true },
      },
    },
  });
  const collections = found.toSorted((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const base = `${actorUrl(runtime, userId)}/collections`;
  return {
    "@context": CONTEXT,
    id: page ? `${base}?page=${page}` : base,
    type: "OrderedCollectionPage",
    partOf: base,
    totalItems: total,
    next: offset + take < total ? `${base}?page=${page + 1}` : undefined,
    orderedItems: collections.map((collection) => ({
      id: collectionUrl(runtime, collection.id),
      type: "Group",
      "f3di:concreteType": "Collection",
      name: collection.name.slice(0, COLLECTION_NAME_MAX),
      attributedTo: actorUrl(runtime, userId),
      source: markdown(collection.description?.slice(0, COLLECTION_DESCRIPTION_MAX) ?? null),
      // Changed when it's renamed or something is filed in it.
      updated: new Date(
        Math.max(collection.updatedAt.getTime(), collection.items[0]?.createdAt.getTime() ?? 0),
      ).toISOString(),
      "thingport:models": {
        id: `${collectionUrl(runtime, collection.id)}/models`,
        type: "OrderedCollection",
        totalItems: collection._count.items,
        first: idsPage(
          runtime,
          collection.id,
          0,
          collection.items.map((item) => item.printId),
          collection._count.items,
        ),
      },
    })),
  };
}

/** A page of a public collection's models by their ids, from `offset`; null for a collection that isn't public. */
export async function collectionModelsPage(collectionId: string, offset: number): Promise<unknown | null> {
  const runtime = await getRuntime();
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, isPublic: true },
    select: { id: true, _count: { select: { items: true } } },
  });
  if (!collection) return null;
  const items = await prisma.collectionItem.findMany({
    where: { collectionId },
    orderBy: [{ createdAt: "desc" }, { printId: "asc" }],
    skip: offset,
    take: COLLECTION_IDS_PAGE,
    select: { printId: true },
  });
  const page = idsPage(
    runtime,
    collection.id,
    offset,
    items.map((item) => item.printId),
    collection._count.items,
  );
  return { "@context": CONTEXT, ...page };
}

/** A picture of something shared, for a partner to show its people: a sharer's avatar or uploaded cover, or a shared
 *  model's picture or plate thumbnail. Answers 404 for anything else. */
export async function sendMedia(res: Response, kind: string, id: string, peer?: Peer | null): Promise<void> {
  const send = (file: string, type: string) => {
    res.setHeader("Content-Type", type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.sendFile(path.resolve(file), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: "Not found" });
    });
  };
  const notFound = () => void res.status(404).json({ error: "Not found" });
  const sharesSomething = async (userId: string) => (await sharers()).some((row) => row.userId === userId);

  if (kind === "avatar" || kind === "cover") {
    const chatting = kind === "avatar" && peer ? await inChatWith(id, peer.id) : false;
    if (!chatting && !(await sharesSomething(id))) return notFound();
    if (kind === "avatar") {
      const avatar = await resolveAvatar(id).catch(() => null);
      if (avatar?.kind === "file") return send(avatar.path, "image/webp");
      if (avatar?.kind === "svg") {
        res.setHeader("Content-Type", "image/svg+xml");
        res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.send(avatar.svg);
        return;
      }
      return notFound();
    }
    const user = await prisma.user.findUnique({ where: { id }, select: { backgroundUrl: true } });
    const file = /^\/api\/covers\/([a-f0-9]{32}\.webp)$/.exec(user?.backgroundUrl ?? "")?.[1];
    const coverFile = file ? coverPath(file) : null;
    return coverFile ? send(coverFile, "image/webp") : notFound();
  }
  if (kind === "image") {
    const image = await prisma.previewImage.findUnique({
      where: { id },
      select: { print: { select: { id: true, userId: true, assetsPath: true } } },
    });
    if (!image || !(await isShared(image.print))) return notFound();
    return send(previewImagePath(id, image.print.assetsPath), "image/jpeg");
  }
  if (kind === "plate") {
    const plate = await prisma.plate.findUnique({
      where: { id },
      select: { print: { select: { id: true, userId: true, assetsPath: true } } },
    });
    if (!plate || !(await isShared(plate.print))) return notFound();
    return send(plateThumbPath(id, plate.print.assetsPath), "image/jpeg");
  }
  notFound();
}

async function isShared(print: { id: string; userId: string }): Promise<boolean> {
  return (await prisma.print.count({ where: { id: print.id, AND: [await sharedModelsWhere(print.userId)] } })) > 0;
}

/** A file of a shared model, for a partner's people to download, open or copy: a plate, or one kept beside it. Answers
 *  404 for anything not shared. */
export async function sendSharedFile(res: Response, kind: string, id: string): Promise<void> {
  const notFound = () => void res.status(404).json({ error: "Not found" });
  const found =
    kind === "plate"
      ? await prisma.plate.findUnique({
          where: { id },
          select: {
            filename: true,
            mime: true,
            storagePath: true,
            sourcePath: true,
            print: { select: { id: true, userId: true } },
          },
        })
      : kind === "file"
        ? await prisma.printFile.findUnique({
            where: { id },
            select: { filename: true, mime: true, storagePath: true, print: { select: { id: true, userId: true } } },
          })
        : null;
  if (!found || !(await isShared(found.print))) return notFound();
  const file =
    kind === "plate"
      ? resolvePlateFilePath({
          storagePath: found.storagePath,
          sourcePath: (found as { sourcePath?: string | null }).sourcePath ?? null,
        })
      : managedPrintFilePath(found);
  if (!file || !fs.existsSync(file)) return notFound();
  res.attachment(found.filename);
  res.setHeader("Content-Type", found.mime || "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(path.resolve(file), (err) => {
    if (err && !res.headersSent) notFound();
  });
}
