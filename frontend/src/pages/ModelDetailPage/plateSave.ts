import { printsApi, type Print } from "../../api/prints";

export type PlateItem =
  | { kind: "existing"; id: string; filename: string; filenameEdited: boolean; folder: string | null }
  | { kind: "new"; localId: string; file: File; filename: string };

export type PlateSaveProgress = {
  print: Print;
  items: PlateItem[];
  removedPlateIds: Set<string>;
};

export type PlateSaveApi = Pick<typeof printsApi, "addPlates" | "deletePlate" | "renamePlate" | "reorderPlates">;

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

  const newItems = stagedItems.filter((item): item is Extract<PlateItem, { kind: "new" }> => item.kind === "new");
  if (newItems.length) {
    const uploads = newItems.map((item) => ({
      item,
      marker: `thingport-upload-${item.localId}-`,
    }));
    const uploadFiles = uploads.map(
      ({ item, marker }) =>
        new File([item.file], `${marker}${item.file.name}`, {
          type: item.file.type,
          lastModified: item.file.lastModified,
        }),
    );
    const uploadRes = await api.addPlates(print.id, uploadFiles);
    latest = uploadRes.print;
    let uploadedIds: string[];
    if (uploadRes.added_plate_ids !== undefined) {
      if (uploadRes.added_plate_ids.length !== newItems.length) {
        throw new Error("The server did not confirm every uploaded model file.");
      }
      uploadedIds = uploadRes.added_plate_ids;
    } else {
      uploadedIds = uploads.map(({ marker }) => {
        const matches = latest.plates.filter((plate) => plate.filename.startsWith(marker));
        if (matches.length !== 1) throw new Error("The server did not confirm every uploaded model file.");
        return matches[0].id;
      });
    }
    let nextUploaded = 0;
    stagedItems = stagedItems.map((item) => {
      if (item.kind === "existing") return item;
      const uploadedId = uploadedIds[nextUploaded++];
      if (!uploadedId) throw new Error("The server did not confirm every uploaded model file.");
      const uploaded = latest.plates.find((plate) => plate.id === uploadedId);
      return {
        kind: "existing",
        id: uploadedId,
        filename: item.filename,
        filenameEdited: !uploaded || uploaded.filename !== item.filename,
        folder: uploaded?.folder ?? null,
      };
    });
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
