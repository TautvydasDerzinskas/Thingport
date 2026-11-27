import { describe, expect, it, vi } from "vitest";
import { PlateUploadCapabilityError, PlateUploadOutcomeUnknownError, type Plate, type Print } from "../../api/prints";
import { normalizeFileName } from "../../utils/fileNames.generated";
import {
  plateFilenameError,
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

  it("retries a live upload after another editor removes the completed plate from its batch", async () => {
    const initial = print(plate("original", "base.3mf", 0));
    const uploaded = plate("second-plate", "thingport-upload-second-second.3mf", 1);
    const afterUpload = print(...initial.plates, uploaded);
    const afterRename = print(...initial.plates, { ...uploaded, filename: "second.3mf" });
    const api = {
      get: vi.fn<PlateSaveApi["get"]>(),
      getPlateUploadResults: vi.fn<NonNullable<PlateSaveApi["getPlateUploadResults"]>>().mockResolvedValue({
        print: initial,
        upload_results: [{ upload_id: "first", plate_id: "removed-plate" }],
      }),
      addPlates: vi.fn<PlateSaveApi["addPlates"]>().mockResolvedValue({
        print: afterUpload,
        added_plate_ids: ["second-plate"],
      }),
      supportsIdempotentPlateUploads: vi.fn<PlateSaveApi["supportsIdempotentPlateUploads"]>(),
      deletePlate: vi.fn<PlateSaveApi["deletePlate"]>(),
      renamePlate: vi.fn<PlateSaveApi["renamePlate"]>().mockResolvedValue({ print: afterRename }),
      reorderPlates: vi.fn<PlateSaveApi["reorderPlates"]>().mockResolvedValue({ print: afterRename }),
    };
    const items: PlateItem[] = ["first", "second"].map((localId) => ({
      kind: "new",
      localId,
      file: new File(["mesh"], `${localId}.3mf`),
      filename: `${localId}.3mf`,
      uploadAttempted: true,
      uploadOutcomeUnknown: true,
    }));

    const result = await savePlateChanges(initial, items, new Set(), api, () => {});

    expect(api.getPlateUploadResults).toHaveBeenCalledExactlyOnceWith("model", ["first", "second"]);
    expect(api.addPlates).toHaveBeenCalledTimes(1);
    expect(api.addPlates.mock.calls[0][1].map((file) => file.name)).toEqual(["thingport-upload-second-second.3mf"]);
    expect(result.plates.map((candidate) => candidate.id)).toEqual(["original", "second-plate"]);
  });

  it("continues the same update when a lost response is fully confirmed by its receipt", async () => {
    const original = plate("original", "base.3mf", 0);
    const uploaded = plate("uploaded", "thingport-upload-new-part.3mf", 1);
    const initial = print(original);
    const afterUpload = print(original, uploaded);
    const afterDelete = print(uploaded);
    const afterRename = print({ ...uploaded, filename: "part.3mf", position: 0 });
    const api = {
      get: vi.fn<PlateSaveApi["get"]>().mockResolvedValue(initial),
      getPlateUploadResults: vi.fn<NonNullable<PlateSaveApi["getPlateUploadResults"]>>().mockResolvedValue({
        print: afterUpload,
        upload_results: [{ upload_id: "new", plate_id: "uploaded" }],
      }),
      addPlates: vi
        .fn<PlateSaveApi["addPlates"]>()
        .mockRejectedValue(new PlateUploadOutcomeUnknownError("response lost")),
      supportsIdempotentPlateUploads: vi.fn<PlateSaveApi["supportsIdempotentPlateUploads"]>(),
      deletePlate: vi.fn<PlateSaveApi["deletePlate"]>().mockResolvedValue({ print: afterDelete }),
      renamePlate: vi.fn<PlateSaveApi["renamePlate"]>().mockResolvedValue({ print: afterRename }),
      reorderPlates: vi.fn<PlateSaveApi["reorderPlates"]>().mockResolvedValue({ print: afterRename }),
    };
    const items: PlateItem[] = [
      { kind: "new", localId: "new", file: new File(["mesh"], "part.3mf"), filename: "part.3mf" },
    ];

    await expect(savePlateChanges(initial, items, new Set(["original"]), api, () => {})).resolves.toEqual(afterRename);

    expect(api.addPlates).toHaveBeenCalledTimes(1);
    expect(api.getPlateUploadResults).toHaveBeenCalledExactlyOnceWith("model", ["new"]);
    expect(api.deletePlate).toHaveBeenCalledExactlyOnceWith("model", "original");
    expect(api.renamePlate).toHaveBeenCalledExactlyOnceWith("model", "uploaded", "part.3mf");
    expect(api.reorderPlates).toHaveBeenCalledExactlyOnceWith("model", ["uploaded"]);
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
      renamePlates: vi.fn<NonNullable<PlateSaveApi["renamePlates"]>>(async (_printId, renames) => {
        const names = new Map(renames.map(({ plate_id, filename }) => [plate_id, filename]));
        current = print(
          ...current.plates.map((candidate) => ({
            ...candidate,
            filename: names.get(candidate.id) ?? candidate.filename,
          })),
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

  it("sends a rename when a stale snapshot already shows the requested filename", async () => {
    const { api } = renameFixture([plate("a", "changed-elsewhere.stl", 0)]);
    const stale = print(plate("a", "target.stl", 0));

    const result = await savePlateChanges(stale, [edited("a", "target.stl")], new Set(), api, () => {});

    expect(api.renamePlate).toHaveBeenCalledExactlyOnceWith("model", "a", "target.stl");
    expect(result.plates[0].filename).toBe("target.stl");
  });

  it("retries both names together after a failed swap without staging a temporary filename", async () => {
    const { api, initial } = renameFixture([plate("a", "a.gcode.3mf", 0), plate("b", "b.gcode.3mf", 1)]);
    const items = [edited("a", "b.gcode.3mf"), edited("b", "a.gcode.3mf")];
    let progress: PlateSaveProgress = { print: initial, items, removedPlateIds: new Set() };
    const save = () =>
      savePlateChanges(progress.print, progress.items, progress.removedPlateIds, api, (updated) => {
        progress = updated;
      });
    api.renamePlates.mockRejectedValueOnce(new Error("temporary failure"));

    await expect(save()).rejects.toThrow("temporary failure");
    expect(progress.print).toBe(initial);
    expect(progress.items).toBe(items);
    expect(api.renamePlate).not.toHaveBeenCalled();
    expect(api.reorderPlates).not.toHaveBeenCalled();

    const result = await save();

    expect(api.renamePlates).toHaveBeenCalledTimes(2);
    expect(api.renamePlates).toHaveBeenNthCalledWith(2, "model", [
      { plate_id: "a", filename: "b.gcode.3mf" },
      { plate_id: "b", filename: "a.gcode.3mf" },
    ]);
    expect(result.plates.map((candidate) => candidate.filename)).toEqual(["b.gcode.3mf", "a.gcode.3mf"]);
  });
});

describe("plateFilenameError", () => {
  it.each([
    ["part.3mf", " ", "required"],
    ["part.3mf", "  part...  ", "extension"],
    ["part.3mf", "renamed.gcode.3mf", "extension"],
    ["part.gcode.3mf", "renamed.3mf", "extension"],
    ["part.gcode.3mf", "  renamed.GCODE.3MF... ", undefined],
    ["extensionless", "renamed", undefined],
  ])("validates the normalized extension of %s renamed to %s", (original, filename, expected) => {
    expect(plateFilenameError(filename, original)).toBe(expected);
  });
});
