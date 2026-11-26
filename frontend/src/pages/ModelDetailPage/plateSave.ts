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

  const newFiles = stagedItems.filter((item) => item.kind === "new").map((item) => item.file);
  if (newFiles.length) {
    const beforeIds = new Set(latest.plates.map((plate) => plate.id));
    const uploadRes = await api.addPlates(print.id, newFiles);
    latest = uploadRes.print;
    const uploadedPlates = latest.plates
      .filter((plate) => !beforeIds.has(plate.id))
      .toSorted((a, b) => a.position - b.position);
    let nextUploaded = 0;
    stagedItems = stagedItems.map((item) => {
      if (item.kind === "existing") return item;
      const uploaded = uploadedPlates[nextUploaded++];
      if (!uploaded) throw new Error("Could not match an uploaded model file to its saved plate.");
      return {
        kind: "existing",
        id: uploaded.id,
        filename: item.filename,
        filenameEdited: uploaded.filename !== item.filename,
        folder: uploaded.folder ?? null,
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

  const finalOrder = stagedItems.map((item) => {
    if (item.kind === "new") throw new Error("An uploaded model file is missing its saved plate ID.");
    return item.id;
  });
  const reorderRes = await api.reorderPlates(print.id, finalOrder);
  latest = reorderRes.print ?? latest;
  reportProgress();
  return latest;
}
