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
  let before: Pick<Author, "name" | "handle"> | null = null;
  try {
    before = await prisma.author.findUnique({ where: { id }, select: { name: true, handle: true } });
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
  const linked = await linkUnattributedPrints(author.id).catch((err) => {
    console.error("Couldn't link earlier imports to their author", err);
    return 0;
  });
  // LICENSE.txt names the author: their models' files follow a new name, and models just linked to them, before the
  // import goes on. A name rarely changes, so this is rarely more than a few small files.
  const renamed = before && (before.name !== author.name || before.handle !== author.handle);
  if (renamed || linked > 0) {
    const { syncAuthorLicenseFiles } = await import("./licenseFile");
    await syncAuthorLicenseFiles(author.id).catch((err) =>
      console.error("Couldn't rewrite the author's LICENSE.txt files", err),
    );
  }
  return author;
}

/** Whether author `a` goes by `creator`: by name or handle, ignoring case and a leading "@". */
const goesBy = (creator: Prisma.Sql) => Prisma.sql`(
  lower(ltrim(trim(a.name), '@')) = lower(ltrim(trim(${creator}), '@'))
  OR lower(ltrim(trim(a.handle), '@')) = lower(ltrim(trim(${creator}), '@'))
)`;

/** Models that only know their author by name, paired with the one author of the same provider who goes by it. A name
 *  two authors share matches nobody. */
const LINKABLE_PRINTS = Prisma.sql`
  SELECT p2.id AS print_id, min(a.id) AS author_id
  FROM "Print" p2
  JOIN "Author" a ON a.provider = p2."sourceProvider" AND ${goesBy(Prisma.sql`p2.creator`)}
  WHERE p2."authorId" IS NULL AND p2.creator IS NOT NULL AND trim(p2.creator) <> ''
  GROUP BY p2.id
  HAVING count(*) = 1
`;

/** Links name-only models to their author: with `authorId`, that author's, as an import saves them; without, every
 *  one, as on startup. Returns how many were linked. */
export async function linkUnattributedPrints(authorId?: string): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "Print" p SET "authorId" = m.author_id
    FROM (${LINKABLE_PRINTS}) m
    WHERE p.id = m.print_id ${authorId ? Prisma.sql`AND m.author_id = ${authorId}` : Prisma.empty}
  `;
}

/** The one author of `provider` who goes by `creator`, for a model whose import got only the name; null for none, or
 *  for a name two authors share. */
export async function authorIdByName(provider: string, creator: string): Promise<string | null> {
  const [row] = await prisma.$queryRaw<{ id: string }[]>`
    SELECT min(a.id) AS id FROM "Author" a
    WHERE a.provider = ${provider} AND ${goesBy(Prisma.sql`${creator}::text`)}
    HAVING count(*) = 1
  `;
  return row?.id ?? null;
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

/** Enforces AuthorLink's rules, then copies the author's bio, cover and picture onto the user where they have none of
 *  their own: no avatar they chose, a Gravatar included, as the others saw the author's picture before avatars came. */
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
  const patch: { bio?: string; backgroundUrl?: string; avatarUrl?: string } = {};
  if (!currentUser.bio && bio) patch.bio = bio;
  // A drawn cover they picked is theirs too; only the one picked for them gives way.
  if (!currentUser.backgroundUrl && !currentUser.coverPreset && author.backgroundUrl) {
    patch.backgroundUrl = author.backgroundUrl;
  }
  if (!currentUser.avatarUrl && currentUser.avatarStyle === null && author.avatarUrl)
    patch.avatarUrl = author.avatarUrl;
  const user = Object.keys(patch).length
    ? await prisma.user.update({ where: { id: userId }, data: patch })
    : currentUser;

  return { author, user };
}
