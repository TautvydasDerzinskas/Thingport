import { describe, expect, it, vi } from "vitest";
import path from "node:path";

// MakerOnline's own resolution is beside the point here: this is about which of the files Grab signed reach the
// model, and what each one reaches it as.
vi.mock("../src/providers/makeronline/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/providers/makeronline/api")>()),
  resolveMakeronlineModel: async () => ({
    meta: { title: "Cable box" },
    galleryImages: [],
    profiles: [{ id: "77", title: "0.4 nozzle" }],
    modelFiles: [],
  }),
}));

import { makeronlineImport } from "../src/providers/makeronline";
import { MULTI_FILE_PLATE_EXTS } from "../src/services/importService";
import { PARAMETRIC_SOURCE_EXTS } from "../src/config";
import type { ImportResult, PipelineKit } from "../src/providers/types";
import type { NewPlateInput } from "../src/services/printCreation";

const SOURCE = { provider: "makeronline", externalId: "38684" };
const extOf = (name: string) => path.extname(name).toLowerCase();

/**
 * A kit that unpacks each signed link into the names given, and records what it was asked to make a print of
 * instead of making one. The two predicates are the pipeline's own, so a file counts here as it would there.
 */
function stubKit(unpacked: Record<string, string[]>) {
  const createPrint = vi.fn<PipelineKit["createPrint"]>(async () => ({}) as ImportResult);
  const addProfiles = vi.fn<PipelineKit["addProfiles"]>(async () => ({}) as ImportResult);
  const kit = {
    downloadSignedFile: async (file: { url: string; name: string }): Promise<NewPlateInput[]> =>
      (unpacked[file.name] ?? []).map((filename) => ({ filename, tempFilePath: `/tmp/absent-${filename}` })),
    isModelFile: (name: string) => MULTI_FILE_PLATE_EXTS.has(extOf(name)),
    isImportableFile: (name: string) =>
      MULTI_FILE_PLATE_EXTS.has(extOf(name)) || PARAMETRIC_SOURCE_EXTS.has(extOf(name)),
    createPrint,
    addProfiles,
    profileDetails: () => ({ titles: {}, covers: {} }),
  } as unknown as PipelineKit;
  return { kit, createPrint, addProfiles };
}

const signed = (files: { name: string; profile_id: string | null }[]) => ({
  url: "https://www.makeronline.com/en/model/38684",
  resolved_files: files.map((file) => ({ url: `https://www.makeronline.com/dl/${file.name}`, ...file })),
});

/** The files the import would have made the print of, in order, each with the profile it is tagged with. */
async function downloadedBy(
  unpacked: Record<string, string[]>,
  files: { name: string; profile_id: string | null }[],
): Promise<[string, string | null][]> {
  const { kit, createPrint } = stubKit(unpacked);
  await makeronlineImport.importModel("user-1", SOURCE, signed(files) as never, kit);
  return createPrint.mock.calls[0][4].map((input) => [input.filename, input.sourceInstanceId ?? null]);
}

describe("MakerOnline's signed files", () => {
  it("keeps a generator script a profile's zip came with, as the model's rather than the profile's", async () => {
    // The script describes the model, not this one printer's slicing of it, and the pipeline keeps an untagged
    // script as a supporting file -- tagged, addProfiles would make a plate of it instead.
    const downloaded = await downloadedBy({ "profile-77.zip": ["cable-box.3mf", "cable-box.scad"] }, [
      { name: "profile-77.zip", profile_id: "77" },
    ]);

    expect(downloaded).toEqual([
      ["cable-box.3mf", "77"],
      ["cable-box.scad", null],
    ]);
  });

  it("still drops everything else a profile's zip came with", async () => {
    const downloaded = await downloadedBy({ "profile-77.zip": ["cable-box.3mf", "readme.txt", "cover.png"] }, [
      { name: "profile-77.zip", profile_id: "77" },
    ]);

    expect(downloaded).toEqual([["cable-box.3mf", "77"]]);
  });

  it("takes one plate from a profile, however many model files its zip held", async () => {
    // A profile is one printer's 3MF; a second would come in as another plate of the same profile.
    const downloaded = await downloadedBy({ "profile-77.zip": ["cable-box.3mf", "lid.3mf", "cable-box.scad"] }, [
      { name: "profile-77.zip", profile_id: "77" },
    ]);

    expect(downloaded).toEqual([
      ["cable-box.3mf", "77"],
      ["cable-box.scad", null],
    ]);
  });

  it("leaves a model's own files untagged, scripts among them", async () => {
    const downloaded = await downloadedBy({ "files.zip": ["cable-box.stl", "cable-box.scad"] }, [
      { name: "files.zip", profile_id: null },
    ]);

    expect(downloaded).toEqual([
      ["cable-box.stl", null],
      ["cable-box.scad", null],
    ]);
  });

  it("hands a re-import's script to the pipeline untagged, so it isn't taken for a plate", async () => {
    // addProfiles makes a plate of every input it is tagged for; the script has to arrive as the model's, and
    // the pipeline keeps it beside the model as a supporting file instead.
    const { kit, addProfiles } = stubKit({ "profile-78.zip": ["cable-box-draft.3mf", "cable-box.scad"] });
    const existing = {
      print: { id: "print-1", userId: "user-1", sourceExternalId: SOURCE.externalId },
      plates: [{ sourceInstanceId: "77" }],
    };

    await makeronlineImport.addToExisting(
      existing as never,
      signed([{ name: "profile-78.zip", profile_id: "78" }]) as never,
      kit,
    );

    expect(addProfiles.mock.calls[0][1].map((input) => [input.filename, input.sourceInstanceId ?? null])).toEqual([
      ["cable-box-draft.3mf", "78"],
      ["cable-box.scad", null],
    ]);
  });

  it("keeps the script a profile brought even when the model's own files bring none", async () => {
    const downloaded = await downloadedBy(
      {
        "profile-77.zip": ["cable-box.3mf", "cable-box.scad"],
        "profile-78.zip": ["cable-box-draft.3mf", "cable-box.scad"],
      },
      [
        { name: "profile-77.zip", profile_id: "77" },
        { name: "profile-78.zip", profile_id: "78" },
      ],
    );

    // Both profiles' plates, and the script once for each profile that carried it: identical copies under one
    // name, which keepGeneratorScripts stores the first of and skips the rest.
    expect(downloaded).toEqual([
      ["cable-box.3mf", "77"],
      ["cable-box.scad", null],
      ["cable-box-draft.3mf", "78"],
      ["cable-box.scad", null],
    ]);
  });
});
