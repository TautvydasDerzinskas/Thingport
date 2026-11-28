import {
  PlateSetChangedError,
  PlateUploadOutcomeUnknownError,
  printsApi,
  type Plate,
  type Print,
} from "../../api/prints";
import { UnauthorizedError } from "../../api/client";
import { normalizeFileName, preservesFileExtension } from "../../utils/fileNames.generated";

export type PlateItem =
  | {
      kind: "existing";
      id: string;
      filename: string;
      filenameEdited: boolean;
      folder: string | null;
      /** The name asked for when the server saved a numbered one instead, kept until the save that reports it. */
      numberedFrom?: string;
    }
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

/** An upload whose outcome is unknown on a server that can neither say which files it saved nor take the same file
 *  again safely: trying again here can't settle it, and checking the model's files can. */
export class PlateUploadRetryUnsafeError extends PlateUploadConfirmationError {
  constructor() {
    super();
    this.name = "PlateUploadRetryUnsafeError";
  }
}

export class PlateRenameSwapUnsupportedError extends Error {}

/** Files saved under numbered names, as ones this save doesn't rename keep the names asked for. Everything else in
 *  the save went through. `requested` and `saved` are the first of them. */
export class PlateRenameNumberedError extends Error {
  readonly requested: string;
  readonly saved: string;
  constructor(readonly renames: { requested: string; saved: string }[]) {
    super(`Saved as ${renames.map((rename) => rename.saved).join(", ")}: other files have the names asked for`);
    this.name = "PlateRenameNumberedError";
    this.requested = renames[0].requested;
    this.saved = renames[0].saved;
  }
}

const MAX_REORDER_ATTEMPTS = 3;

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
    const refreshed = result?.print ?? (await api.get(print.id));
    const completed = result && new Map(result.upload_results.map((upload) => [upload.upload_id, upload.plate_id]));
    stagedItems = reconcileAttemptedUploads(refreshed, stagedItems, completed ?? undefined);
    latest = refreshed;
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
      throw new PlateUploadRetryUnsafeError();
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

    let uploadRes: Awaited<ReturnType<PlateSaveApi["addPlates"]>> | undefined;
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
      // A rejected upload is still a new row even when it no longer needs a receipt lookup.
      if (stagedItems.some((item) => item.kind === "new")) throw uploadError;
    }

    if (uploadRes) {
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
        stagedItems = stagedItems.map((item) => {
          if (item.kind === "existing") return item;
          const uploadedId = uploadedIds[nextUploaded++];
          const uploaded = latest.plates.find((plate) => plate.id === uploadedId);
          if (!uploaded) throw new PlateUploadConfirmationError();
          return asExisting(item, uploaded);
        });
      } catch (confirmationError) {
        try {
          await refreshAttemptedUploads();
        } catch (reconciliationError) {
          reportProgress();
          if (reconciliationError instanceof UnauthorizedError) throw reconciliationError;
          throw new PlateUploadConfirmationError([confirmationError, reconciliationError]);
        }
        reportProgress();
        if (stagedItems.some((item) => item.kind === "new")) throw confirmationError;
      }
      reportProgress();
    }
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
  // Asked again once, after the plate that held its name has moved away.
  const askedAgain = new Set<string>();
  const sameName = (plate: Plate, name: string) =>
    plateNameKey(plate.folder, plate.filename) === plateNameKey(plate.folder, name);
  /** The other plate in `plate`'s folder holding `name`, which the server numbered `plate`'s name apart from. */
  const holderOf = (plate: Plate, name: string) =>
    plateNameKey(plate.folder, plate.filename) === plateNameKey(plate.folder, name)
      ? undefined
      : latest.plates.find(
          (other) =>
            other.id !== plate.id && plateNameKey(other.folder, other.filename) === plateNameKey(plate.folder, name),
        );
  const movesAway = (holder: Plate) => {
    const target = renameTargets.get(holder.id);
    return (
      target !== undefined &&
      plateNameKey(holder.folder, target.normalized) !== plateNameKey(holder.folder, holder.filename)
    );
  };
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
      // Every plate of the batch moved together, so a name still held is held by a file outside this save.
      stagedItems = stagedItems.map((staged) => {
        const target = staged.kind === "existing" ? renameTargets.get(staged.id) : undefined;
        if (staged.kind !== "existing" || !target) return staged;
        const renamed = latest.plates.find((current) => current.id === staged.id);
        if (!renamed) return staged;
        const numberedFrom = sameName(renamed, target.normalized) ? undefined : target.normalized;
        return { ...staged, filename: renamed.filename, filenameEdited: false, numberedFrom };
      });
      reportProgress();
      break;
    }

    const res = await api.renamePlate(print.id, plate.id, filename);
    latest = res.print;
    const renamed = latest.plates.find((current) => current.id === plate.id);
    // Saved under another name than asked: the server numbered it apart from a plate that held the name.
    const differs = renamed !== undefined && !sameName(renamed, normalized);
    const holder = renamed && differs ? holderOf(renamed, normalized) : undefined;
    // Asked again once when the name may be free by then: its holder has gone since, or is a plate this save renames
    // away (another editor gave it the name after this snapshot), which goes first.
    if (differs && (!holder || movesAway(holder)) && !askedAgain.has(plate.id)) {
      askedAgain.add(plate.id);
      reportProgress();
      continue;
    }
    // Kept on the item, so a later step failing doesn't lose it: the save that finishes reports it.
    const numberedFrom = differs ? normalized : undefined;
    stagedItems = stagedItems.map((staged) =>
      staged.kind === "existing" && staged.id === plate.id
        ? { ...staged, filename: renamed?.filename ?? filename, filenameEdited: false, numberedFrom }
        : staged,
    );
    renameTargets.delete(plate.id);
    reportProgress();
  }

  const orderOf = (current: Print) => {
    const currentPlateIds = new Set(current.plates.map((plate) => plate.id));
    const finalOrder: string[] = [];
    const includedPlateIds = new Set<string>();
    for (const item of stagedItems) {
      if (item.kind !== "existing" || !currentPlateIds.has(item.id) || includedPlateIds.has(item.id)) continue;
      finalOrder.push(item.id);
      includedPlateIds.add(item.id);
    }
    // Concurrent plates absent from the staged list keep their current relative order at the end.
    for (const plate of current.plates) {
      if (includedPlateIds.has(plate.id)) continue;
      finalOrder.push(plate.id);
      includedPlateIds.add(plate.id);
    }
    return finalOrder;
  };
  for (let attempt = 1; ; attempt++) {
    try {
      const reorderRes = await api.reorderPlates(print.id, orderOf(latest));
      latest = reorderRes.print ?? latest;
      break;
    } catch (error) {
      // Another editor added or removed a plate since: the draft's order goes onto the plates there are now.
      if (!(error instanceof PlateSetChangedError) || attempt >= MAX_REORDER_ATTEMPTS) throw error;
      latest = await api.get(print.id);
      reportProgress();
    }
  }
  const numbered = stagedItems.flatMap((item) =>
    item.kind === "existing" && item.numberedFrom ? [{ requested: item.numberedFrom, saved: item.filename }] : [],
  );
  if (numbered.length) {
    // All reported at once, and once: the next save goes through quietly.
    stagedItems = stagedItems.map((item) => {
      if (item.kind !== "existing" || !item.numberedFrom) return item;
      const { numberedFrom: _reported, ...rest } = item;
      return rest;
    });
    reportProgress();
    throw new PlateRenameNumberedError(numbered);
  }
  reportProgress();
  return latest;
}
