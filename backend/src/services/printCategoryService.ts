import { Prisma, type CategorySource, type Print } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { relocatePrint, uniqueModelName } from "./printService";

export type CategoryUpdateExpectation = {
  categoryId: string | null;
  categorySource: CategorySource | null;
};

type SetPrintCategoryOptions = {
  expected?: CategoryUpdateExpectation;
  clearSuggestion?: boolean;
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

  if (categoryId) {
    const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
    if (!category) throw new HttpError(400, "Category not found");
    await uniqueModelName(userId, print.name, category.id, print.id);
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
    },
  });
  if (!updated.count) return null;

  const next = await prisma.print.findUniqueOrThrow({ where: { id: print.id } });
  const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
  await relocatePrint(next, plates);
  return next;
}
