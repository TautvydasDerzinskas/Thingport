import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import type { ImportedAuthorInfo } from "./importResolvers";
import type { Author, User } from "@prisma/client";

export function buildAuthorId(provider: string, externalId: string): string {
  return `${provider}:${externalId}`;
}

/** Refreshes every field the import got. Never throws: a broken author shouldn't fail the import. */
export async function upsertAuthorFromImport(info: ImportedAuthorInfo | null): Promise<Author | null> {
  if (!info) return null;
  const id = buildAuthorId(info.provider, info.externalId);
  let author: Author;
  try {
    author = await prisma.author.upsert({
      where: { id },
      create: {
        id,
        provider: info.provider,
        externalId: info.externalId,
        name: info.name,
        handle: info.handle,
        bio: info.bio,
        bioTranslated: info.bioTranslated,
        links: info.links,
        avatarUrl: info.avatarUrl,
        backgroundUrl: info.backgroundUrl,
      },
      // Fields this import lacks are kept, so a creator-summary-only import doesn't wipe a fuller profile.
      update: info.unverified
        ? {}
        : {
            name: info.name ?? undefined,
            handle: info.handle ?? undefined,
            bio: info.bio ?? undefined,
            bioTranslated: info.bioTranslated ?? undefined,
            links: info.links.length ? info.links : undefined,
            avatarUrl: info.avatarUrl ?? undefined,
            backgroundUrl: info.backgroundUrl ?? undefined,
          },
    });
  } catch {
    return null;
  }
  await linkUnattributedPrints(author.id).catch((err) =>
    console.error("Couldn't link earlier imports to their author", err),
  );
  return author;
}

/** Models that only know their author by name, paired with the one author that name or handle
 * belongs to within the same provider (case-insensitive, ignoring a leading "@"). A name shared
 * by two authors matches nobody. */
const LINKABLE_PRINTS = Prisma.sql`
  SELECT p2.id AS print_id, min(a.id) AS author_id
  FROM "Print" p2
  JOIN "Author" a ON a.provider = p2."sourceProvider"
    AND (
      lower(ltrim(trim(a.name), '@')) = lower(ltrim(trim(p2.creator), '@'))
      OR lower(ltrim(trim(a.handle), '@')) = lower(ltrim(trim(p2.creator), '@'))
    )
  WHERE p2."authorId" IS NULL AND p2.creator IS NOT NULL AND trim(p2.creator) <> ''
  GROUP BY p2.id
  HAVING count(*) = 1
`;

/** Links the author's name-only models to them. Returns how many were linked. */
export async function linkUnattributedPrints(authorId: string): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "Print" p SET "authorId" = m.author_id
    FROM (${LINKABLE_PRINTS}) m
    WHERE p.id = m.print_id AND m.author_id = ${authorId}
  `;
}

/** Authors are shared across users, so this checks every user's prints. */
export async function deleteAuthorIfOrphaned(authorId: string): Promise<void> {
  const remaining = await prisma.print.count({ where: { authorId } });
  if (remaining > 0) return;
  await prisma.author.delete({ where: { id: authorId } }).catch(() => undefined);
}

/** Doesn't reveal who claimed it. */
export async function isAuthorLinked(authorId: string): Promise<boolean> {
  const link = await prisma.authorLink.findUnique({ where: { authorId }, select: { id: true } });
  return Boolean(link);
}

export async function getLinkedAuthorsForUser(userId: string): Promise<Author[]> {
  const links = await prisma.authorLink.findMany({ where: { userId }, include: { author: true } });
  return links.map((l) => l.author);
}

export async function getLinkedAuthorIds(userId: string): Promise<string[]> {
  const links = await prisma.authorLink.findMany({ where: { userId }, select: { authorId: true } });
  return links.map((l) => l.authorId);
}

/** Enforces AuthorLink's rules, then copies the author's bio/backgroundUrl onto the user where
 * those are still empty. */
export async function linkAuthorToUser(userId: string, authorId: string): Promise<{ author: Author; user: User }> {
  const author = await prisma.author.findUnique({ where: { id: authorId } });
  if (!author) throw new HttpError(404, "Author not found");

  const [existingLinkForAuthor, existingLinkForProvider] = await Promise.all([
    prisma.authorLink.findUnique({ where: { authorId } }),
    prisma.authorLink.findUnique({ where: { userId_provider: { userId, provider: author.provider } } }),
  ]);
  if (existingLinkForAuthor) {
    throw new HttpError(409, "This author is already linked to an account", "AUTHOR_ALREADY_LINKED");
  }
  if (existingLinkForProvider) {
    throw new HttpError(409, "You already have a linked author for this provider", "PROVIDER_ALREADY_LINKED");
  }

  await prisma.authorLink.create({ data: { userId, authorId, provider: author.provider } });

  const currentUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const bio = author.bio || author.bioTranslated;
  const patch: { bio?: string; backgroundUrl?: string } = {};
  if (!currentUser.bio && bio) patch.bio = bio;
  if (!currentUser.backgroundUrl && author.backgroundUrl) patch.backgroundUrl = author.backgroundUrl;
  const user = Object.keys(patch).length
    ? await prisma.user.update({ where: { id: userId }, data: patch })
    : currentUser;

  return { author, user };
}
