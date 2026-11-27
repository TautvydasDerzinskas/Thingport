import { describe, expect, it, vi } from "vitest";
import { PlateUploadCapabilityError, PlateUploadOutcomeUnknownError, type Plate, type Print } from "../../api/prints";
import { normalizeFileName } from "../../utils/fileNames.generated";
import {
  PlateUploadConfirmationError,
  savePlateChanges,
  type PlateItem,
  type PlateSaveApi,
  type PlateSaveProgress,
} from "./plateSave";

const plate = (id: string, filename: string, position: number): Plate => ({
  id,
  print_id: "model",
  position,
  filename,
  mime: "model/stl",
  size: 1,
  url: `/print/model/plate/${id}/file/${filename}`,
});
const print = (...plates: Plate[]): Print => ({
  id: "model",
  name: "Model",
  created_at: "2026-01-01T00:00:00.000Z",
  tags: [],
  plates,
  preview_images: [],
  supporting_file_count: 0,
  view_count: 0,
  print_count: 0,
  is_favorite: false,
});

describe("savePlateChanges", () => {
  it("reconciles successful files from a partially failed batch before retrying", async () => {
    const original = plate("original", "base.3mf", 0);
    const firstMarker = "thingport-upload-first-one.3mf";
    const secondMarker = "thingport-upload-second-two.3mf";
    const afterPartialUpload = print(original, plate("uploaded-one", firstMarker, 1));
    const afterUpload = print(original, plate("uploaded-one", firstMarker, 1), plate("uploaded-two", secondMarker, 2));
    const afterRename = print(original, plate("uploaded-one", "one.3mf", 1), plate("uploaded-two", "two.3mf", 2));
    const afterReorder = print(plate("uploaded-one", "one.3mf", 0), plate("uploaded-two", "two.3mf", 1), original);
    let uploadAttempts = 0;
    let reconciliationAttempts = 0;
    const uploadedFileNames: string[][] = [];
    const api: PlateSaveApi = {
      get: vi.fn<PlateSaveApi["get"]>(async () => {
        if (reconciliationAttempts++ === 0) throw new Error("temporary lookup failure");
        return afterPartialUpload;
      }),
      addPlates: vi.fn<PlateSaveApi["addPlates"]>(async (_printId, files) => {
        uploadedFileNames.push(files.map((file) => file.name));
        if (uploadAttempts++ === 0) {
          throw new Error("batch upload failed");
        }
        return { print: afterUpload, added_plate_ids: ["uploaded-two"] };
      }),
      supportsIdempotentPlateUploads: vi.fn<PlateSaveApi["supportsIdempotentPlateUploads"]>(async () => false),
      deletePlate: vi.fn<PlateSaveApi["deletePlate"]>(),
      renamePlate: vi.fn<PlateSaveApi["renamePlate"]>(async () => ({ print: afterRename })),
      reorderPlates: vi.fn<PlateSaveApi["reorderPlates"]>(async (_printId, plateIds) => {
        expect(plateIds).toEqual(["uploaded-one", "uploaded-two", "original"]);
        return { print: afterReorder };
      }),
    };
    const items: PlateItem[] = [
      { kind: "new", localId: "first", file: new File(["one"], "one.3mf"), filename: "one.3mf" },
      { kind: "new", localId: "second", file: new File(["two"], "two.3mf"), filename: "two.3mf" },
    ];
    let progress: PlateSaveProgress = { print: print(original), items, removedPlateIds: new Set() };
    const onProgress = (next: PlateSaveProgress) => {
      progress = next;
    };

    await expect(
      savePlateChanges(progress.print, progress.items, progress.removedPlateIds, api, onProgress),
    ).rejects.toBeInstanceOf(PlateUploadConfirmationError);

    expect(progress.items).toEqual([
      {
        kind: "new",
        localId: "first",
        file: expect.any(File),
        filename: "one.3mf",
        uploadAttempted: true,
        uploadOutcomeUnknown: false,
      },
      {
        kind: "new",
        localId: "second",
        file: expect.any(File),
        filename: "two.3mf",
        uploadAttempted: true,
        uploadOutcomeUnknown: false,
      },
    ]);

    await savePlateChanges(progress.print, progress.items, progress.removedPlateIds, api, onProgress);

    expect(api.addPlates).toHaveBeenCalledTimes(2);
    expect(uploadedFileNames).toEqual([[firstMarker, secondMarker], [secondMarker]]);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("keeps an uncertain upload pending on servers without idempotent retry support", async () => {
    const original = plate("original", "base.3mf", 0);
    const uploadName = "thingport-upload-pending-upload-part.3mf";
    const initial = print(original);
    const afterUpload = print(original, plate("uploaded", uploadName, 1));
    const afterRename = print(original, plate("uploaded", "part.3mf", 1));
    const afterReorder = print(original, plate("uploaded", "part.3mf", 1));
    let lookupAttempts = 0;
    const api: PlateSaveApi = {
      get: vi.fn<PlateSaveApi["get"]>(async () => {
        if (lookupAttempts++ === 0) throw new Error("temporary lookup failure");
        return lookupAttempts === 2 ? initial : afterUpload;
      }),
      addPlates: vi.fn<PlateSaveApi["addPlates"]>(async () => {
        throw new PlateUploadOutcomeUnknownError(new Error("network lost"));
      }),
      supportsIdempotentPlateUploads: vi.fn<PlateSaveApi["supportsIdempotentPlateUploads"]>(async () => false),
      deletePlate: vi.fn<PlateSaveApi["deletePlate"]>(),
      renamePlate: vi.fn<PlateSaveApi["renamePlate"]>(async () => ({ print: afterRename })),
      reorderPlates: vi.fn<PlateSaveApi["reorderPlates"]>(async () => ({ print: afterReorder })),
    };
    const items: PlateItem[] = [
      { kind: "new", localId: "pending-upload", file: new File(["model"], "part.3mf"), filename: "part.3mf" },
    ];
    let progress: PlateSaveProgress = { print: initial, items, removedPlateIds: new Set() };
    const onProgress = (next: PlateSaveProgress) => {
      progress = next;
    };

    await expect(
      savePlateChanges(progress.print, progress.items, progress.removedPlateIds, api, onProgress),
    ).rejects.toBeInstanceOf(PlateUploadConfirmationError);

    await expect(
      savePlateChanges(progress.print, progress.items, progress.removedPlateIds, api, onProgress),
    ).rejects.toBeInstanceOf(PlateUploadConfirmationError);
    expect(api.addPlates).toHaveBeenCalledTimes(1);

    await savePlateChanges(progress.print, progress.items, progress.removedPlateIds, api, onProgress);

    expect(api.addPlates).toHaveBeenCalledTimes(1);
    expect(api.supportsIdempotentPlateUploads).toHaveBeenCalledExactlyOnceWith("model");
    expect(progress.items).toEqual([
      { kind: "existing", id: "uploaded", filename: "part.3mf", filenameEdited: false, folder: null },
    ]);
  });

  it("keeps reconciled uploads when checking retry support for another file fails", async () => {
    const initial = print(plate("original", "base.3mf", 0));
    const afterUpload = print(...initial.plates, plate("uploaded", "thingport-upload-first-first.3mf", 1));
    const capabilityError = new PlateUploadCapabilityError(new Error("gateway failure"));
    const api = {
      get: vi.fn<PlateSaveApi["get"]>().mockResolvedValue(afterUpload),
      addPlates: vi.fn<PlateSaveApi["addPlates"]>(),
      supportsIdempotentPlateUploads: vi
        .fn<PlateSaveApi["supportsIdempotentPlateUploads"]>()
        .mockRejectedValue(capabilityError),
      deletePlate: vi.fn<PlateSaveApi["deletePlate"]>(),
      renamePlate: vi.fn<PlateSaveApi["renamePlate"]>(),
      reorderPlates: vi.fn<PlateSaveApi["reorderPlates"]>(),
    };
    const items: PlateItem[] = ["first", "second"].map((localId) => ({
      kind: "new",
      localId,
      file: new File(["model"], `${localId}.3mf`),
      filename: `${localId}.3mf`,
      uploadAttempted: true,
      uploadOutcomeUnknown: true,
    }));
    const onProgress = vi.fn<(progress: PlateSaveProgress) => void>();

    await expect(savePlateChanges(initial, items, new Set(), api, onProgress)).rejects.toBe(capabilityError);

    expect(onProgress).toHaveBeenLastCalledWith({
      print: afterUpload,
      items: [
        { kind: "existing", id: "uploaded", filename: "first.3mf", filenameEdited: true, folder: null },
        items[1],
      ],
      removedPlateIds: new Set(),
    });
    expect(api.supportsIdempotentPlateUploads).toHaveBeenCalledExactlyOnceWith("model");
    expect(api.addPlates).not.toHaveBeenCalled();
  });

  it("retries an uncertain upload with the same id even after a live upload conflict", async () => {
    const original = plate("original", "base.3mf", 0);
    const uploadName = "thingport-upload-safe-retry-part.3mf";
    const initial = print(original);
    const afterUpload = print(original, plate("uploaded", uploadName, 1));
    const afterRename = print(original, plate("uploaded", "part.3mf", 1));
    const afterReorder = print(original, plate("uploaded", "part.3mf", 1));
    const uploadedNames: string[] = [];
    const api: PlateSaveApi = {
      get: vi.fn<PlateSaveApi["get"]>(async () => initial),
      addPlates: vi.fn<PlateSaveApi["addPlates"]>(async (_printId, files) => {
        uploadedNames.push(files[0].name);
        if (uploadedNames.length === 1) {
          throw new PlateUploadOutcomeUnknownError(new Error("network lost"));
        }
        if (uploadedNames.length === 2) {
          throw new PlateUploadOutcomeUnknownError(new Error("The matching plate upload is still processing"));
        }
        return { print: afterUpload, added_plate_ids: ["uploaded"] };
      }),
      supportsIdempotentPlateUploads: vi.fn<PlateSaveApi["supportsIdempotentPlateUploads"]>(async () => true),
      deletePlate: vi.fn<PlateSaveApi["deletePlate"]>(),
      renamePlate: vi.fn<PlateSaveApi["renamePlate"]>(async () => ({ print: afterRename })),
      reorderPlates: vi.fn<PlateSaveApi["reorderPlates"]>(async () => ({ print: afterReorder })),
    };
    const items: PlateItem[] = [
      { kind: "new", localId: "safe-retry", file: new File(["model"], "part.3mf"), filename: "part.3mf" },
    ];
    let progress: PlateSaveProgress = { print: initial, items, removedPlateIds: new Set() };
    const onProgress = (next: PlateSaveProgress) => {
      progress = next;
    };

    await expect(
      savePlateChanges(progress.print, progress.items, progress.removedPlateIds, api, onProgress),
    ).rejects.toBeInstanceOf(PlateUploadConfirmationError);

    await expect(
      savePlateChanges(progress.print, progress.items, progress.removedPlateIds, api, onProgress),
    ).rejects.toBeInstanceOf(PlateUploadConfirmationError);
    expect(progress.items[0]).toMatchObject({ kind: "new", uploadAttempted: true, uploadOutcomeUnknown: true });

    await savePlateChanges(progress.print, progress.items, progress.removedPlateIds, api, onProgress);

    expect(api.addPlates).toHaveBeenCalledTimes(3);
    expect(uploadedNames).toEqual([uploadName, uploadName, uploadName]);
    expect(api.supportsIdempotentPlateUploads).toHaveBeenCalledTimes(2);
    expect(progress.items).toEqual([
      { kind: "existing", id: "uploaded", filename: "part.3mf", filenameEdited: false, folder: null },
    ]);
  });

  it("tracks legacy upload responses by request-specific filename when a concurrent plate is present", async () => {
    const original = plate("original", "base.3mf", 0);
    const concurrent = plate("concurrent", "parallel.3mf", 1);
    const uploadName = "thingport-upload-legacy-upload-part.3mf";
    const uploaded = plate("uploaded", uploadName, 2);
    const initial = print(original);
    const afterUpload = print(original, concurrent, uploaded);
    const afterRename = print(original, concurrent, plate("uploaded", "part.3mf", 2));
    const afterReorder = print(plate("uploaded", "part.3mf", 0), original, concurrent);
    let reorderAttempts = 0;
    const api: PlateSaveApi = {
      get: vi.fn<PlateSaveApi["get"]>(async () => initial),
      addPlates: vi.fn<PlateSaveApi["addPlates"]>(async (_printId, files) => {
        expect(files.map((file) => file.name)).toEqual([uploadName]);
        return { print: afterUpload };
      }),
      supportsIdempotentPlateUploads: vi.fn<PlateSaveApi["supportsIdempotentPlateUploads"]>(async () => false),
      deletePlate: vi.fn<PlateSaveApi["deletePlate"]>(),
      renamePlate: vi.fn<PlateSaveApi["renamePlate"]>(async () => ({ print: afterRename })),
      reorderPlates: vi.fn<PlateSaveApi["reorderPlates"]>(async (_printId, plateIds) => {
        expect(plateIds).toEqual(["uploaded", "original", "concurrent"]);
        if (reorderAttempts++ === 0) throw new Error("temporary failure");
        return { print: afterReorder };
      }),
    };
    const items: PlateItem[] = [
      { kind: "new", localId: "legacy-upload", file: new File(["model"], "part.3mf"), filename: "part.3mf" },
    ];
    let progress: PlateSaveProgress = { print: initial, items, removedPlateIds: new Set() };
    const onProgress = (next: PlateSaveProgress) => {
      progress = next;
    };

    await expect(
      savePlateChanges(progress.print, progress.items, progress.removedPlateIds, api, onProgress),
    ).rejects.toThrow("temporary failure");

    expect(progress.items).toEqual([
      { kind: "existing", id: "uploaded", filename: "part.3mf", filenameEdited: false, folder: null },
    ]);

    await savePlateChanges(progress.print, progress.items, progress.removedPlateIds, api, onProgress);

    expect(api.addPlates).toHaveBeenCalledTimes(1);
    expect(api.renamePlate).toHaveBeenCalledWith("model", "uploaded", "part.3mf");
  });

  it("does not repeat uploads, deletions, or renames after a later save step fails", async () => {
    const oldPlate = plate("old", "part.3mf", 0);
    const stalePlate = plate("deleted-elsewhere", "stale.3mf", 1);
    const concurrentPlate = plate("concurrent", "parallel.3mf", 1);
    const savedUpload = plate("uploaded", "part (2).3mf", 2);
    const initial = print(oldPlate, stalePlate);
    const afterUpload = print(oldPlate, concurrentPlate, savedUpload);
    const afterDelete = print(plate("concurrent", "parallel.3mf", 0), plate("uploaded", savedUpload.filename, 1));
    const afterRename = print(plate("concurrent", "parallel.3mf", 0), plate("uploaded", "part.3mf", 1));
    const afterReorder = print(plate("uploaded", "part.3mf", 0), plate("concurrent", "parallel.3mf", 1));
    let reorderAttempts = 0;
    const api: PlateSaveApi = {
      get: vi.fn<PlateSaveApi["get"]>(async () => initial),
      addPlates: vi.fn<PlateSaveApi["addPlates"]>(async (_printId, _files) => ({
        print: afterUpload,
        added_plate_ids: ["uploaded"],
      })),
      supportsIdempotentPlateUploads: vi.fn<PlateSaveApi["supportsIdempotentPlateUploads"]>(async () => false),
      deletePlate: vi.fn<PlateSaveApi["deletePlate"]>(async (_printId, _plateId) => ({ print: afterDelete })),
      renamePlate: vi.fn<PlateSaveApi["renamePlate"]>(async (_printId, _plateId, _filename) => ({
        print: afterRename,
      })),
      reorderPlates: vi.fn<PlateSaveApi["reorderPlates"]>(async (_printId, plateIds) => {
        expect(plateIds).toEqual(["uploaded", "concurrent"]);
        if (reorderAttempts++ === 0) throw new Error("temporary failure");
        return { print: afterReorder };
      }),
    };
    const items: PlateItem[] = [
      { kind: "existing", id: "deleted-elsewhere", filename: "stale.3mf", filenameEdited: false, folder: null },
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
      { kind: "existing", id: "deleted-elsewhere", filename: "stale.3mf", filenameEdited: false, folder: null },
      { kind: "existing", id: "uploaded", filename: "part.3mf", filenameEdited: false, folder: null },
    ]);
    expect(progress.removedPlateIds).toEqual(new Set());

    await savePlateChanges(progress.print, progress.items, progress.removedPlateIds, api, onProgress);

    expect(api.addPlates).toHaveBeenCalledTimes(1);
    expect(api.deletePlate).toHaveBeenCalledTimes(1);
    expect(api.renamePlate).toHaveBeenCalledTimes(1);
    expect(api.reorderPlates).toHaveBeenCalledTimes(2);
    expect(api.renamePlate).toHaveBeenCalledWith("model", "uploaded", "part.3mf");
  });

  it("skips a completed deletion whose response was lost", async () => {
    const original = plate("original", "base.3mf", 0);
    const removed = plate("removed", "extra.3mf", 1);
    const initial = print(original, removed);
    const afterDelete = print(original);
    const get = vi.fn<PlateSaveApi["get"]>().mockResolvedValueOnce(initial).mockResolvedValueOnce(afterDelete);
    const api: PlateSaveApi = {
      get,
      addPlates: vi.fn<PlateSaveApi["addPlates"]>(),
      supportsIdempotentPlateUploads: vi.fn<PlateSaveApi["supportsIdempotentPlateUploads"]>(),
      deletePlate: vi.fn<PlateSaveApi["deletePlate"]>().mockRejectedValueOnce(new Error("response lost")),
      renamePlate: vi.fn<PlateSaveApi["renamePlate"]>(),
      reorderPlates: vi.fn<PlateSaveApi["reorderPlates"]>().mockResolvedValue({ print: afterDelete }),
    };
    const items: PlateItem[] = [
      { kind: "existing", id: original.id, filename: original.filename, filenameEdited: false, folder: null },
    ];
    let progress: PlateSaveProgress = { print: initial, items, removedPlateIds: new Set([removed.id]) };
    const onProgress = (next: PlateSaveProgress) => {
      progress = next;
    };

    await expect(savePlateChanges(initial, items, progress.removedPlateIds, api, onProgress)).rejects.toThrow(
      "response lost",
    );
    expect(progress.removedPlateIds).toEqual(new Set([removed.id]));

    await expect(savePlateChanges(initial, items, progress.removedPlateIds, api, onProgress)).resolves.toEqual(
      afterDelete,
    );
    expect(get).toHaveBeenCalledTimes(2);
    expect(api.deletePlate).toHaveBeenCalledExactlyOnceWith("model", removed.id);
    expect(api.reorderPlates).toHaveBeenCalledExactlyOnceWith("model", [original.id]);
    expect(progress.removedPlateIds.size).toBe(0);
  });
});

describe("dependent plate renames", () => {
  function renameFixture(plates: Plate[]) {
    let current = print(...plates);
    const api = {
      get: vi.fn<PlateSaveApi["get"]>(),
      addPlates: vi.fn<PlateSaveApi["addPlates"]>(),
      supportsIdempotentPlateUploads: vi.fn<PlateSaveApi["supportsIdempotentPlateUploads"]>(),
      deletePlate: vi.fn<PlateSaveApi["deletePlate"]>(),
      renamePlate: vi.fn<PlateSaveApi["renamePlate"]>(async (_printId, id, filename) => {
        const target = current.plates.find((candidate) => candidate.id === id);
        const normalized = normalizeFileName(filename);
        // The server would number a target still held by a sibling.
        expect(
          current.plates.some(
            (candidate) =>
              candidate.id !== id &&
              candidate.folder === target?.folder &&
              candidate.filename.toLowerCase() === normalized.toLowerCase(),
          ),
        ).toBe(false);
        current = print(
          ...current.plates.map((candidate) =>
            candidate.id === id ? { ...candidate, filename: normalized } : candidate,
          ),
        );
        return { print: current };
      }),
      reorderPlates: vi.fn<PlateSaveApi["reorderPlates"]>(async () => ({ print: current })),
    };
    return { api, initial: current };
  }

  const edited = (id: string, filename: string): PlateItem => ({
    kind: "existing",
    id,
    filename,
    filenameEdited: true,
    folder: null,
  });

  it("frees an edited target before requesting it, using the server's filename rules", async () => {
    const { api, initial } = renameFixture([plate("a", "part.stl", 0), plate("b", "con_.stl", 1)]);
    const items = [edited("a", "  CON.stl... "), edited("b", "new.stl")];

    const result = await savePlateChanges(initial, items, new Set(), api, () => {});

    expect(api.renamePlate.mock.calls).toEqual([
      ["model", "b", "new.stl"],
      ["model", "a", "  CON.stl... "],
    ]);
    expect(result.plates.map((candidate) => candidate.filename)).toEqual(["CON_.stl", "new.stl"]);
  });

  it("resumes a filename swap after moving a plate aside and a later request fails", async () => {
    const { api, initial } = renameFixture([plate("a", "a.gcode.3mf", 0), plate("b", "b.gcode.3mf", 1)]);
    let progress: PlateSaveProgress = {
      print: initial,
      items: [edited("a", "b.gcode.3mf"), edited("b", "a.gcode.3mf")],
      removedPlateIds: new Set(),
    };
    const save = () =>
      savePlateChanges(progress.print, progress.items, progress.removedPlateIds, api, (updated) => {
        progress = updated;
      });
    const rename = api.renamePlate.getMockImplementation();
    expect(rename).toBeDefined();
    if (!rename) throw new Error("Missing rename fixture");
    api.renamePlate.mockImplementationOnce(rename).mockRejectedValueOnce(new Error("temporary failure"));

    await expect(save()).rejects.toThrow("temporary failure");
    expect(progress.items.every((item) => item.kind === "existing" && item.filenameEdited)).toBe(true);
    expect(progress.print.plates[1].filename).toMatch(/^thingport-rename-.*\.gcode\.3mf$/);
    expect(api.reorderPlates).not.toHaveBeenCalled();

    const result = await save();

    expect(api.renamePlate.mock.calls.slice(1)).toEqual([
      ["model", "a", "b.gcode.3mf"],
      ["model", "a", "b.gcode.3mf"],
      ["model", "b", "a.gcode.3mf"],
    ]);
    expect(result.plates.map((candidate) => candidate.filename)).toEqual(["b.gcode.3mf", "a.gcode.3mf"]);
  });
});
