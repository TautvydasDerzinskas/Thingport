import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { User } from "@prisma/client";
import { prisma } from "../db";
import { AUTH_SECRET, AVATARS } from "../config";
import { HttpError } from "../utils/fileUtils";
import { avatarWebp } from "./imageProcessing";
import { avatarSvg, isAvatarStyle, randomAvatarStyle, type AvatarStyle } from "./avatarArt";

// A user's avatar, in order: the one they chose -- a picture, or a Thingport avatar they designed -- then their
// Gravatar, then a Thingport avatar picked from their id. Each user has one address for it, /api/avatars/user/<id>, which
// serves whichever applies: the others see a Gravatar without ever being handed the hash of an email.

export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;
const AVATAR_SIZE = 512;
const GRAVATAR_SIZE = 256;
export const AVATAR_FILE = /^[a-f0-9]{32}\.webp$/;
const OWN_AVATAR_URL = /^\/api\/avatars\/([a-f0-9]{32}\.webp)$/;
const GRAVATAR_DIR = path.join(AVATARS, "gravatar");
const DAY_MS = 24 * 60 * 60 * 1000;
// After Gravatar couldn't be reached at all (an instance without internet): asked again this much sooner.
const UNREACHABLE_RETRY_MS = 60 * 60 * 1000;
const GRAVATAR_TIMEOUT_MS = 4000;
// A copy no one has needed refreshing in this long is dropped: a deleted account's, or an address someone left.
const GRAVATAR_EVICT_MS = 30 * DAY_MS;

type AvatarFields = Pick<User, "id" | "email" | "avatarUrl" | "avatarStyle">;
export type AvatarSource = "picture" | "thingport" | "auto";

export type AvatarOut = {
  avatar_url: string;
  /** What shows: a picture, the Thingport avatar they designed, or "auto" -- their Gravatar, or one picked for them. */
  avatar_source: AvatarSource;
  /** The Thingport avatar they designed, if they did: kept while a picture shows instead. */
  avatar_style: AvatarStyle | null;
  /** The one picked for them, shown when they've chosen nothing and have no Gravatar. */
  avatar_picked_style: AvatarStyle;
};

const designOf = (user: Pick<User, "avatarStyle">): AvatarStyle | null =>
  isAvatarStyle(user.avatarStyle) ? user.avatarStyle : null;

/** The user's avatar address. It changes when their avatar does, so a browser may keep it a day; keyed with the
 *  instance's secret, as it's derived from their email and mustn't let anyone check a guess at it. */
export function avatarUrlOf(user: AvatarFields): string {
  const version = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(JSON.stringify([user.email.trim().toLowerCase(), user.avatarUrl, user.avatarStyle]))
    .digest("hex")
    .slice(0, 12);
  return `/api/avatars/user/${user.id}?v=${version}`;
}

export function avatarOut(user: AvatarFields): AvatarOut {
  const design = designOf(user);
  return {
    avatar_url: avatarUrlOf(user),
    avatar_source: user.avatarUrl ? "picture" : design ? "thingport" : "auto",
    avatar_style: design,
    avatar_picked_style: randomAvatarStyle(user.id),
  };
}

export type ResolvedAvatar =
  { kind: "file"; path: string } | { kind: "svg"; svg: string } | { kind: "redirect"; url: string };

const isWebAddress = (value: string) => /^https?:\/\//i.test(value);

/** What a user's avatar address serves. Null for no such user. */
export async function resolveAvatar(userId: string): Promise<ResolvedAvatar | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, avatarUrl: true, avatarStyle: true },
  });
  if (!user) return null;
  if (user.avatarUrl) {
    const own = OWN_AVATAR_URL.exec(user.avatarUrl)?.[1];
    if (own) return { kind: "file", path: path.join(AVATARS, own) };
    if (isWebAddress(user.avatarUrl)) return { kind: "redirect", url: user.avatarUrl };
  }
  const design = designOf(user);
  if (design) return { kind: "svg", svg: avatarSvg(design) };
  const gravatar = await gravatarFile(user.email);
  if (gravatar) return { kind: "file", path: gravatar };
  return { kind: "svg", svg: avatarSvg(randomAvatarStyle(user.id)) };
}

const ageOf = async (file: string): Promise<number | null> => {
  try {
    return Date.now() - (await fs.stat(file)).mtimeMs;
  } catch {
    return null;
  }
};

const gravatarCache = (email: string) => {
  const key = crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  return { key, file: path.join(GRAVATAR_DIR, `${key}.webp`), missing: path.join(GRAVATAR_DIR, `${key}.none`) };
};

// One fetch per address at a time, however many of a person's avatars a page shows at once.
const fetching = new Map<string, Promise<string | null>>();

/** The user's Gravatar as a file of ours, fetched at most once a day; null when they have none, or Gravatar can't be
 *  reached and there's no earlier copy. */
export async function gravatarFile(email: string): Promise<string | null> {
  const { key, file, missing } = gravatarCache(email);
  const fileAge = await ageOf(file);
  if (fileAge !== null && fileAge < DAY_MS) return file;
  const missingAge = await ageOf(missing);
  if (missingAge !== null && missingAge < DAY_MS) return null;
  let pending = fetching.get(key);
  if (!pending) {
    pending = fetchGravatar(key, file, missing).finally(() => fetching.delete(key));
    fetching.set(key, pending);
  }
  return pending;
}

/** Drops cached Gravatars older than GRAVATAR_EVICT_MS. A copy in use is fetched again daily, which renews it. */
export async function sweepGravatarCache(): Promise<void> {
  const names = await fs.readdir(GRAVATAR_DIR).catch(() => [] as string[]);
  for (const name of names) {
    const age = await ageOf(path.join(GRAVATAR_DIR, name));
    if (age !== null && age > GRAVATAR_EVICT_MS) await fs.rm(path.join(GRAVATAR_DIR, name), { force: true });
  }
}
let lastSweep = 0;

async function fetchGravatar(key: string, file: string, missing: string): Promise<string | null> {
  // At most daily, and only on this path, which waits on the network anyway.
  if (Date.now() - lastSweep > DAY_MS) {
    lastSweep = Date.now();
    void sweepGravatarCache();
  }
  try {
    const res = await fetch(`https://gravatar.com/avatar/${key}?s=${GRAVATAR_SIZE}&d=404`, {
      signal: AbortSignal.timeout(GRAVATAR_TIMEOUT_MS),
    });
    if (res.status === 404) {
      await fs.writeFile(missing, "");
      await fs.rm(file, { force: true });
      return null;
    }
    if (!res.ok) throw new Error(`Gravatar answered ${res.status}`);
    await fs.writeFile(file, await avatarWebp(Buffer.from(await res.arrayBuffer()), GRAVATAR_SIZE));
    await fs.rm(missing, { force: true });
    return file;
  } catch {
    // The copy from before, if any, rather than nothing; either way not asked again for an hour, so a page of avatars
    // doesn't wait on a server it can't reach.
    const asIfOlder = new Date(Date.now() - DAY_MS + UNREACHABLE_RETRY_MS);
    if ((await ageOf(file)) !== null) {
      await fs.utimes(file, asIfOlder, asIfOlder);
      return file;
    }
    await fs.writeFile(missing, "");
    await fs.utimes(missing, asIfOlder, asIfOlder);
    return null;
  }
}

/** Where a valid public name's file is; whether it exists is for the caller to find out. */
export function avatarPath(file: string): string | null {
  return AVATAR_FILE.test(file) ? path.join(AVATARS, file) : null;
}

/** Deletes the file behind an avatar the user uploaded; a linked author's picture leaves nothing to delete. */
export async function removeOwnAvatar(url: string | null): Promise<void> {
  const file = url ? OWN_AVATAR_URL.exec(url)?.[1] : undefined;
  if (file) await fs.rm(path.join(AVATARS, file), { force: true });
}

/** Puts up an uploaded picture as the user's avatar, cut square, scaled down and without its metadata. Their design,
 *  if they made one, is kept for when they go back to it. */
export async function saveAvatarUpload(userId: string, buffer: Buffer): Promise<User> {
  if (buffer.length > AVATAR_MAX_BYTES) throw new HttpError(413, "The picture is larger than 10 MB");
  let data: Buffer;
  try {
    data = await avatarWebp(buffer, AVATAR_SIZE);
  } catch {
    throw new HttpError(400, "Not a picture");
  }
  const id = crypto.randomBytes(16).toString("hex");
  const file = path.join(AVATARS, `${id}.webp`);
  await fs.writeFile(file, data);
  let before: { avatarUrl: string | null };
  let user: User;
  try {
    before = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { avatarUrl: true } });
    user = await prisma.user.update({ where: { id: userId }, data: { avatarUrl: `/api/avatars/${id}.webp` } });
  } catch (err) {
    // Nothing points at it, and nothing would ever clear it.
    await fs.rm(file, { force: true });
    throw err;
  }
  await removeOwnAvatar(before.avatarUrl);
  return user;
}

/** The avatar files of a user who's being deleted, their cached Gravatar included; the row goes with the account. */
export async function removeUserAvatar(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true, email: true } });
  if (!user) return;
  await removeOwnAvatar(user.avatarUrl);
  const { file, missing } = gravatarCache(user.email);
  await Promise.all([fs.rm(file, { force: true }), fs.rm(missing, { force: true })]);
}
