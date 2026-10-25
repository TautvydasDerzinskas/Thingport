import { Prisma, type Print } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { normalizeTags } from "../utils/tagNormalization";
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

// Editing and deleting a model, shared by the model page's routes and the MCP tools.

async function ownPrint(userId: string, printId: string): Promise<Print> {
  const print = await prisma.print.findFirst({ where: { id: printId, userId } });
  if (!print) throw new HttpError(404, "Print not found");
  return print;
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
export async function deletePrint(userId: string, printId: string): Promise<void> {
  const full = await loadFullPrint(userId, printId);
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
  void recordActivity(userId, "delete", printId, full.print.name);
  void createLog({
    userId,
    action: "model_deleted",
    targetId: printId,
    details: { name: full.print.name },
  });
}
