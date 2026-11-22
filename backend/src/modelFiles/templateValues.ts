import type { Category } from "@prisma/client";
import { prisma } from "../db";
import {
  MULTIPLE_COLLECTIONS_FOLDER,
  NO_COLLECTION_FOLDER,
  sanitizePathSegment,
  templateUses,
  type PrintLike,
  type PrintTemplateValues,
} from "./template";

export async function categorySegments(userId: string, categoryId: string | null | undefined): Promise<string[]> {
  if (!categoryId) return ["Unassigned"];
  const segments: string[] = [];
  const visited = new Set<string>();
  let current: Category | null = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    segments.unshift(sanitizePathSegment(current.name, "Category"));
    current = current.parentId ? await prisma.category.findFirst({ where: { id: current.parentId, userId } }) : null;
  }
  return segments.length ? segments : ["Unassigned"];
}

/** {creator}: the author the model page shows (ModelSidePanel): the imported Author's name or handle, else
 *  the plain-text creator an import stored, else -- for the owner's own upload, which has no
 *  source -- the owner. */
async function creatorLabel(print: PrintLike): Promise<string | null> {
  if (print.authorId) {
    const author = await prisma.author.findUnique({
      where: { id: print.authorId },
      select: { name: true, handle: true },
    });
    if (author?.name || author?.handle) return author.name || author.handle;
  }
  if (print.creator) return print.creator;
  if (print.sourceProvider) return null;
  const owner = await prisma.user.findUnique({ where: { id: print.userId }, select: { displayName: true } });
  return owner?.displayName ?? null;
}

/** A model can be in any number of collections; a folder can only hold it once. */
async function collectionLabel(printId: string): Promise<string> {
  const items = await prisma.collectionItem.findMany({
    where: { printId },
    select: { collection: { select: { name: true } } },
    take: 2,
  });
  if (items.length === 0) return NO_COLLECTION_FOLDER;
  if (items.length > 1) return MULTIPLE_COLLECTIONS_FOLDER;
  return items[0].collection.name;
}

/** Every token's value for one print, other than the per-plate {filename}/{plate}. Tokens that
 *  need their own query are only looked up when the template uses them. */
export async function printTemplateValues(print: PrintLike, template: string): Promise<PrintTemplateValues> {
  const tagLabel =
    (print.tags || [])
      .map((t) => t.trim())
      .filter(Boolean)
      .join(" + ") || "Untagged";
  return {
    "category-or-folder": templateUses(template, "category-or-folder")
      ? (await categorySegments(print.userId, print.categoryId)).join("/")
      : "",
    collection: templateUses(template, "collection")
      ? sanitizePathSegment(await collectionLabel(print.id), NO_COLLECTION_FOLDER)
      : "",
    tags: sanitizePathSegment(tagLabel, "Untagged"),
    creator: templateUses(template, "creator") ? sanitizePathSegment(await creatorLabel(print), "Unknown creator") : "",
    model: sanitizePathSegment(print.name, "Model"),
    id: print.id,
  };
}
