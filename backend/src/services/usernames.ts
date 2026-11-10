import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";

/** Usernames: what people on connected instances call someone, as username@this-instance. Lower case, 1 to 30 of a-z,
 *  0-9, dots, dashes and underscores, starting and ending with a letter or digit, and unique on the instance. */
export const USERNAME_MAX = 30;
const PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,28}[a-z0-9])?$/;

// Letters NFD doesn't take apart. The rest of the folding is the migration's (20261128120000_usernames) in effect.
const UNSPLIT: Record<string, string> = {
  ł: "l",
  Ł: "L",
  ø: "o",
  Ø: "O",
  đ: "d",
  Đ: "D",
  ß: "s",
  æ: "a",
  Æ: "A",
  œ: "o",
  Œ: "O",
  ı: "i",
};

/** A display name as a username: accents folded to plain letters, anything else a dash, "user" when nothing's left. */
export function usernameFrom(displayName: string): string {
  const folded = displayName
    .replace(/[łŁøØđĐßæÆœŒı]/g, (char) => UNSPLIT[char]!)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  const dashed = folded
    .replace(/[^a-z0-9._-]+/g, "-")
    .slice(0, USERNAME_MAX)
    .replace(/^[-._]+|[-._]+$/g, "");
  return dashed || "user";
}

/** A username someone typed, made lower case, or why it can't be one. */
export function checkUsername(value: string): string {
  const username = value.trim().replace(/^@/, "").toLowerCase();
  if (!PATTERN.test(username)) {
    throw new HttpError(
      400,
      "Use 1 to 30 letters, digits, dots, dashes or underscores, starting and ending with a letter or digit",
      "invalid_username",
    );
  }
  return username;
}

export async function isUsernameFree(username: string, exceptUserId?: string): Promise<boolean> {
  const taken = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  return !taken || taken.id === exceptUserId;
}

/** The first free one of `base`, `base-2`, `base-3` and so on. */
async function pickUsername(displayName: string): Promise<string> {
  const base = usernameFrom(displayName);
  if (await isUsernameFree(base)) return base;
  const stem = base.slice(0, USERNAME_MAX - 6).replace(/[-._]+$/, "") || "user";
  for (let n = 2; n < 100; n++) {
    const candidate = `${stem}-${n}`;
    if (await isUsernameFree(candidate)) return candidate;
  }
  return `${stem}-${Math.random().toString(36).slice(2, 7)}`;
}

const isUniqueClash = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/** Their username, made now if they have none (a new account, or one made before usernames). Two at once may pick the
 *  same name: the loser picks again. */
export async function ensureUsername(userId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true } });
    if (!user) throw new HttpError(404, "No such user", "not_found");
    if (user.username) return user.username;
    const username = await pickUsername(user.displayName);
    try {
      // Only while it's still unset: another request may have just given them one.
      const { count } = await prisma.user.updateMany({ where: { id: userId, username: null }, data: { username } });
      if (count === 1) return username;
    } catch (err) {
      if (!isUniqueClash(err)) throw err;
    }
  }
  throw new HttpError(409, "Couldn't pick a username, try again", "username_taken");
}

/** A username they chose. */
export async function setUsername(userId: string, value: string) {
  const username = checkUsername(value);
  if (!(await isUsernameFree(username, userId))) throw new HttpError(409, "That username is taken", "username_taken");
  try {
    return await prisma.user.update({ where: { id: userId }, data: { username } });
  } catch (err) {
    if (isUniqueClash(err)) throw new HttpError(409, "That username is taken", "username_taken");
    throw err;
  }
}
