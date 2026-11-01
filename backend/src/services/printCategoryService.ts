import { Prisma, type CategorySource, type Print } from "@prisma/client";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { HttpError } from "../utils/fileUtils";
import { availableModelName, isOwnUpload, relocatePrint, uniqueModelName } from "./printService";

const log = createLogger("print-category");

export type CategoryUpdateExpectation = {
  categoryId: string | null;
  categorySource: CategorySource | null;
};

type SetPrintCategoryOptions = {
  expected?: CategoryUpdateExpectation;
  clearSuggestion?: boolean;
  /** Suffix the model's name when the category has one like it, rather than refuse the move. */
  renameIfTaken?: boolean;
};

/**
 * Changes the category through one path so validation and managed-file relocation cannot diverge
 * between the manual route, AI application and accepting a suggestion. `expected` is an optimistic
 * lock used after a slow provider call: a more recent manual decision always wins.
 */
export async function setPrintCategory(
  userId: string,
  printId: string,
  categoryId: string | null,
  source: CategorySource | null,
  options: SetPrintCategoryOptions = {},
): Promise<Print | null> {
  if ((categoryId === null) !== (source === null)) {
    throw new Error("A category source is required exactly when a category is set");
  }

  const print = await prisma.print.findFirst({ where: { id: printId, userId } });
  if (!print) throw new HttpError(404, "Print not found");
  if (
    options.expected &&
    (print.categoryId !== options.expected.categoryId || print.categorySource !== options.expected.categorySource)
  ) {
    return null;
  }

  let name = print.name;
  if (categoryId) {
    const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
    if (!category) throw new HttpError(400, "Category not found");
    if (options.renameIfTaken) name = await availableModelName(userId, print.name, category.id, print.id);
    else await uniqueModelName(userId, print.name, category.id, print.id);
  } else {
    await uniqueModelName(userId, print.name, null, print.id);
  }

  const where = options.expected
    ? {
        id: print.id,
        categoryId: options.expected.categoryId,
        categorySource: options.expected.categorySource,
      }
    : { id: print.id };
  const updated = await prisma.print.updateMany({
    where,
    data: {
      categoryId,
      categorySource: source,
      ...(options.clearSuggestion ? { aiSuggestion: Prisma.DbNull } : {}),
      ...(name !== print.name ? { name, nameNormalized: name.trim().toLowerCase(), title: name } : {}),
    },
  });
  if (!updated.count) return null;

  const next = await prisma.print.findUniqueOrThrow({ where: { id: print.id } });
  const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
  await relocatePrint(next, plates);
  return next;
}

export type AssignedCategory = {
  assigned: Print[];
  /** Imported or a tool's: they keep what they have. */
  skipped: number;
  failed: number;
};

/** Gives each of the user's own uploads this category, taking it out of any folder or other category it was in. One
 *  at a time, so a model that fails doesn't take the rest with it. */
export async function assignCategory(
  userId: string,
  printIds: string[],
  categoryId: string,
): Promise<AssignedCategory> {
  if (!(await prisma.category.count({ where: { id: categoryId, userId, kind: "category" } }))) {
    throw new HttpError(400, "Category not found");
  }
  const unique = [...new Set(printIds)];
  const prints = await prisma.print.findMany({
    where: { id: { in: unique }, userId },
    select: { id: true, sourceProvider: true, toolId: true },
  });
  const own = prints.filter(isOwnUpload);
  const assigned: Print[] = [];
  let failed = 0;
  for (const { id } of own) {
    try {
      const updated = await setPrintCategory(userId, id, categoryId, "MANUAL", {
        clearSuggestion: true,
        renameIfTaken: true,
      });
      if (updated) assigned.push(updated);
      else failed++;
    } catch (error) {
      log.warn("couldn't assign a category", { print: id, error });
      failed++;
    }
  }
  return { assigned, skipped: unique.length - own.length, failed };
}
