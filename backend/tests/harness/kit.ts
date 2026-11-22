import fs from "node:fs";
import path from "node:path";
import type { Express } from "express";
import { afterAll, beforeAll } from "vitest";
import type { DescriptionImage, Plate, PreviewImage, Print, PrintFile } from "@prisma/client";
import { STORAGE } from "../../src/config";
import { prisma } from "../../src/db";
import { saveDescriptionImage } from "../../src/services/descriptionImageService";
import { setOwnerLicense } from "../../src/services/licenseService";
import { addPreviewImage } from "../../src/services/previewImageService";
import { createPrint } from "../../src/services/printCreation";
import { saveFileFromTemp } from "../../src/services/printFileService";
import {
  getLicenseFiles,
  getPreviewMode,
  setLicenseFiles,
  setPreviewMode,
  type PreviewMode,
} from "../../src/services/settingsService";
import { nonce, register, uniqueImage } from "../helpers/fileReuse";
import { contentOf } from "../intake/files";
import type { Scope } from "./invariants";
import { hits, pauseAt, reached, track } from "./lifecycle";

// The users and models a storage test works on, made through the services the routes call, each file's bytes its own:
// no two files of a run look alike, so a test can tell which one it got. One kit per test file, made at its top.

export type KitUser = { id: string; token: string; auth: { Authorization: string } };
/** A file by its name, or with the folder its model keeps it in and the bytes it holds. */
export type FileSpec = string | { name: string; folder?: string; bytes?: Buffer };
export type ModelSpec = {
  /** Default ["Part.stl"]. Bytes made from each name (tests/intake/files.ts), apart for every model. */
  plates?: FileSpec[];
  supporting?: FileSpec[];
  /** Saved as the model's prepared print. */
  prepared?: FileSpec;
  /** A licence's id ("CC-BY-4.0"), as its owner picks one, which writes LICENSE.txt. */
  license?: string;
  /** How many photos its gallery has. */
  gallery?: number;
  descriptionImages?: number;
};
export type KitModel = {
  print: Print;
  plates: (Plate & { bytes: Buffer })[];
  /** Supporting files, then the prepared print, then LICENSE.txt. */
  files: (PrintFile & { bytes: Buffer })[];
  previewImages: PreviewImage[];
  descriptionImages: DescriptionImage[];
};
export type ToolModel = KitModel & { sources: { path: string; bytes: Buffer }[] };

export type StorageKit = {
  /** A new user, registered as a person would be; in scope() from now on. */
  user(): Promise<KitUser>;
  model(owner: KitUser, spec?: ModelSpec): Promise<KitModel>;
  /** A model a tool brought, as toolsService's giveModelTo makes one: its plate reads the tool's own file, under
   *  storage/tools/, and nothing is placed at the plate's path. */
  toolModel(owner: KitUser): Promise<ToolModel>;
  /** Every user this kit made. */
  scope(): Scope;
  /** `n` bytes (64 by default) no other file of the run has. */
  distinctBytes(n?: number): Buffer;
  nonce(): string;
  /** A folder of this suite's beside the storage folder, on its disk so a file there can be linked into it; removed
   *  when the suite ends. It isn't a storage root: that's fixed when config.ts is first loaded. */
  tempStorage(): string;
  /** Starts `op` now, and tracks it: a pause it's parked at when the test ends is undone, and the end waits for it. */
  start<T>(op: () => PromiseLike<T>): Promise<T>;
  /** Waits for every operation start() began. */
  settleAll(): Promise<void>;
  pauseAt: typeof pauseAt;
  reached: typeof reached;
  hits: typeof hits;
};

const specOf = (file: FileSpec) => (typeof file === "string" ? { name: file } : file);

export function useStorageKit(app: Express): StorageKit {
  const userIds: string[] = [];
  const tools: { id: string; dir: string }[] = [];
  const started: Promise<unknown>[] = [];
  let scratch: string | null = null;
  let before: { previewMode: PreviewMode; licenseFiles: boolean } | null = null;

  beforeAll(async () => {
    before = { previewMode: await getPreviewMode(), licenseFiles: await getLicenseFiles() };
    // Nothing waits for the previews a new plate starts (printCreation's thumbnailAndSniff), which land in the
    // model's folder after the request has answered: off, so the disk a test reads is the one its requests left.
    await setPreviewMode("disabled");
    // Instance-wide, and another suite may have turned it off: on, so a model with a licence has its LICENSE.txt.
    await setLicenseFiles(true);
  });

  afterAll(async () => {
    if (before) {
      await setPreviewMode(before.previewMode);
      await setLicenseFiles(before.licenseFiles);
    }
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    // The tools are the kit's own: they go with their models, so no row is left pointing at a file that's gone.
    const toolIds = tools.map((tool) => tool.id);
    await prisma.print.deleteMany({ where: { toolId: { in: toolIds } } });
    await prisma.tool.deleteMany({ where: { id: { in: toolIds } } });
    for (const tool of tools) fs.rmSync(tool.dir, { recursive: true, force: true });
  });

  const tempStorage = () => {
    scratch ??= fs.mkdtempSync(path.join(path.dirname(STORAGE), `${path.basename(STORAGE)}-kit-`));
    return scratch;
  };
  /** `bytes` in a temp file, as an upload arrives. */
  const tempFile = (bytes: Buffer) => {
    const file = path.join(tempStorage(), `upload-${nonce()}`);
    fs.writeFileSync(file, bytes);
    return file;
  };

  async function model(owner: KitUser, spec: ModelSpec = {}): Promise<KitModel> {
    const seed = nonce();
    const bytesOf = async (file: { name: string; bytes?: Buffer }) => file.bytes ?? contentOf(file.name, seed);
    const plateSpecs = (spec.plates ?? ["Part.stl"]).map(specOf);
    const plateBytes = await Promise.all(plateSpecs.map(bytesOf));
    const { print } = await createPrint(
      owner.id,
      { title: `Model ${seed}` },
      "Model",
      plateSpecs.map((file, index) => ({
        filename: file.name,
        folder: file.folder,
        tempFilePath: tempFile(plateBytes[index]),
      })),
      { describe: false, classify: false },
    );
    const files: KitModel["files"] = [];
    const rowsNow = async () => prisma.printFile.findMany({ where: { printId: print.id } });
    const save = async (given: FileSpec, role: "SUPPORTING" | "PREPARED") => {
      const file = specOf(given);
      const bytes = await bytesOf(file);
      const known = new Set((await rowsNow()).map((row) => row.id));
      await saveFileFromTemp(owner.id, print.id, tempFile(bytes), file.name, null, { role, folder: file.folder });
      const row = (await rowsNow()).find((candidate) => !known.has(candidate.id));
      if (!row) throw new Error(`The kit's ${file.name} wasn't saved`);
      files.push({ ...row, bytes });
    };
    for (const file of spec.supporting ?? []) await save(file, "SUPPORTING");
    if (spec.prepared) await save(spec.prepared, "PREPARED");
    if (spec.license) {
      await setOwnerLicense(print, spec.license);
      const row = await prisma.printFile.findFirstOrThrow({ where: { printId: print.id, role: "LICENSE" } });
      files.push({ ...row, bytes: fs.readFileSync(path.join(STORAGE, row.storagePath)) });
    }
    const previewImages: PreviewImage[] = [];
    for (let i = 0; i < (spec.gallery ?? 0); i++) {
      const image = await addPreviewImage(print.id, await uniqueImage("jpeg"));
      if (!image) throw new Error("The kit's photo wasn't stored");
      previewImages.push(image);
    }
    const descriptionImages: DescriptionImage[] = [];
    for (let i = 0; i < (spec.descriptionImages ?? 0); i++) {
      const image = await saveDescriptionImage(print.id, await uniqueImage("png"), null);
      if (!image) throw new Error("The kit's description image wasn't stored");
      descriptionImages.push(image);
    }
    // Read again: storing a plate's file fills in what was read of it.
    const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
    return {
      print: await prisma.print.findUniqueOrThrow({ where: { id: print.id } }),
      plates: plates.map((plate, index) => Object.assign(plate, { bytes: plateBytes[index] })),
      files,
      previewImages,
      descriptionImages,
    };
  }

  async function toolModel(owner: KitUser): Promise<ToolModel> {
    const key = nonce();
    const dir = path.join(STORAGE, "tools", `kit-${key}`);
    const tool = await prisma.tool.create({
      data: {
        source: "own",
        scope: owner.id,
        slug: `kit-${key}`,
        userId: owner.id,
        manifest: { name: "Kit tool" },
        script: "",
        sha: key,
      },
    });
    tools.push({ id: tool.id, dir });
    const source = path.join(dir, key.slice(0, 16), "part", "files", "Part.stl");
    const bytes = await contentOf("Part.stl", key);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, bytes);
    const { print } = await createPrint(
      owner.id,
      { title: `Tool model ${key}` },
      "Tool model",
      [{ filename: "Part.stl", sourcePath: source }],
      { describe: false, classify: false },
    );
    const [plate] = await prisma.plate.findMany({ where: { printId: print.id } });
    return {
      print: await prisma.print.update({ where: { id: print.id }, data: { toolId: tool.id, toolKey: "part" } }),
      plates: [{ ...plate, bytes }],
      files: [],
      previewImages: [],
      descriptionImages: [],
      sources: [{ path: source, bytes }],
    };
  }

  return {
    async user() {
      const { id, token } = await register(app, "kit", `User-${nonce()}`);
      userIds.push(id);
      return { id, token, auth: { Authorization: `Bearer ${token}` } };
    },
    model,
    toolModel,
    scope: () => ({ userIds: [...userIds] }),
    distinctBytes(n = 64) {
      const head = `${nonce()}\n`;
      return Buffer.from(head.length >= n ? head.slice(0, n) : head.padEnd(n, "."));
    },
    nonce,
    tempStorage,
    start(op) {
      const run = track((async () => op())());
      started.push(run.catch(() => undefined));
      return run;
    },
    async settleAll() {
      await Promise.all(started);
    },
    pauseAt,
    reached,
    hits,
  };
}
