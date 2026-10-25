import type { Prisma, Print } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { normalizeTags } from "../utils/tagNormalization";
import { relocatePrint, uniqueModelName } from "./printService";
import { forgetAiDescription } from "./aiDescriptionService";
import { localizeDescriptionImages, pruneDescriptionImages } from "./descriptionImageService";
import { createLog } from "./auditLog";

// Editing a model's details, shared by the model page's routes and the MCP edit_model tool.

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

export type PrintMetaUpdate = { name?: string; notes?: string; creator?: string };

/** Renames the model (409 when the name is taken in its category), or changes its description or creator. */
export async function updatePrintMeta(userId: string, printId: string, meta: PrintMetaUpdate): Promise<Print> {
  const print = await ownPrint(userId, printId);
  const data: Prisma.PrintUpdateInput = {};
  if (meta.name !== undefined) {
    const nextName = await uniqueModelName(userId, meta.name, print.categoryId, print.id);
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
  void createLog({
    userId,
    action: "model_edited",
    targetId: print.id,
    details: { field: "meta", name: updated.name },
  });
  return updated;
}
