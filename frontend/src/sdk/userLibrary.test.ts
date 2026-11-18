import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreeMfFormat } from "../adapter/format.generated";
import type { Plate, Print, PrintProfile, ProfileFilament, printsApi } from "../api/prints";

const get = vi.fn<(id: string, options?: { record?: boolean }) => Promise<Print>>();
const uploadFile = vi.fn<typeof printsApi.uploadFile>();
const addPlates = vi.fn<typeof printsApi.addPlates>();
vi.mock("../api/prints", () => ({
  PrintApiError: class PrintApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  printsApi: {
    get: (id: string, options?: { record?: boolean }) => get(id, options),
    fileUrl: (url: string) => url,
    uploadFile,
    addPlates,
  },
}));
vi.mock("../api/collections", () => ({ collectionsApi: {} }));
vi.mock("../api/search", () => ({ searchApi: {} }));

const { buildUserLibrary } = await import("./userLibrary");

const plate = (over: Partial<Plate>): Plate => ({
  id: "p",
  print_id: "m1",
  position: 0,
  filename: "part.3mf",
  mime: "model/3mf",
  size: 1,
  url: "/u",
  ...over,
});
const project: ThreeMfFormat = {
  v: 1,
  kind: "prusa",
  app: "PrusaSlicer",
  appVersion: "2.9.0",
  orcaTag: null,
  printer: "Original Prusa MK4",
  nozzle: 0.4,
  filaments: 1,
  filamentList: [{ type: "PETG", color: "#00FF00", brand: "Prusament" }],
  plates: null,
  dialect: null,
};
const profile = (filaments: ProfileFilament[]): PrintProfile => ({
  title: "Site profile",
  description: null,
  origin: "designer",
  creator: null,
  seconds: null,
  grams: null,
  filaments,
  plates: [],
  printer: "P1S",
  nozzle_mm: null,
  layer_mm: null,
  infill: null,
  walls: null,
  supports: null,
});

const model = (plates: Plate[] = []): Print => ({
  id: "m1",
  name: "m",
  title: "M",
  tags: [],
  created_at: "2026-11-17T00:00:00Z",
  plates,
  preview_images: [],
  supporting_file_count: 0,
  view_count: 0,
  print_count: 0,
  is_favorite: false,
});

async function files(plates: Plate[]) {
  get.mockResolvedValue(model(plates));
  return (await buildUserLibrary({ openModel: () => undefined }).models.get("m1")).files;
}

describe("a model's files as a script reads them", () => {
  beforeEach(() => get.mockReset());

  it("says which folder each file is in, as one name can be in two", async () => {
    const [top, a, b] = await files([
      plate({ id: "1" }),
      plate({ id: "2", folder: "A" }),
      plate({ id: "3", folder: "USB C/Handles" }),
    ]);
    expect([top.folder, a.folder, b.folder]).toEqual([null, "A", "USB C/Handles"]);
  });

  it("takes a profile's filaments from the project when the provider gave none", async () => {
    const [file] = await files([plate({ profile_id: "42", profile: profile([]), format: project })]);
    expect(file.profile).toMatchObject({ id: "42", name: "Site profile", printer: "P1S" });
    expect(file.profile?.filaments).toEqual([{ type: "PETG", color: "#00FF00", grams: null, brand: "Prusament" }]);
  });

  it("keeps a profile's own filaments where it has them", async () => {
    const [file] = await files([
      plate({ profile_id: "42", profile: profile([{ type: "PLA", color: "#FF0000", grams: 3 }]), format: project }),
    ]);
    expect(file.profile?.filaments).toEqual([{ type: "PLA", color: "#FF0000", grams: 3, brand: null }]);
  });
});

describe("files a script adds to a model", () => {
  it("keeps the prepared print the first sliced one took, rather than each replacing the one before", async () => {
    uploadFile.mockReset();
    uploadFile.mockImplementation(async (_id, file, options) => {
      // As the server does: a sliced print takes the prepared slot unless asked to keep the one taken.
      const took = /\.(gcode|gcode\.3mf)$/.test(file.name) && !options?.keepPrepared;
      return { print: model(), prepared: took };
    });
    get.mockResolvedValue(model());
    await buildUserLibrary({ openModel: () => undefined }).models.addFiles("m1", [
      { name: "A.gcode.3mf", data: "PK" },
      { name: "notes.txt", data: "n" },
      { name: "B.gcode", data: "G28" },
    ]);
    expect(uploadFile.mock.calls.map(([, file, options]) => [file.name, options?.keepPrepared])).toEqual([
      ["A.gcode.3mf", false],
      ["notes.txt", true],
      ["B.gcode", true],
    ]);
  });

  it("says what went in when a file after the plates fails, so a retry sends only the rest", async () => {
    addPlates.mockReset();
    addPlates.mockResolvedValue({ print: model(), plate_ids: ["p2"] });
    uploadFile.mockReset();
    uploadFile.mockImplementation(async (_id, file) => {
      if (file.name === "big.txt") throw new Error("Related file exceeds size limit");
      return { print: model(), prepared: false };
    });
    const failure = await buildUserLibrary({ openModel: () => undefined })
      .models.addFiles("m1", [
        { name: "part.stl", data: "solid p endsolid" },
        { name: "notes.txt", data: "n" },
        { name: "big.txt", data: "b" },
      ])
      .catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({
      message: "Related file exceeds size limit",
      added: ["part.stl", "notes.txt"],
      keepPrepared: false,
    });
    expect((failure as { model?: { id: string } }).model?.id).toBe(model().id);
  });

  it("keeps the prepared print a call set when the rest is sent with keepPrepared", async () => {
    uploadFile.mockReset();
    uploadFile.mockResolvedValue({ print: model(), prepared: false });
    get.mockResolvedValue(model());
    await buildUserLibrary({ openModel: () => undefined }).models.addFiles("m1", [{ name: "B.gcode", data: "G28" }], {
      keepPrepared: true,
    });
    expect(uploadFile.mock.calls.map(([, file, options]) => [file.name, options?.keepPrepared])).toEqual([
      ["B.gcode", true],
    ]);
  });

  it("rejects with the request's own error when the first file fails, and reads nothing to say so", async () => {
    addPlates.mockReset();
    uploadFile.mockReset();
    get.mockReset();
    const refusal = Object.assign(new Error("Related file exceeds size limit"), { status: 413 });
    uploadFile.mockRejectedValue(refusal);
    const failure = await buildUserLibrary({ openModel: () => undefined })
      .models.addFiles("m1", [{ name: "B.gcode", data: "G28" }], { keepPrepared: true })
      .catch((err: unknown) => err);
    // The same error, with nothing in yet, and the caller's keepPrepared to pass on with the rest.
    expect(failure).toBe(refusal);
    expect(failure).toMatchObject({ added: [], keepPrepared: true });
    expect(failure).not.toHaveProperty("model");
    expect(get).not.toHaveBeenCalled();
  });

  it("leaves keepPrepared off when a sliced print's answer was lost, as sent again first it takes the slot", async () => {
    uploadFile.mockReset();
    get.mockReset();
    uploadFile.mockRejectedValue(new TypeError("Failed to fetch"));
    const failure = await buildUserLibrary({ openModel: () => undefined })
      .models.addFiles("m1", [
        { name: "A.gcode", data: "G28" },
        { name: "B.gcode", data: "G28" },
      ])
      .catch((err: unknown) => err);
    expect(failure).toMatchObject({ message: "Failed to fetch", added: [], keepPrepared: false });
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
  });

  it("says keepPrepared once a sliced print went in, with the model as the last answer had it", async () => {
    uploadFile.mockReset();
    uploadFile.mockImplementation(async (_id, file) => {
      if (file.name === "notes.txt") throw new Error("Internal error");
      return { print: model(), prepared: true };
    });
    const failure = await buildUserLibrary({ openModel: () => undefined })
      .models.addFiles("m1", [
        { name: "A.gcode", data: "G28" },
        { name: "notes.txt", data: "n" },
      ])
      .catch((err: unknown) => err);
    expect(failure).toMatchObject({ added: ["A.gcode"], keepPrepared: true, model: { id: "m1" } });
  });

  it("says nothing went in when the model files' request fails", async () => {
    addPlates.mockReset();
    uploadFile.mockReset();
    addPlates.mockRejectedValue(new Error("Upload failed"));
    const failure = await buildUserLibrary({ openModel: () => undefined })
      .models.addFiles("m1", [
        { name: "part.stl", data: "solid p endsolid" },
        { name: "notes.txt", data: "n" },
      ])
      .catch((err: unknown) => err);
    expect(failure).toMatchObject({ message: "Upload failed", added: [], keepPrepared: false });
    expect(failure).not.toHaveProperty("model");
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("answers with the model read without counting a view when nothing was sent", async () => {
    get.mockReset();
    get.mockResolvedValue(model());
    await buildUserLibrary({ openModel: () => undefined }).models.addFiles("m1", []);
    expect(get).toHaveBeenCalledWith("m1", { record: false });
  });

  it("refuses two different files of one name a .gltf names in a folder of its own, before adding anything", async () => {
    addPlates.mockReset();
    uploadFile.mockReset();
    const scene = JSON.stringify({
      buffers: [{ uri: "data:application/octet-stream;base64,AAAA" }],
      images: [{ uri: "textures/base.png" }],
    });
    const refused = await buildUserLibrary({ openModel: () => undefined })
      .models.addFiles("m1", [
        { name: "scene.gltf", data: scene },
        { name: "base.png", data: "one" },
        { name: "base.png", data: "two" },
      ])
      .catch((err: unknown) => err);
    expect(String(refused)).toContain("base.png");
    expect(addPlates).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("refuses two different files of one name a .gltf could mean, before adding anything", async () => {
    addPlates.mockReset();
    uploadFile.mockReset();
    const scene = (bin: string) => JSON.stringify({ buffers: [{ uri: bin }] });
    const refused = await buildUserLibrary({ openModel: () => undefined })
      .models.addFiles("m1", [
        { name: "a.gltf", data: scene("scene.bin") },
        { name: "scene.bin", data: "aaaa" },
        { name: "b.gltf", data: scene("scene.bin") },
        { name: "scene.bin", data: "bbbb" },
      ])
      .catch((err: unknown) => err);
    expect(String(refused)).toContain("scene.bin");
    expect(addPlates).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
