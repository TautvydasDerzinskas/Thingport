import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { toPrintOut, type PrintOut } from "../dto";
import { remoteOriginOut } from "../federation/remoteExplore";
import { aiCategoryPaths, aiSuggestionOut, aiSuggestionsShown } from "./aiCategorizationService";
import { aiDescriptionOut } from "./aiDescriptionService";
import { printProfilesOut, profileFillRunning } from "./printProfileService";
import { licenseFillRunning, licensePending, licenseReadFailed } from "./licenseService";
import type { Author, Category, Plate, PreviewImage, Prisma, Print, PrintFile } from "@prisma/client";

export type FullPrint = {
  print: Print & { author: Author | null; category: Category | null };
  plates: Plate[];
  files: PrintFile[];
  preparedFile: PrintFile | null;
  previewImages: PreviewImage[];
};

/** `scope` widens which models may be loaded, from the user's own (as services/socialService.ts readablePrintWhere). */
export async function loadFullPrint(
  userId: string,
  printId: string,
  scope: Prisma.PrintWhereInput = { userId },
): Promise<FullPrint> {
  const print = await prisma.print.findFirst({
    where: { id: printId, AND: [scope] },
    include: { author: true, category: true },
  });
  if (!print) throw new HttpError(404, "Print not found");
  const [plates, files, previewImages] = await Promise.all([
    prisma.plate.findMany({ where: { printId }, orderBy: { position: "asc" } }),
    prisma.printFile.findMany({ where: { printId } }),
    prisma.previewImage.findMany({ where: { printId }, orderBy: { position: "asc" } }),
  ]);
  const preparedFile = print.preparedFileId
    ? await prisma.printFile.findUnique({ where: { id: print.preparedFileId } })
    : null;
  return { print, plates, files, preparedFile, previewImages };
}

export async function printOutById(
  userId: string,
  printId: string,
  scope: Prisma.PrintWhereInput = { userId },
): Promise<PrintOut> {
  // Before its plates are read: see printProfilesOut.
  const filling = profileFillRunning(printId);
  const [full, categoryPaths, suggestionsShown] = await Promise.all([
    loadFullPrint(userId, printId, scope),
    aiCategoryPaths(userId),
    aiSuggestionsShown(),
  ]);
  const out = toPrintOut(
    full.print,
    full.plates,
    full.files,
    full.preparedFile,
    full.print.author,
    full.previewImages,
    full.print.category,
    await aiSuggestionOut(userId, full.print.aiSuggestion, categoryPaths, suggestionsShown),
    await aiDescriptionOut(full.print),
  );
  const profiles = await printProfilesOut(full.print, full.plates, filling);
  const withProfiles = Object.keys(profiles.profiles).length
    ? {
        plates: out.plates.map((plate) => ({ ...plate, profile: profiles.profiles[plate.id] ?? null })),
        profiles_pending: profiles.pending,
        profiles_filling: profiles.filling,
      }
    : {};
  return {
    ...out,
    ...withProfiles,
    license_pending: licensePending(full.print),
    license_filling: licenseFillRunning(full.print.id),
    license_failed: !licenseFillRunning(full.print.id) && licenseReadFailed(full.print.id),
    copied_from_remote: await remoteOriginOut(full.print.remoteSource),
  };
}

function groupByPrintId<T extends { printId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.printId);
    if (list) list.push(row);
    else map.set(row.printId, [row]);
  }
  return map;
}

/** A few `IN` queries instead of one load per id. Ids not owned by `userId` (or outside `scope`) are omitted. */
export async function printOutsByIds(
  userId: string,
  printIds: string[],
  scope: Prisma.PrintWhereInput = { userId },
): Promise<Map<string, PrintOut>> {
  const out = new Map<string, PrintOut>();
  if (!printIds.length) return out;
  const [prints, plates, files, previewImages, categoryPaths, suggestionsShown] = await Promise.all([
    prisma.print.findMany({
      where: { id: { in: printIds }, AND: [scope] },
      include: { author: true, category: true },
    }),
    prisma.plate.findMany({ where: { printId: { in: printIds } }, orderBy: { position: "asc" } }),
    prisma.printFile.findMany({ where: { printId: { in: printIds } } }),
    prisma.previewImage.findMany({ where: { printId: { in: printIds } }, orderBy: { position: "asc" } }),
    aiCategoryPaths(userId),
    aiSuggestionsShown(),
  ]);
  const platesByPrint = groupByPrintId(plates);
  const filesByPrint = groupByPrintId(files);
  const previewsByPrint = groupByPrintId(previewImages);
  for (const print of prints) {
    const printFiles = filesByPrint.get(print.id) || [];
    const preparedFile = print.preparedFileId ? (printFiles.find((f) => f.id === print.preparedFileId) ?? null) : null;
    out.set(
      print.id,
      toPrintOut(
        print,
        platesByPrint.get(print.id) || [],
        printFiles,
        preparedFile,
        print.author,
        previewsByPrint.get(print.id) || [],
        // The search palette shows it under each model.
        print.category,
        await aiSuggestionOut(userId, print.aiSuggestion, categoryPaths, suggestionsShown),
      ),
    );
  }
  return out;
}
