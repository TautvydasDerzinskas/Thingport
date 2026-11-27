import { PlateUploadOutcomeUnknownError, printsApi, type Plate, type Print } from "../../api/prints";
import { UnauthorizedError } from "../../api/client";
import { normalizeFileName, preservesFileExtension } from "../../utils/fileNames.generated";

export type PlateItem =
  | { kind: "existing"; id: string; filename: string; filenameEdited: boolean; folder: string | null }
  | {
      kind: "new";
      localId: string;
      file: File;
      filename: string;
      uploadAttempted?: boolean;
      uploadOutcomeUnknown?: boolean;
    };

export type PlateSaveProgress = {
  print: Print;
  items: PlateItem[];
  removedPlateIds: Set<string>;
};

export type PlateSaveApi = Pick<
  typeof printsApi,
  "get" | "addPlates" | "supportsIdempotentPlateUploads" | "deletePlate" | "renamePlate" | "reorderPlates"
> &
  Partial<Pick<typeof printsApi, "getPlateUploadResults" | "renamePlates">>;

export class PlateUploadConfirmationError extends Error {
  constructor(readonly causes: unknown[] = []) {
    super("PLATE_UPLOAD_CONFIRMATION_FAILED");
    this.name = "PlateUploadConfirmationError";
  }
}

export class PlateRenameSwapUnsupportedError extends Error {}

export function plateFilenameError(filename: string, original: string): "required" | "extension" | undefined {
  if (!filename.trim()) return "required";
  if (!preservesFileExtension(original, filename)) return "extension";
}

type NewPlateItem = Extract<PlateItem, { kind: "new" }>;

function uploadMarker(item: NewPlateItem): string {
  return `thingport-upload-${item.localId}-`;
}

function storedUpload(print: Print, marker: string): Plate | undefined {
  const matches = print.plates.filter((plate) => plate.filename.startsWith(marker));
  if (matches.length > 1) throw new PlateUploadConfirmationError();
  return matches[0];
}

function asExisting(item: NewPlateItem, plate: Plate): PlateItem {
  return {
    kind: "existing",
    id: plate.id,
    filename: item.filename,
    filenameEdited: plate.filename !== item.filename,
    folder: plate.folder ?? null,
  };
}

function reconcileAttemptedUploads(
  print: Print,
  items: PlateItem[],
  completed?: Map<string, string | null>,
): PlateItem[] {
  return items.flatMap((item) => {
    if (item.kind !== "new" || !item.uploadAttempted) return [item];
    const recordedId = completed?.get(item.localId);
    if (recordedId !== undefined) {
      const plate = print.plates.find((candidate) => candidate.id === recordedId);
      // A completed upload remains complete when another editor removes its plate.
      return plate ? [asExisting(item, plate)] : [];
    }
    const uploaded = completed ? undefined : storedUpload(print, uploadMarker(item));
    if (uploaded) return [asExisting(item, uploaded)];
    return [item.uploadOutcomeUnknown === false ? { ...item, uploadAttempted: false } : item];
  });
}

function plateNameKey(folder: string | null | undefined, filename: string): string {
  return JSON.stringify([folder ?? null, filename.toLowerCase()]);
}

export async function savePlateChanges(
  print: Print,
  items: PlateItem[],
  removedPlateIds: Set<string>,
  api: PlateSaveApi,
  onProgress: (progress: PlateSaveProgress) => void,
): Promise<Print> {
  let latest = print;
  let stagedItems = items;
  const pendingRemovals = new Set(removedPlateIds);
  const reportProgress = () =>
    onProgress({ print: latest, items: stagedItems, removedPlateIds: new Set(pendingRemovals) });

  const refreshAttemptedUploads = async (): Promise<boolean> => {
    const uploadIds = stagedItems.flatMap((item) =>
      item.kind === "new" && item.uploadAttempted ? [item.localId] : [],
    );
    const result = await api.getPlateUploadResults?.(print.id, uploadIds);
    latest = result?.print ?? (await api.get(print.id));
    const completed = result && new Map(result.upload_results.map((upload) => [upload.upload_id, upload.plate_id]));
    stagedItems = reconcileAttemptedUploads(latest, stagedItems, completed ?? undefined);
    return Boolean(result);
  };
  const hasAttemptedUploads = stagedItems.some((item) => item.kind === "new" && item.uploadAttempted);
  if (hasAttemptedUploads) {
    let hasReceipts: boolean;
    try {
      hasReceipts = await refreshAttemptedUploads();
    } finally {
      reportProgress();
    }
    const hasUnconfirmedUploads = stagedItems.some((item) => item.kind === "new" && item.uploadAttempted);
    if (hasUnconfirmedUploads && !hasReceipts && !(await api.supportsIdempotentPlateUploads(print.id))) {
      throw new PlateUploadConfirmationError();
    }
  } else if (pendingRemovals.size) {
    // A previous DELETE may have committed before its response reached the editor.
    latest = await api.get(print.id);
    reportProgress();
  }

  const newItems = stagedItems.filter((item): item is NewPlateItem => item.kind === "new");
  if (newItems.length) {
    // A retry can be rejected while the original request is still finishing.
    const unconfirmedIds = new Set(newItems.filter((item) => item.uploadAttempted).map((item) => item.localId));
    const uploads = newItems.map((item) => ({
      item,
      marker: uploadMarker(item),
    }));
    const uploadFiles = uploads.map(
      ({ item, marker }) =>
        new File([item.file], `${marker}${item.file.name}`, {
          type: item.file.type,
          lastModified: item.file.lastModified,
        }),
    );
    stagedItems = stagedItems.map((item) =>
      item.kind === "new" ? { ...item, uploadAttempted: true, uploadOutcomeUnknown: true } : item,
    );
    reportProgress();

    let uploadRes: Awaited<ReturnType<PlateSaveApi["addPlates"]>>;
    try {
      uploadRes = await api.addPlates(print.id, uploadFiles);
    } catch (uploadError) {
      if (uploadError instanceof UnauthorizedError) {
        stagedItems = stagedItems.map((item) =>
          item.kind === "new" && !unconfirmedIds.has(item.localId)
            ? { ...item, uploadAttempted: false, uploadOutcomeUnknown: false }
            : item,
        );
        reportProgress();
        throw uploadError;
      }

      const requestOutcomeUnknown = uploadError instanceof PlateUploadOutcomeUnknownError;
      stagedItems = stagedItems.map((item) =>
        item.kind === "new"
          ? { ...item, uploadOutcomeUnknown: requestOutcomeUnknown || unconfirmedIds.has(item.localId) }
          : item,
      );
      try {
        await refreshAttemptedUploads();
      } catch (reconciliationError) {
        reportProgress();
        if (reconciliationError instanceof UnauthorizedError) throw reconciliationError;
        throw new PlateUploadConfirmationError([uploadError, reconciliationError]);
      }
      reportProgress();
      if (stagedItems.some((item) => item.kind === "new" && item.uploadAttempted)) {
        throw new PlateUploadConfirmationError([uploadError]);
      }
      throw uploadError;
    }

    latest = uploadRes.print;
    try {
      const responseIds = uploadRes.added_plate_ids;
      const idsAreRequestSpecific =
        Array.isArray(responseIds) &&
        responseIds.length === uploads.length &&
        new Set(responseIds).size === uploads.length &&
        responseIds.every((id) => typeof id === "string" && id.length > 0);
      const uploadedIds = idsAreRequestSpecific
        ? responseIds
        : uploads.map(({ marker }) => {
            const uploaded = storedUpload(latest, marker);
            if (!uploaded) throw new PlateUploadConfirmationError();
            return uploaded.id;
          });
      let nextUploaded = 0;
      stagedItems = stagedItems.flatMap((item) => {
        if (item.kind === "existing") return [item];
        const uploadedId = uploadedIds[nextUploaded++];
        const uploaded = latest.plates.find((plate) => plate.id === uploadedId);
        return uploaded ? [asExisting(item, uploaded)] : [];
      });
    } catch (confirmationError) {
      stagedItems = stagedItems.map((item) => (item.kind === "new" ? { ...item, uploadOutcomeUnknown: false } : item));
      try {
        await refreshAttemptedUploads();
      } catch (reconciliationError) {
        reportProgress();
        if (reconciliationError instanceof UnauthorizedError) throw reconciliationError;
        throw new PlateUploadConfirmationError([confirmationError, reconciliationError]);
      }
      reportProgress();
      throw confirmationError;
    }
    reportProgress();
  }

  for (const plateId of pendingRemovals) {
    if (!latest.plates.some((plate) => plate.id === plateId)) {
      pendingRemovals.delete(plateId);
      reportProgress();
      continue;
    }
    const res = await api.deletePlate(print.id, plateId);
    latest = res.print;
    pendingRemovals.delete(plateId);
    reportProgress();
  }

  const renameTargets = new Map(
    stagedItems.flatMap((item) =>
      item.kind === "existing" && item.filenameEdited
        ? [[item.id, { filename: item.filename, normalized: normalizeFileName(item.filename) }] as const]
        : [],
    ),
  );
  while (renameTargets.size) {
    const currentPlates = new Map(latest.plates.map((current) => [current.id, current]));
    const pending = [...renameTargets].flatMap(([id, target]) => {
      const current = currentPlates.get(id);
      return current ? [{ plate: current, ...target }] : [];
    });
    if (!pending.length) break;

    // Only wait for a plate that will actually vacate its name. The server still numbers duplicates.
    const blockers = new Map(
      pending.flatMap((edit) => {
        const currentName = plateNameKey(edit.plate.folder, edit.plate.filename);
        return currentName === plateNameKey(edit.plate.folder, edit.normalized)
          ? []
          : [[currentName, edit.plate] as const];
      }),
    );
    const next = pending.find((edit) => !blockers.has(plateNameKey(edit.plate.folder, edit.normalized))) ?? pending[0];
    const { plate, filename, normalized } = next;
    const blocker = blockers.get(plateNameKey(plate.folder, normalized));
    if (blocker) {
      // A cycle has no free target. Its final names must be committed together.
      const renames = pending.map((edit) => ({ plate_id: edit.plate.id, filename: edit.filename }));
      const result = await api.renamePlates?.(print.id, renames);
      if (!result) throw new PlateRenameSwapUnsupportedError();
      latest = result.print;
      stagedItems = stagedItems.map((staged) => {
        if (staged.kind !== "existing" || !renameTargets.has(staged.id)) return staged;
        const renamed = latest.plates.find((current) => current.id === staged.id);
        return renamed ? { ...staged, filename: renamed.filename, filenameEdited: false } : staged;
      });
      reportProgress();
      break;
    }

    const res = await api.renamePlate(print.id, plate.id, filename);
    latest = res.print;
    const renamed = latest.plates.find((current) => current.id === plate.id);
    stagedItems = stagedItems.map((staged) =>
      staged.kind === "existing" && staged.id === plate.id
        ? { ...staged, filename: renamed?.filename ?? filename, filenameEdited: false }
        : staged,
    );
    renameTargets.delete(plate.id);
    reportProgress();
  }

  const currentPlateIds = new Set(latest.plates.map((plate) => plate.id));
  const finalOrder: string[] = [];
  const includedPlateIds = new Set<string>();
  for (const item of stagedItems) {
    if (item.kind !== "existing" || !currentPlateIds.has(item.id) || includedPlateIds.has(item.id)) continue;
    finalOrder.push(item.id);
    includedPlateIds.add(item.id);
  }
  // Concurrent plates absent from the staged list keep their current relative order at the end.
  for (const plate of latest.plates) {
    if (includedPlateIds.has(plate.id)) continue;
    finalOrder.push(plate.id);
    includedPlateIds.add(plate.id);
  }
  const reorderRes = await api.reorderPlates(print.id, finalOrder);
  latest = reorderRes.print ?? latest;
  reportProgress();
  return latest;
}
