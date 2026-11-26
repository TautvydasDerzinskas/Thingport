import { describe, expect, it, vi } from "vitest";
import type { Plate, Print } from "../../api/prints";
import { savePlateChanges, type PlateItem, type PlateSaveApi, type PlateSaveProgress } from "./plateSave";

const plate = (id: string, filename: string, position: number) => ({ id, filename, position }) as Plate;
const print = (...plates: Plate[]) => ({ id: "model", plates }) as Print;

describe("savePlateChanges", () => {
  it("does not repeat uploads, deletions, or renames after a later save step fails", async () => {
    const oldPlate = plate("old", "part.3mf", 0);
    const savedUpload = plate("uploaded", "part (2).3mf", 1);
    const initial = print(oldPlate);
    const afterUpload = print(oldPlate, savedUpload);
    const afterDelete = print(savedUpload);
    const afterRename = print(plate("uploaded", "part.3mf", 0));
    let reorderAttempts = 0;
    const api: PlateSaveApi = {
      addPlates: vi.fn<PlateSaveApi["addPlates"]>(async (_printId, _files) => ({ print: afterUpload })),
      deletePlate: vi.fn<PlateSaveApi["deletePlate"]>(async (_printId, _plateId) => ({ print: afterDelete })),
      renamePlate: vi.fn<PlateSaveApi["renamePlate"]>(async (_printId, _plateId, _filename) => ({
        print: afterRename,
      })),
      reorderPlates: vi.fn<PlateSaveApi["reorderPlates"]>(async (_printId, _plateIds) => {
        if (reorderAttempts++ === 0) throw new Error("temporary failure");
        return { print: afterRename };
      }),
    };
    const items: PlateItem[] = [
      { kind: "new", localId: "upload", file: new File(["model"], "part.3mf"), filename: "part.3mf" },
    ];
    let progress: PlateSaveProgress = { print: initial, items, removedPlateIds: new Set(["old"]) };
    const onProgress = (next: PlateSaveProgress) => {
      progress = next;
    };

    await expect(
      savePlateChanges(progress.print, progress.items, progress.removedPlateIds, api, onProgress),
    ).rejects.toThrow("temporary failure");

    expect(progress.items).toEqual([
      { kind: "existing", id: "uploaded", filename: "part.3mf", filenameEdited: false, folder: null },
    ]);
    expect(progress.removedPlateIds).toEqual(new Set());

    await savePlateChanges(progress.print, progress.items, progress.removedPlateIds, api, onProgress);

    expect(api.addPlates).toHaveBeenCalledTimes(1);
    expect(api.deletePlate).toHaveBeenCalledTimes(1);
    expect(api.renamePlate).toHaveBeenCalledTimes(1);
    expect(api.reorderPlates).toHaveBeenCalledTimes(2);
  });
});
