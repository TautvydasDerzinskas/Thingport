import type { Prisma } from "@prisma/client";
import type { ProfileImportTotals } from "./importJobRunner";

export type LinkImportResult = ProfileImportTotals & { profiles: boolean };

/** Null for pre-migration items, whose aggregate job counters remain the legacy baseline. */
export function readLinkResult(value: Prisma.JsonValue | null): LinkImportResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (
    typeof value.imported !== "number" ||
    typeof value.alreadyInLibrary !== "number" ||
    typeof value.failed !== "number"
  )
    return null;
  return value as unknown as LinkImportResult;
}

/** A partial profile retry can add files to a model already counted as imported. */
export function mergeLinkResult(previous: LinkImportResult | null, current: LinkImportResult): LinkImportResult {
  if (!previous) return current;
  const imported = previous.imported + current.imported;
  return {
    ...current,
    imported,
    alreadyInLibrary: imported ? 0 : Math.max(previous.alreadyInLibrary, current.alreadyInLibrary),
    processed: Math.max(previous.processed, current.processed),
    printId: current.printId ?? previous.printId,
  };
}

export function summarizeLinkResults(results: Iterable<LinkImportResult>) {
  let imported = 0;
  let alreadyInLibrary = 0;
  let profilesImported = 0;
  let profilesProcessed = 0;
  let printId: string | null = null;
  const newPrintIds = new Set<string>();
  for (const result of results) {
    if (result.imported) {
      imported++;
      if (result.printId) newPrintIds.add(result.printId);
    } else if (result.alreadyInLibrary) alreadyInLibrary++;
    if (result.profiles) {
      profilesImported += result.imported;
      profilesProcessed += result.processed;
    }
    printId = result.printId ?? printId;
  }
  return { imported, alreadyInLibrary, profilesImported, profilesProcessed, printId, newPrintIds: [...newPrintIds] };
}
