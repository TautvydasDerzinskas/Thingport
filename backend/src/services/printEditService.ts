import { Prisma, type Print } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { normalizeTag, normalizeTags } from "../utils/tagNormalization";
import { assetOwnerIds, relocatePrint, removeAssetHome, removePlatePictures, uniqueModelName } from "./printService";
import { forgetAiDescription } from "./aiDescriptionService";
import { localizeDescriptionImages, pruneDescriptionImages } from "./descriptionImageService";
import { createLog } from "./auditLog";
import { recordActivity } from "./activityService";
import { loadFullPrint } from "./printLoader";
import { deleteAllPrintFiles } from "./printFileService";
import { deleteAllPreviewImages } from "./previewImageService";
import { deleteAllDescriptionImages } from "./descriptionImageService";
import { deletePlateFiles } from "./printCreation";
import { deleteAuthorIfOrphaned } from "./authorService";
import { removeTagBookmark } from "./bookmarkService";
import { removeTagMosaics } from "./tagMosaicService";

// Editing and deleting a model, shared by the model page's routes and the MCP tools.

/** The user's own model, for a change to it: never one a tool brought (services/toolsService.ts), which stays as the
 *  tool needs it until the tool is uninstalled. */
async function ownPrint(userId: string, printId: string): Promise<Print> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId } });
  if (!print) throw new HttpError(404, "Print not found");
  assertNotToolModel(print);
  return print;
}

/**
 * What deleted models leave behind that nothing else needs: their author, and the pictures and bookmarks of their
 * tags.
 *
 * Rows under a model go with it, but an author is shared between models and users, and a tag is only a word on a
 * model: deleting the last model of either leaves an author in the authors list with nothing to show and a tag
 * mosaic that is a picture of models that are gone. Each goes only when nothing is left that needs it, which is
 * why this runs after the models rather than with them.
 */
export async function pruneWhatModelsLeft(
  userId: string,
  went: { authorId: string | null; tags: string[] }[],
): Promise<void> {
  for (const authorId of new Set(went.map((one) => one.authorId).filter((id): id is string => Boolean(id)))) {
    await deleteAuthorIfOrphaned(authorId);
  }

  const tags = new Set(went.flatMap((one) => one.tags.map(normalizeTag)).filter(Boolean));
  if (!tags.size) return;
  // Postgres array containment is case-sensitive, so what's still tagged is read and normalized here instead.
  const left = await prisma.print.findMany({
    where: { userId, NOT: { tags: { isEmpty: true } } },
    select: { tags: true },
  });
  const kept = new Set(left.flatMap((print) => print.tags.map(normalizeTag)));
  for (const tag of tags) {
    if (kept.has(tag)) continue;
    await removeTagMosaics(userId, tag);
    await removeTagBookmark(userId, tag);
  }
}

export function assertNotToolModel(print: Pick<Print, "toolId" | "title" | "name">): void {
  if (print.toolId)
    throw new HttpError(403, `"${print.title || print.name}" belongs to a tool and can't be changed`, "TOOL_OWNED");
}

async function relocate(print: Print): Promise<void> {
  const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
  await relocatePrint(print, plates);
}

/** Replaces the model's tags. */
export async function setPrintTags(userId: string, printId: string, tags: string[]): Promise<Print> {
  const print = await ownPrint(userId, printId);
  const updated = await prisma.print.update({ where: { id: print.id }, data: { tags: normalizeTags(tags) } });
  await relocate(updated);
  void createLog({
    userId,
    action: "model_edited",
    targetId: print.id,
    details: { field: "tags", name: updated.name },
  });
  return updated;
}

export type PrintMetaUpdate = {
  name?: string;
  notes?: string;
  creator?: string;
  /** A category to move it to with the rename, so the name is checked there and both change together. */
  categoryId?: string | null;
};

/** Renames the model (409 when the name is taken in its category), or changes its description or creator. */
export async function updatePrintMeta(userId: string, printId: string, meta: PrintMetaUpdate): Promise<Print> {
  const print = await ownPrint(userId, printId);
  const data: Prisma.PrintUpdateInput = {};
  const moving = meta.categoryId !== undefined && meta.categoryId !== print.categoryId;
  const categoryId = moving ? (meta.categoryId ?? null) : print.categoryId;
  if (moving) {
    if (categoryId && !(await prisma.category.count({ where: { id: categoryId, userId } }))) {
      throw new HttpError(400, "Category not found");
    }
    data.category = categoryId ? { connect: { id: categoryId } } : { disconnect: true };
    data.categorySource = categoryId ? "MANUAL" : null;
    data.aiSuggestion = Prisma.DbNull;
  }
  if (meta.name !== undefined || moving) {
    const nextName = await uniqueModelName(userId, meta.name ?? print.name, categoryId, print.id);
    if (nextName !== print.name) {
      data.name = nextName;
      data.nameNormalized = nextName.trim().toLowerCase();
      data.title = nextName;
    }
  }
  if (meta.notes !== undefined) data.notes = meta.notes;
  if (meta.creator !== undefined) data.creator = meta.creator.trim() || null;

  const updated = await prisma.print.update({ where: { id: print.id }, data });
  await relocate(updated);
  if (meta.notes !== undefined) {
    if (meta.notes !== (print.notes ?? "")) await forgetAiDescription(print.id);
    await pruneDescriptionImages(print.id);
    // Images pasted in by URL are fetched in the background: slow hosts mustn't hold up the save.
    void localizeDescriptionImages(print.id);
  }
  for (const field of moving ? ["meta", "category"] : ["meta"]) {
    void createLog({ userId, action: "model_edited", targetId: print.id, details: { field, name: updated.name } });
  }
  return updated;
}

/** Deletes the model with its files and pictures, for good. */
/** `quiet` for a model the user never chose to delete, such as one a tool brought, which goes with the tool. */
export async function deletePrint(userId: string, printId: string, { quiet = false } = {}): Promise<void> {
  const full = await loadFullPrint(userId, printId);
  // Only the tool's uninstall, quietly, removes a model a tool brought.
  if (!quiet) assertNotToolModel(full.print);
  const assetOwners = await assetOwnerIds(printId);
  await deleteAllPrintFiles(printId);
  await deleteAllPreviewImages(printId);
  await deleteAllDescriptionImages(printId);
  await prisma.print.delete({ where: { id: printId } });
  for (const plate of full.plates) {
    await deletePlateFiles(plate);
    await removePlatePictures(plate.id, full.print.assetsPath);
  }
  await removeAssetHome(full.print.assetsPath, assetOwners);
  await pruneWhatModelsLeft(userId, [{ authorId: full.print.authorId, tags: full.print.tags }]);
  if (quiet) return;
  void recordActivity(userId, "delete", printId, full.print.name);
  void createLog({
    userId,
    action: "model_deleted",
    targetId: printId,
    details: { name: full.print.name },
  });
}
