import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, type User } from "@prisma/client";
import { prisma } from "../db";
import { COVERS } from "../config";
import { HttpError } from "../utils/fileUtils";
import { coverWebp } from "./imageProcessing";
import type { AvatarStyle } from "./avatarArt";
import { removeOwnAvatar } from "./avatarService";

/** The covers Thingport draws (frontend/src/assets/covers), for whoever hasn't put up a picture of their own. */
export const COVER_PRESETS = ["retro", "pixel", "mosaic", "ascii", "blueprint"] as const;
export type CoverPreset = (typeof COVER_PRESETS)[number];

export const COVER_MAX_BYTES = 10 * 1024 * 1024;
export const BIO_MAX_LENGTH = 1000;
export const PROFILE_LINKS_MAX = 5;
export const PROFILE_LINK_MAX_LENGTH = 500;
// Sharp across a wide screen at twice its density; the strip is never taller than a fifth of its width.
const COVER_MAX_SIZE = 2560;
// The public file name: a random id no one can guess.
export const COVER_FILE = /^[a-f0-9]{32}\.webp$/;
const OWN_COVER_URL = /^\/api\/covers\/([a-f0-9]{32}\.webp)$/;

const isPreset = (value: string | null): value is CoverPreset => COVER_PRESETS.includes(value as CoverPreset);

/** The drawn cover a user gets until they choose one: the same every time, and spread evenly across users. */
export function defaultCoverPreset(userId: string): CoverPreset {
  // FNV-1a
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return COVER_PRESETS[(hash >>> 0) % COVER_PRESETS.length];
}

export type CoverOut = {
  /** A picture: uploaded, or a linked author's. */
  background_url: string | null;
  /** The drawn cover shown when there's no picture; null when there is one. */
  cover_preset: CoverPreset | null;
  /** Where the cover is cropped, 0 (top) to 100 (bottom). */
  cover_position_y: number;
};

export function coverOut(user: Pick<User, "id" | "backgroundUrl" | "coverPreset" | "coverPositionY">): CoverOut {
  return {
    background_url: user.backgroundUrl,
    cover_preset: user.backgroundUrl
      ? null
      : isPreset(user.coverPreset)
        ? user.coverPreset
        : defaultCoverPreset(user.id),
    cover_position_y: user.coverPositionY ?? 50,
  };
}

export type PublicProfileOut = CoverOut & {
  bio: string | null;
  links: string[];
  /** Whether the others can see their own models, as My models lists them, on Explore. */
  models_public: boolean;
};

type ProfileFields =
  "bio" | "profileLinks" | "modelsPublic" | "id" | "backgroundUrl" | "coverPreset" | "coverPositionY";

export function profileOut(user: Pick<User, ProfileFields>): PublicProfileOut {
  return { bio: user.bio, links: user.profileLinks, models_public: user.modelsPublic, ...coverOut(user) };
}

/** Where a valid public name's file is; whether it exists is for the caller to find out. */
export function coverPath(file: string): string | null {
  return COVER_FILE.test(file) ? path.join(COVERS, file) : null;
}

/** Deletes the file behind a cover the user uploaded; a linked author's picture, or none, leaves nothing to delete. */
async function removeOwnCover(url: string | null): Promise<void> {
  const file = url ? OWN_COVER_URL.exec(url)?.[1] : undefined;
  if (file) await fs.rm(path.join(COVERS, file), { force: true });
}

/** Puts up an uploaded picture as the user's cover, scaled down and without its metadata, replacing the last one. */
export async function saveCoverUpload(userId: string, buffer: Buffer, positionY: number): Promise<User> {
  if (buffer.length > COVER_MAX_BYTES) throw new HttpError(413, "The picture is larger than 10 MB");
  let data: Buffer;
  try {
    data = await coverWebp(buffer, COVER_MAX_SIZE);
  } catch {
    throw new HttpError(400, "Not a picture");
  }
  const id = crypto.randomBytes(16).toString("hex");
  const file = path.join(COVERS, `${id}.webp`);
  await fs.writeFile(file, data);
  let before: { backgroundUrl: string | null };
  let user: User;
  try {
    before = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { backgroundUrl: true } });
    user = await prisma.user.update({
      where: { id: userId },
      data: { backgroundUrl: `/api/covers/${id}.webp`, coverPreset: null, coverPositionY: positionY },
    });
  } catch (err) {
    // Nothing points at it, and nothing would ever clear it.
    await fs.rm(file, { force: true });
    throw err;
  }
  await removeOwnCover(before.backgroundUrl);
  return user;
}

export type PublicProfilePatch = {
  bio?: string | null;
  cover_preset?: CoverPreset;
  /** One of the user's linked authors, whose cover picture becomes theirs. */
  cover_author_id?: string;
  cover_position_y?: number;
  /** Web addresses, at most PROFILE_LINKS_MAX; the route checks each is one. */
  links?: string[];
  models_public?: boolean;
  /** A Thingport avatar they designed, shown in place of any picture. */
  avatar_style?: AvatarStyle;
  /** One of the user's linked authors, whose picture becomes their avatar. */
  avatar_author_id?: string;
  /** Back to the automatic avatar: their Gravatar, else one picked for them. */
  avatar_auto?: boolean;
};

/** One of `userId`'s linked authors, or a 404. */
async function linkedAuthor(userId: string, authorId: string) {
  const link = await prisma.authorLink.findFirst({
    where: { userId, authorId },
    select: { author: { select: { backgroundUrl: true, avatarUrl: true } } },
  });
  if (!link) throw new HttpError(404, "That author isn't linked to your account");
  return link.author;
}

/** What the other users see of them: avatar, bio, cover, links, and whether their models show. A cover chosen here replaces an
 *  uploaded one, deleting it. */
export async function updatePublicProfile(userId: string, patch: PublicProfilePatch): Promise<User> {
  const data: Prisma.UserUpdateInput = {};
  if (patch.bio !== undefined) data.bio = patch.bio?.trim() || null;
  if (patch.cover_preset) {
    data.coverPreset = patch.cover_preset;
    data.backgroundUrl = null;
  }
  if (patch.cover_author_id) {
    const author = await linkedAuthor(userId, patch.cover_author_id);
    if (!author.backgroundUrl) throw new HttpError(400, "That author has no cover picture");
    data.backgroundUrl = author.backgroundUrl;
    data.coverPreset = null;
  }
  if (patch.avatar_style) {
    data.avatarStyle = patch.avatar_style;
    data.avatarUrl = null;
  }
  // A picture goes over their design, which stays for when they go back to it.
  if (patch.avatar_author_id) {
    const author = await linkedAuthor(userId, patch.avatar_author_id);
    if (!author.avatarUrl) throw new HttpError(400, "That author has no picture");
    data.avatarUrl = author.avatarUrl;
  }
  if (patch.avatar_auto) {
    data.avatarUrl = null;
    data.avatarStyle = Prisma.DbNull;
  }
  if (patch.cover_position_y !== undefined) data.coverPositionY = patch.cover_position_y;
  if (patch.links !== undefined) data.profileLinks = [...new Set(patch.links)];

  const before = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { backgroundUrl: true, avatarUrl: true, modelsPublic: true },
  });
  if (patch.models_public !== undefined) {
    data.modelsPublic = patch.models_public;
    if (!patch.models_public) data.modelsPublicAt = null;
    else if (!before.modelsPublic) data.modelsPublicAt = new Date();
  }
  const user = await prisma.user.update({ where: { id: userId }, data });
  if (before.backgroundUrl !== user.backgroundUrl) await removeOwnCover(before.backgroundUrl);
  if (before.avatarUrl !== user.avatarUrl) await removeOwnAvatar(before.avatarUrl);
  return user;
}

/** The cover file of a user who's being deleted; the row goes with the account. */
export async function removeUserCover(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { backgroundUrl: true } });
  await removeOwnCover(user?.backgroundUrl ?? null);
}
