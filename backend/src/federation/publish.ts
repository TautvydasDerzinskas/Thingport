import { storedLicense } from "../services/licenseService";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Peer, Prisma } from "@prisma/client";
import type { Request as ExpressRequest, Response } from "express";
import { prisma } from "../db";
import { resolveAvatar } from "../services/avatarService";
import { categoryRefs, type CategoryRef } from "../services/categoryService";
import { descriptionImagePath } from "../services/descriptionImageService";
import { previewImagePath } from "../services/previewImageService";
import { resolvePlateFilePath } from "../services/printCreation";
import { managedPrintFilePath } from "../services/printFileService";
import { storedProfile } from "../services/printProfileService";
import { plateThumbPath } from "../services/printService";
import { coverOut, coverPath } from "../services/publicProfileService";
import { sharedAtOf, sharedModelCounts, sharedModelsWhere, sharers } from "../services/socialService";
import { FOLDER_MAX, folderLevels, folderPath } from "../utils/fileFolder";
import { originOf } from "./addresses";
import { canonicalHeaders, keyIdOf } from "./edge";
import { AP_PREFIX, getRuntime, type Runtime } from "./runtime";

/** What this instance's people share, as partners read it: the people (a directory), each one's models and public
 *  collections, and their pictures. Only an ACTIVE partner's signed request is answered, and it gets what a signed-in
 *  person here sees of the others, nothing more. People are `Person`s; models and collections are Thingport's own
 *  `thingport:Model` and `thingport:Collection`, and whatever else Thingport says is under `thingport:` too. */

export const CONTEXT = [
  "https://www.w3.org/ns/activitystreams",
  { thingport: "https://github.com/TautvydasDerzinskas/Thingport#" },
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
const FILE_NAME_MAX = 255;
const FILE_PATH_MAX = FOLDER_MAX + 1 + FILE_NAME_MAX;
const MEDIA_TYPE_MAX = 120;
const MODEL_IMAGES_MAX = 20;
const MODEL_TAGS_MAX = 50;
const TAG_MAX = 100;
const LICENSE_TEXT_MAX = 500;
const LICENSE_TERMS_MAX = 20_000;
const MODEL_DESCRIPTION_IMAGES_MAX = 50;
const CATEGORY_PATH_MAX = 100;
const CATEGORY_NAME_MAX = 200;
const CATEGORY_SITE_IDS_MAX = 200;
// Of one model, so a page holds a few at least whatever their print profiles say.
export const MODEL_MAX_BYTES = 256 * 1024;
const COLLECTION_NAME_MAX = 200;
const COLLECTION_DESCRIPTION_MAX = 5000;
const DIRECTORY_LIMIT = 500;
const COLLECTIONS_LIMIT = 200;
// Collections a page, each fitted to COLLECTION_MAX_BYTES (fitCollection), so 12 always fit a page.
export const COLLECTIONS_PAGE = 12;
export const COLLECTION_MAX_BYTES = Math.floor((PAGE_BYTES - 16 * 1024) / COLLECTIONS_PAGE);
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

const actorUrl = (runtime: Pick<Runtime, "origin">, userId: string) => `${runtime.origin}${AP_PREFIX}/actors/${userId}`;
const mediaUrl = (runtime: Pick<Runtime, "origin">, kind: string, id: string, version?: number | string) =>
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
    prisma.collection.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, visibility: "PUBLIC" },
      _count: true,
    }),
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
export async function avatarIcon(runtime: Pick<Runtime, "origin">, userId: string): Promise<string | null> {
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

const MODEL_SELECT = {
  id: true,
  userId: true,
  name: true,
  title: true,
  notes: true,
  tags: true,
  creator: true,
  sourceProvider: true,
  sourceExternalId: true,
  unfillableGaps: true,
  generatorScriptWithheld: true,
  categoryId: true,
  createdAt: true,
  updatedAt: true,
  assetsPath: true,
  author: { select: { provider: true, externalId: true } },
  plates: {
    orderBy: { position: "asc" },
    select: {
      id: true,
      filename: true,
      folder: true,
      mime: true,
      size: true,
      sourceInstanceId: true,
      profile: true,
      thumbGenerated: true,
    },
  },
  previewImages: { orderBy: { position: "asc" }, select: { id: true, generated: true } },
  // A partner's copy writes its own LICENSE.txt from the licence.
  files: {
    where: { role: { not: "LICENSE" } },
    select: { id: true, filename: true, folder: true, mime: true, size: true, role: true },
  },
  descriptionImages: { select: { id: true, mime: true } },
  license: true,
  licenseReadAt: true,
} satisfies Prisma.PrintSelect;
type PublishedPrint = Prisma.PrintGetPayload<{ select: typeof MODEL_SELECT }>;

/** One shared model as partners read it. Past what Explore shows, it carries what a copy needs to be the same model
 *  (remoteCopy.ts): its tags, creator, source, starter category, print profiles, files' roles and pictures, each a
 *  `thingport:` term an older partner reads past. */
function modelDoc(
  runtime: Runtime,
  userId: string,
  print: PublishedPrint,
  sharedAt: Map<string, Date>,
  refs: Map<string, CategoryRef>,
) {
  const images = print.previewImages.flatMap((image) => {
    const version = mtime(previewImagePath(image.id, print.assetsPath));
    return version === null
      ? []
      : [
          {
            type: "Image",
            url: mediaUrl(runtime, "image", image.id, version),
            "thingport:generated": image.generated || undefined,
          },
        ];
  });
  const thumbOf = (plate: PublishedPrint["plates"][number]) => {
    const version = mtime(plateThumbPath(plate.id, print.assetsPath));
    return version === null ? null : mediaUrl(runtime, "plate", plate.id, version);
  };
  // No pictures of its own: its plates' thumbnails instead, which a copy has with its plates.
  const pictures = images.length
    ? images
    : print.plates.flatMap((plate) => {
        const url = thumbOf(plate);
        return url
          ? [{ type: "Image", url, "thingport:plate": true, "thingport:generated": plate.thumbGenerated || undefined }]
          : [];
      });
  const notes = print.notes?.slice(0, MODEL_DESCRIPTION_MAX) ?? null;
  const descriptionImages = print.descriptionImages
    .filter((image) => notes?.includes(`/description-image/${image.id}`))
    .slice(0, MODEL_DESCRIPTION_IMAGES_MAX)
    .flatMap((image) => {
      const version = mtime(descriptionImagePath(image, print.assetsPath));
      return version === null ? [] : [{ id: image.id, url: mediaUrl(runtime, "description", image.id, version) }];
    });
  const nameOf = partnerNames([...print.plates, ...print.files]);
  const document = (
    kind: "plate" | "file",
    file: { id: string; filename: string; folder: string | null; mime: string; size: number },
  ) => {
    // The address's name is only a slicer's.
    const name = shortName(nameOf(file), FILE_NAME_MAX);
    return {
      type: "Document",
      name,
      mediaType: file.mime.slice(0, MEDIA_TYPE_MAX),
      url: `${runtime.origin}${AP_PREFIX}/files/${kind}/${file.id}/${encodeURIComponent(name)}`,
      "thingport:size": file.size,
      "thingport:kind": kind,
      // Where it is in the model, for a partner that keeps folders; `name` is for one that doesn't.
      "thingport:path": file.folder ? shortName(folderPath(file.folder, file.filename), FILE_PATH_MAX) : undefined,
    };
  };
  // Each file where a partner fetches it, signed: to download, open in a slicer or copy.
  const attachment = [
    ...print.plates.map((plate) => {
      const provider = storedProfile(plate.profile)?.provider;
      return {
        ...document("plate", plate),
        "thingport:profileId": plate.sourceInstanceId ?? undefined,
        // What its site said of the print profile, so a copy shows it without asking the site again.
        "thingport:profile": provider
          ? { version: storedProfile(plate.profile)?.providerVersion ?? 0, facts: provider }
          : undefined,
        // A render is marked: a copy makes its own where its instance renders.
        "thingport:thumb": thumbOf(plate) ?? undefined,
        "thingport:thumbGenerated": plate.thumbGenerated || undefined,
      };
    }),
    ...print.files.map((file) => ({ ...document("file", file), "thingport:role": file.role })),
  ].slice(0, MODEL_FILES_MAX);
  const ref = print.categoryId ? refs.get(print.categoryId) : undefined;
  // Only one a partner keeps: names of any length and depth are allowed here, not there.
  const category =
    ref &&
    ref.path.length <= CATEGORY_PATH_MAX &&
    ref.path.every((name) => name.trim() && name.trim().length <= CATEGORY_NAME_MAX)
      ? { path: ref.path, siteIds: ref.siteIds.slice(0, CATEGORY_SITE_IDS_MAX) }
      : undefined;
  return fitModel({
    id: `${runtime.origin}${AP_PREFIX}/models/${print.id}`,
    type: "thingport:Model",
    name: (print.title?.trim() || print.name).slice(0, MODEL_NAME_MAX),
    attributedTo: actorUrl(runtime, userId),
    source: markdown(notes),
    image: pictures.slice(0, MODEL_IMAGES_MAX),
    attachment,
    published: (sharedAt.get(print.id) ?? print.createdAt).toISOString(),
    updated: print.updatedAt.toISOString(),
    "thingport:tags": print.tags.length
      ? print.tags.slice(0, MODEL_TAGS_MAX).map((tag) => tag.slice(0, TAG_MAX))
      : undefined,
    "thingport:creator": print.creator?.trim().slice(0, NAME_MAX) || undefined,
    "thingport:importedFrom":
      print.sourceProvider && print.sourceExternalId
        ? { provider: print.sourceProvider, externalId: print.sourceExternalId }
        : undefined,
    "thingport:author": print.author ?? undefined,
    "thingport:category": category,
    "thingport:generatorScriptWithheld": print.generatorScriptWithheld || undefined,
    "thingport:license": licenseTerm(print),
    "thingport:unfillableGaps": print.unfillableGaps.length ? print.unfillableGaps : undefined,
    "thingport:descriptionImages": descriptionImages.length ? descriptionImages : undefined,
  });
}

/** The model's licence as partners keep it: what its source listed or its owner picked. */
function licenseTerm(print: Pick<PublishedPrint, "license" | "licenseReadAt" | "sourceProvider">) {
  const license = storedLicense(print.license);
  // Read from its site, which stated none: said too, so a copy doesn't read it again and its page says "not stated".
  if (!license) return print.licenseReadAt && print.sourceProvider ? { none: true as const } : undefined;
  return {
    id: license.id ?? undefined,
    raw: license.raw.slice(0, LICENSE_TEXT_MAX),
    label: license.label?.slice(0, LICENSE_TEXT_MAX) || undefined,
    url: license.url?.slice(0, LICENSE_TEXT_MAX) || undefined,
    terms: license.terms?.slice(0, LICENSE_TERMS_MAX) || undefined,
    allows: license.allows,
    requires: license.requires,
    source: license.source,
    provider: license.provider ?? undefined,
  };
}

/** `name` no longer than `max`, cut before its extension (`.gcode.3mf` whole), which says what the file is, and with
 *  no half of a character left at the cut, which encodeURIComponent refuses. */
/** Each file's name for a partner too old to know folders, which shows a model's files as one list: its own, unless
 *  another file has it too, when it's named after its folder as well ("Supported - Arm.stl"), as a zip's files were
 *  named before folders were kept. */
function partnerNames(files: { id: string; filename: string; folder: string | null }[]) {
  const count = new Map<string, number>();
  for (const file of files) count.set(file.filename.toLowerCase(), (count.get(file.filename.toLowerCase()) ?? 0) + 1);
  return (file: { filename: string; folder: string | null }) =>
    file.folder && (count.get(file.filename.toLowerCase()) ?? 0) > 1
      ? [...folderLevels(file.folder), file.filename].join(" - ")
      : file.filename;
}

function shortName(name: string, max: number): string {
  if (name.length <= max) return name;
  const extension = /(?:\.[A-Za-z0-9]{1,10}){1,2}$/.exec(name)?.[0] ?? "";
  return name.slice(0, max - extension.length).replace(/[\uD800-\uDBFF]$/, "") + extension;
}

/** A model as published, held to MODEL_MAX_BYTES should what a copy needs make it too big: its print profiles' facts
 *  go first (a copy asks their site instead), then its category, description's images and plates' pictures (a copy
 *  goes without), then the names in its files' addresses (a partner reads `name`), and last its description is
 *  shortened. Past that, only text escaping as far as JSON can (six bytes a character), which a page still holds. */
export function fitModel<T extends { attachment: Record<string, unknown>[] }>(doc: T): T {
  if (bytes(doc) <= MODEL_MAX_BYTES) return doc;
  const without = (terms: string[]) => (value: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(value).filter(([key]) => !terms.includes(key)));
  const lean = { ...doc, attachment: doc.attachment.map(without(["thingport:profile"])) };
  if (bytes(lean) <= MODEL_MAX_BYTES) return lean;
  const fitted: Record<string, unknown> & { attachment: Record<string, unknown>[] } = {
    ...without(["thingport:category", "thingport:descriptionImages"])(lean),
    attachment: lean.attachment.map(without(["thingport:thumb", "thingport:thumbGenerated"])),
  };
  if (bytes(fitted) > MODEL_MAX_BYTES) fitted.attachment = fitted.attachment.map(unnamed);
  let text = (fitted.source as { content?: string } | undefined)?.content ?? "";
  while (bytes(fitted) > MODEL_MAX_BYTES && text) {
    text = text.slice(0, Math.floor(text.length / 2));
    fitted.source = markdown(text);
  }
  return fitted as T;
}

/** A file's address without the name at its end (`/files/<kind>/<id>`), which serves it all the same. */
function unnamed(file: Record<string, unknown>): Record<string, unknown> {
  const tail = typeof file.name === "string" ? `/${encodeURIComponent(file.name)}` : null;
  return tail && typeof file.url === "string" && file.url.endsWith(tail)
    ? { ...file, url: file.url.slice(0, -tail.length) }
    : file;
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
  return modelsPageOf(runtime, userId, await sharedModelsWhere(userId), `${actorUrl(runtime, userId)}/models`, after);
}

/** A page of `userId`'s models matching `where`, at `base`: the latest first, as many as fit a page. Null for none. */
async function modelsPageOf(
  runtime: Runtime,
  userId: string,
  where: Prisma.PrintWhereInput,
  base: string,
  after: ModelsCursor | null,
): Promise<unknown | null> {
  const total = await prisma.print.count({ where });
  if (!total) return null;
  const prints = await prisma.print.findMany({
    where: after
      ? { AND: [where, { OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { gt: after.id } }] }] }
      : where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    // One more than a page: whether there's a next one.
    take: MODELS_PAGE + 1,
    select: MODEL_SELECT,
  });
  const [sharedAt, refs] = await Promise.all([
    sharedAtOf(prints),
    categoryRefs(
      userId,
      prints.map((print) => print.categoryId),
      CATEGORY_PATH_MAX,
    ),
  ]);
  const items = prints.slice(0, MODELS_PAGE).map((print) => modelDoc(runtime, userId, print, sharedAt, refs));
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

const collectionUrl = (runtime: Pick<Runtime, "origin">, id: string) =>
  `${runtime.origin}${AP_PREFIX}/collections/${id}`;

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
  const total = Math.min(await prisma.collection.count({ where: { userId, visibility: "PUBLIC" } }), COLLECTIONS_LIMIT);
  const offset = page * COLLECTIONS_PAGE;
  const take = Math.max(0, Math.min(COLLECTIONS_PAGE, total - offset));
  // The latest changed first, by the same measure as `updated` below: renamed, made public, or something filed in it.
  const ranked = take
    ? await prisma.$queryRaw<{ id: string }[]>`
        SELECT c.id FROM "Collection" c
        LEFT JOIN "CollectionItem" i ON i."collectionId" = c.id
        WHERE c."visibility" = 'PUBLIC' AND c."userId" = ${userId}
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
    orderedItems: collections.map((collection) =>
      fitCollection(
        (description, printIds) => ({
          id: collectionUrl(runtime, collection.id),
          type: "thingport:Collection",
          name: collection.name.slice(0, COLLECTION_NAME_MAX),
          attributedTo: actorUrl(runtime, userId),
          source: markdown(description),
          // Changed when it's renamed or something is filed in it.
          updated: new Date(
            Math.max(collection.updatedAt.getTime(), collection.items[0]?.createdAt.getTime() ?? 0),
          ).toISOString(),
          "thingport:models": {
            id: `${collectionUrl(runtime, collection.id)}/models`,
            type: "OrderedCollection",
            totalItems: collection._count.items,
            first: idsPage(runtime, collection.id, 0, printIds, collection._count.items),
          },
        }),
        collection.description?.slice(0, COLLECTION_DESCRIPTION_MAX) ?? null,
        collection.items.map((item) => item.printId),
      ),
    ),
  };
}

/** A collection as published, made with `make`, within COLLECTION_MAX_BYTES however long its ids and however its text
 *  escapes: its description shortened first, then fewer of its models given with it, the rest on its own pages. */
export function fitCollection<T>(
  make: (description: string | null, printIds: string[]) => T,
  description: string | null,
  printIds: string[],
): T {
  let text = description;
  let ids = printIds;
  let item = make(text, ids);
  while (bytes(item) > COLLECTION_MAX_BYTES && text) {
    text = text.slice(0, Math.floor(text.length / 2)) || null;
    item = make(text, ids);
  }
  while (bytes(item) > COLLECTION_MAX_BYTES && ids.length) {
    ids = ids.slice(0, Math.floor(ids.length / 2));
    item = make(text, ids);
  }
  return item;
}

/** A page of a public collection's models by their ids, from `offset`; null for a collection that isn't public. */
export async function collectionModelsPage(collectionId: string, offset: number): Promise<unknown | null> {
  const runtime = await getRuntime();
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, visibility: "PUBLIC" },
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

// ---------------------------------------------------------------------------------------------------------------------
// Collections shared with partners' people (federation/sharedCollections.ts): only the partner they're on reads one,
// and only while it's shared with someone there.

/** Who on `peerId` a collection is shared with, by their actors there (nobody elsewhere), and what it is: what each
 *  change to it tells that partner (`queueSharing`). Null unless it's shared (SHARED) with someone there. */
export async function sharedAudience(
  collectionId: string,
  peerId: string,
  db: Pick<typeof prisma, "collection" | "collectionShare"> = prisma,
) {
  const collection = await db.collection.findFirst({
    where: { id: collectionId, visibility: "SHARED" },
    select: { id: true, name: true, description: true, updatedAt: true, userId: true },
  });
  if (!collection) return null;
  const shares = await db.collectionShare.findMany({
    where: { collectionId, remotePerson: { peerId } },
    orderBy: { createdAt: "asc" },
    select: { remotePerson: { select: { apId: true } } },
  });
  const to = shares.flatMap((share) => (share.remotePerson ? [share.remotePerson.apId] : []));
  return to.length ? { collection, to } : null;
}

/** A collection its owner shared with people on `peerId`, as that partner reads it: its name, its owner, who on that
 *  partner it's shared with (`to`, nobody elsewhere) and where its models are (`thingport:items`). Null unless it's
 *  shared (SHARED) with someone there. */
export async function sharedCollectionObject(
  at: Pick<Runtime, "origin">,
  collectionId: string,
  peerId: string,
): Promise<Record<string, unknown> | null> {
  const audience = await sharedAudience(collectionId, peerId);
  if (!audience) return null;
  const { collection, to } = audience;
  const owner = await prisma.user.findUnique({
    where: { id: collection.userId },
    select: { displayName: true, username: true },
  });
  const icon = await avatarIcon(at, collection.userId);
  const url = collectionUrl(at, collection.id);
  return {
    id: url,
    type: "thingport:Collection",
    name: collection.name.slice(0, COLLECTION_NAME_MAX),
    attributedTo: {
      id: actorUrl(at, collection.userId),
      type: "Person",
      name: owner?.displayName.slice(0, NAME_MAX) ?? "Someone",
      preferredUsername: owner?.username ?? undefined,
      icon: icon ? { type: "Image", url: icon } : undefined,
    },
    source: markdown(collection.description?.slice(0, COLLECTION_DESCRIPTION_MAX) ?? null),
    updated: collection.updatedAt.toISOString(),
    to,
    "thingport:items": `${url}/items`,
  };
}

// A page of the collections shared with people on a partner.
const SHARED_PAGE = 500;

/** The addresses of the collections shared with someone on `peer`, a page at a time after `after` (an id), for that
 *  partner to read each: how it finds one whose Update it never took (its social features were off longer than
 *  delivery kept trying, say). */
export async function collectionsSharedWith(peer: Peer, after: string | null = null): Promise<unknown> {
  const runtime = await getRuntime();
  const rows = await prisma.collection.findMany({
    where: {
      visibility: "SHARED",
      shares: { some: { remotePerson: { peerId: peer.id } } },
      ...(after ? { id: { gt: after } } : {}),
    },
    orderBy: { id: "asc" },
    take: SHARED_PAGE + 1,
    select: { id: true },
  });
  const page = rows.slice(0, SHARED_PAGE);
  const base = `${runtime.origin}${AP_PREFIX}/shared`;
  return {
    "@context": CONTEXT,
    id: after ? `${base}?after=${after}` : base,
    type: "OrderedCollectionPage",
    orderedItems: page.map((row) => collectionUrl(runtime, row.id)),
    next: rows.length > SHARED_PAGE ? `${base}?after=${page.at(-1)!.id}` : undefined,
  };
}

/** The document at a shared collection's address, for the partner it's shared with people on; null otherwise. */
export async function sharedCollectionDoc(collectionId: string, peer: Peer): Promise<unknown | null> {
  const object = await sharedCollectionObject(await getRuntime(), collectionId, peer.id);
  return object && { "@context": CONTEXT, ...object };
}

/** A page of a shared collection's models, whole, as a person's models page has them: for the partner it's shared with
 *  people on; null otherwise, and for one with none. */
export async function sharedCollectionItems(
  collectionId: string,
  peer: Peer,
  after: ModelsCursor | null,
): Promise<unknown | null> {
  const runtime = await getRuntime();
  const audience = await sharedAudience(collectionId, peer.id);
  if (!audience) return null;
  const { collection } = audience;
  return modelsPageOf(
    runtime,
    collection.userId,
    { userId: collection.userId, collectionItems: { some: { collectionId } } },
    `${collectionUrl(runtime, collectionId)}/items`,
    after,
  );
}

/** Someone here by their username, for a partner whose person types their handle to share a collection with them:
 *  their name, and their avatar where that partner may fetch it (avatarShownTo), nothing more. Null for no one of that
 *  name. */
export async function personNamed(username: string, peer: Peer): Promise<unknown | null> {
  const user = await prisma.user.findUnique({
    where: { username: username.toLowerCase() },
    select: { id: true, displayName: true, username: true },
  });
  if (!user) return null;
  const runtime = await getRuntime();
  const icon = (await avatarShownTo(user.id, peer)) ? await avatarIcon(runtime, user.id) : null;
  return {
    "@context": CONTEXT,
    id: actorUrl(runtime, user.id),
    type: "Person",
    name: user.displayName.slice(0, NAME_MAX),
    preferredUsername: user.username ?? undefined,
    icon: icon ? { type: "Image", url: icon } : undefined,
  };
}

const sharesSomething = async (userId: string) => (await sharers()).some((row) => row.userId === userId);

/** Whether `peer` may fetch someone's avatar: they share something on Explore, or are in a chat with its people, or
 *  share a collection with them or have one shared by them. */
async function avatarShownTo(userId: string, peer: Peer | null): Promise<boolean> {
  if (peer && ((await inChatWith(userId, peer.id)) || (await sharingWith(userId, peer.id)))) return true;
  return sharesSomething(userId);
}

/** Someone here who shared a collection with people on `peerId`, or whom someone there shared one with: their avatar
 *  is that partner's to show beside it. */
async function sharingWith(userId: string, peerId: string): Promise<boolean> {
  const [shares, viewing] = await Promise.all([
    prisma.collection.count({
      where: { userId, visibility: "SHARED", shares: { some: { remotePerson: { peerId } } } },
    }),
    prisma.remoteCollectionViewer.count({ where: { userId, collection: { peerId, limited: true } } }),
  ]);
  return shares + viewing > 0;
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
  if (kind === "avatar" || kind === "cover") {
    const shown = kind === "avatar" ? await avatarShownTo(id, peer ?? null) : await sharesSomething(id);
    if (!shown) return notFound();
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
    if (!image || !(await isShared(image.print, peer))) return notFound();
    return send(previewImagePath(id, image.print.assetsPath), "image/jpeg");
  }
  if (kind === "plate") {
    const plate = await prisma.plate.findUnique({
      where: { id },
      select: { print: { select: { id: true, userId: true, assetsPath: true } } },
    });
    if (!plate || !(await isShared(plate.print, peer))) return notFound();
    return send(plateThumbPath(id, plate.print.assetsPath), "image/jpeg");
  }
  if (kind === "description") {
    const image = await prisma.descriptionImage.findUnique({
      where: { id },
      select: { id: true, mime: true, print: { select: { id: true, userId: true, assetsPath: true } } },
    });
    if (!image || !(await isShared(image.print, peer))) return notFound();
    if (image.mime === "image/svg+xml") {
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    }
    return send(descriptionImagePath(image, image.print.assetsPath), image.mime);
  }
  notFound();
}

/** A model of this instance's that `peer`'s people may have: shared on Explore, or in a collection shared with someone
 *  on that partner. */
async function isShared(print: { id: string; userId: string }, peer?: Peer | null): Promise<boolean> {
  const sharedThere: Prisma.PrintWhereInput[] = peer
    ? [
        {
          collectionItems: {
            some: { collection: { visibility: "SHARED", shares: { some: { remotePerson: { peerId: peer.id } } } } },
          },
        },
      ]
    : [];
  const where: Prisma.PrintWhereInput = { id: print.id, OR: [await sharedModelsWhere(print.userId), ...sharedThere] };
  return (await prisma.print.count({ where })) > 0;
}

/** A file of a shared model, for a partner's people to download, open or copy: a plate, or one kept beside it. Answers
 *  404 for anything not shared. */
export async function sendSharedFile(res: Response, kind: string, id: string, peer?: Peer | null): Promise<void> {
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
  if (!found || !(await isShared(found.print, peer))) return notFound();
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
