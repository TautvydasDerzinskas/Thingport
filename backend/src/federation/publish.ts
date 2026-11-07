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
import { sharedAtOf, sharedModelsWhere, sharers } from "../services/socialService";
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
export const MODELS_PAGE = 50;
const DIRECTORY_LIMIT = 500;
const COLLECTIONS_LIMIT = 200;

// A partner's key, kept for a while: every page a partner reads would otherwise fetch its actor again.
const keys = new Map<string, { key: unknown; at: number }>();
const KEY_TTL_MS = 10 * 60 * 1000;
const keyCache = {
  async get(keyId: URL) {
    const hit = keys.get(keyId.href);
    return hit && Date.now() - hit.at < KEY_TTL_MS ? (hit.key as never) : undefined;
  },
  async set(keyId: URL, key: unknown) {
    if (key) keys.set(keyId.href, { key, at: Date.now() });
    else keys.delete(keyId.href);
  },
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
      keyCache: keyCache as never,
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

/** Everyone here who shares something, newest sharer first, each a Person with what they share counted. */
export async function directory(): Promise<unknown> {
  const runtime = await getRuntime();
  const shared = (await sharers()).slice(0, DIRECTORY_LIMIT);
  const userIds = shared.map((row) => row.userId);
  const [users, collections, models] = await Promise.all([
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
    Promise.all(
      userIds.map(async (userId) => [userId, await prisma.print.count({ where: await sharedModelsWhere(userId) })]),
    ),
  ]);
  const byId = new Map(users.map((user) => [user.id, user]));
  const collectionCount = new Map(collections.map((row) => [row.userId, row._count]));
  const modelCount = new Map(models as [string, number][]);
  const items = await Promise.all(
    shared.map(async ({ userId, at }) => {
      const user = byId.get(userId);
      if (!user) return null;
      const id = actorUrl(runtime, userId);
      const cover = coverOut(user);
      const ownCover = /^\/api\/covers\/([a-f0-9]{32}\.webp)$/.exec(cover.background_url ?? "")?.[1];
      const coverFile = ownCover ? coverPath(ownCover) : null;
      const avatar = await resolveAvatar(userId).catch(() => null);
      const avatarVersion = avatar?.kind === "file" ? mtime(avatar.path) : avatar?.kind === "svg" ? "svg" : null;
      return {
        id,
        type: "Person",
        "f3di:concreteType": "User",
        preferredUsername: user.username ?? undefined,
        name: user.displayName,
        source: markdown(user.bio),
        attachment: user.profileLinks.map((href) => ({ type: "Link", href })),
        icon:
          avatarVersion !== null
            ? { type: "Image", url: mediaUrl(runtime, "avatar", userId, avatarVersion) }
            : undefined,
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
  const orderedItems = items.filter(Boolean);
  return {
    "@context": CONTEXT,
    id: `${runtime.origin}${AP_PREFIX}/directory`,
    type: "OrderedCollection",
    totalItems: orderedItems.length,
    orderedItems,
  };
}

/** A page of what one person shares of their models, the latest shared first; null for someone who shares none. */
export async function modelsPage(userId: string, page: number): Promise<unknown | null> {
  const runtime = await getRuntime();
  const where = await sharedModelsWhere(userId);
  const total = await prisma.print.count({ where });
  if (!total) return null;
  const prints = await prisma.print.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    skip: page * MODELS_PAGE,
    take: MODELS_PAGE,
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
  const orderedItems = prints.map((print) => {
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
      name: print.title?.trim() || print.name,
      attributedTo: actorUrl(runtime, userId),
      source: markdown(print.notes),
      image: pictures,
      // Each file where a partner fetches it, signed: to download, open in a slicer or copy.
      attachment: [
        ...print.plates.map((file) => ({ kind: "plate", file })),
        ...print.files.map((file) => ({ kind: "file", file })),
      ].map(({ kind, file }) => ({
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
  return {
    "@context": CONTEXT,
    id: `${base}?page=${page}`,
    type: "OrderedCollectionPage",
    partOf: base,
    totalItems: total,
    next: (page + 1) * MODELS_PAGE < total ? `${base}?page=${page + 1}` : undefined,
    orderedItems,
  };
}

/** One person's public collections, each with the models in it by their ids. */
export async function collectionsOf(userId: string): Promise<unknown> {
  const runtime = await getRuntime();
  const collections = await prisma.collection.findMany({
    where: { userId, isPublic: true },
    orderBy: { updatedAt: "desc" },
    take: COLLECTIONS_LIMIT,
    select: {
      id: true,
      name: true,
      description: true,
      updatedAt: true,
      items: { orderBy: { createdAt: "desc" }, select: { printId: true, createdAt: true } },
    },
  });
  return {
    "@context": CONTEXT,
    id: `${actorUrl(runtime, userId)}/collections`,
    type: "OrderedCollection",
    totalItems: collections.length,
    orderedItems: collections.map((collection) => ({
      id: `${runtime.origin}${AP_PREFIX}/collections/${collection.id}`,
      type: "Group",
      "f3di:concreteType": "Collection",
      name: collection.name,
      attributedTo: actorUrl(runtime, userId),
      source: markdown(collection.description),
      // Changed when it's renamed or something is filed in it.
      updated: new Date(
        Math.max(collection.updatedAt.getTime(), collection.items[0]?.createdAt.getTime() ?? 0),
      ).toISOString(),
      "thingport:models": collection.items.map((item) => `${runtime.origin}${AP_PREFIX}/models/${item.printId}`),
    })),
  };
}

/** A picture of something shared, for a partner to show its people: a sharer's avatar or uploaded cover, or a shared
 *  model's picture or plate thumbnail. Answers 404 for anything else. */
export async function sendMedia(res: Response, kind: string, id: string): Promise<void> {
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
    if (!(await sharesSomething(id))) return notFound();
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
