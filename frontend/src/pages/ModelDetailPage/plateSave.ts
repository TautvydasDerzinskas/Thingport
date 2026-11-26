import { printsApi, type Plate, type Print } from "../../api/prints";
import { UnauthorizedError } from "../../api/client";

export type PlateItem =
  | { kind: "existing"; id: string; filename: string; filenameEdited: boolean; folder: string | null }
  | { kind: "new"; localId: string; file: File; filename: string; uploadAttempted?: boolean };

export type PlateSaveProgress = {
  print: Print;
  items: PlateItem[];
  removedPlateIds: Set<string>;
};

export type PlateSaveApi = Pick<
  typeof printsApi,
  "get" | "addPlates" | "deletePlate" | "renamePlate" | "reorderPlates"
>;

export class PlateUploadConfirmationError extends Error {
  constructor(readonly causes: unknown[] = []) {
    super("PLATE_UPLOAD_CONFIRMATION_FAILED");
    this.name = "PlateUploadConfirmationError";
  }
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

function reconcileAttemptedUploads(print: Print, items: PlateItem[]): PlateItem[] {
  return items.map((item) => {
    if (item.kind !== "new" || !item.uploadAttempted) return item;
    const uploaded = storedUpload(print, uploadMarker(item));
    return uploaded ? asExisting(item, uploaded) : { ...item, uploadAttempted: false };
  });
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

  if (stagedItems.some((item) => item.kind === "new" && item.uploadAttempted)) {
    latest = await api.get(print.id);
    try {
      stagedItems = reconcileAttemptedUploads(latest, stagedItems);
    } catch (error) {
      reportProgress();
      throw error;
    }
    reportProgress();
  }

  const newItems = stagedItems.filter((item): item is NewPlateItem => item.kind === "new");
  if (newItems.length) {
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
    stagedItems = stagedItems.map((item) => (item.kind === "new" ? { ...item, uploadAttempted: true } : item));
    reportProgress();

    let uploadRes: Awaited<ReturnType<PlateSaveApi["addPlates"]>>;
    try {
      uploadRes = await api.addPlates(print.id, uploadFiles);
    } catch (uploadError) {
      if (uploadError instanceof UnauthorizedError) {
        stagedItems = stagedItems.map((item) => (item.kind === "new" ? { ...item, uploadAttempted: false } : item));
        reportProgress();
        throw uploadError;
      }

      try {
        latest = await api.get(print.id);
        stagedItems = reconcileAttemptedUploads(latest, stagedItems);
      } catch (reconciliationError) {
        reportProgress();
        if (reconciliationError instanceof UnauthorizedError) throw reconciliationError;
        throw new PlateUploadConfirmationError([uploadError, reconciliationError]);
      }
      reportProgress();
      throw uploadError;
    }

    latest = uploadRes.print;
    try {
      const responseIds = uploadRes.added_plate_ids;
      const idsAreRequestSpecific =
        Array.isArray(responseIds) &&
        responseIds.length === uploads.length &&
        new Set(responseIds).size === uploads.length &&
        responseIds.every((id) => latest.plates.some((plate) => plate.id === id));
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
        const uploaded = uploadedId && latest.plates.find((plate) => plate.id === uploadedId);
        if (!uploaded) throw new PlateUploadConfirmationError();
        return asExisting(item, uploaded);
      });
    } catch (confirmationError) {
      try {
        latest = await api.get(print.id);
        stagedItems = reconcileAttemptedUploads(latest, stagedItems);
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

  for (const item of stagedItems) {
    if (item.kind !== "existing" || !item.filenameEdited) continue;
    const current = latest.plates.find((plate) => plate.id === item.id);
    if (!current) continue;
    if (current.filename === item.filename) {
      stagedItems = stagedItems.map((staged) =>
        staged.kind === "existing" && staged.id === item.id
          ? { ...staged, filename: current.filename, filenameEdited: false }
          : staged,
      );
      reportProgress();
      continue;
    }
    const res = await api.renamePlate(print.id, item.id, item.filename);
    latest = res.print;
    const renamed = latest.plates.find((plate) => plate.id === item.id);
    stagedItems = stagedItems.map((staged) =>
      staged.kind === "existing" && staged.id === item.id
        ? { ...staged, filename: renamed?.filename ?? item.filename, filenameEdited: false }
        : staged,
    );
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
