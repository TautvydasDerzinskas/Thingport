import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { originOf } from "../src/federation/addresses";
import { invalidateAllowlist } from "../src/federation/allowlist";
import {
  fitModel,
  MODEL_MAX_BYTES,
  modelsPage,
  PAGE_BYTES,
  sendMedia,
  sendSharedFile,
} from "../src/federation/publish";
import { remoteCopyStatus, startRemoteCopy } from "../src/federation/remoteCopy";
import { remoteModel } from "../src/federation/remoteExplore";
import { readModels, remoteModelData } from "../src/federation/remoteIndex";
import { resetRuntime } from "../src/federation/runtime";
import { clearFederationSettingsCache, updateFederationSettings } from "../src/federation/settings";
import { buildAuthorId } from "../src/services/authorService";
import { saveDescriptionImage } from "../src/services/descriptionImageService";
import { addPreviewImage } from "../src/services/previewImageService";
import { licenseData } from "../src/services/licenseService";
import { createPrint } from "../src/services/printCreation";
import { saveFileFromTemp } from "../src/services/printFileService";
import { plateThumbExists, saveThumbFromBytes } from "../src/services/printService";
import { getPreviewMode, getSocialSettings, setPreviewMode, setSocialSettings } from "../src/services/settingsService";
import { profileProject } from "./helpers/profileProject";

// A partner's model copied the whole way: published by this instance as a partner sees it, read as a partner reads it,
// and copied, its files and pictures fetched from this process's own partner routes, which skip the signature check.
const { ORIGIN, partner, saves } = vi.hoisted(() => ({
  ORIGIN: "http://192.0.2.62:8000",
  partner: { base: "" },
  // The description images saved from now on, the one at `failAt` failing.
  saves: { count: 0, failAt: -1 },
}));
vi.mock("../src/federation/fetch", async (original) => ({
  ...(await original<typeof import("../src/federation/fetch")>()),
  federationFetch: (url: string, init?: RequestInit) => fetch(url.replace(ORIGIN, partner.base), init),
}));
vi.mock("../src/services/descriptionImageService", async (original) => {
  const actual = await original<typeof import("../src/services/descriptionImageService")>();
  return {
    ...actual,
    saveDescriptionImage: (...args: Parameters<typeof actual.saveDescriptionImage>) => {
      if (saves.count++ === saves.failAt) return Promise.reject(new Error("disk full"));
      return actual.saveDescriptionImage(...args);
    },
  };
});

const app = createApp();
const stamp = Date.now();
const own = (url: string | undefined): url is string => Boolean(url) && originOf(url!) === ORIGIN;

type Account = { token: string; id: string };
async function register(name: string): Promise<Account> {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: name, email: `fc-${name.toLowerCase()}-${stamp}@example.com`, password: "password123" });
  if (res.status !== 200) throw new Error(`Couldn't register ${name}: ${res.status}`);
  return { token: res.body.token, id: res.body.user.id };
}
const auth = (account: Account) => ({ Authorization: `Bearer ${account.token}` });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-fc-"));
function tmpFile(name: string, contents: string): string {
  const file = path.join(fs.mkdtempSync(path.join(dir, "f-")), name);
  fs.writeFileSync(file, contents);
  return file;
}
const picture = (r: number, g: number, b: number) =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();

/** `account`'s starter category of these names, from the top. */
async function starter(account: Account, ...names: string[]): Promise<string> {
  let parentId: string | null = null;
  for (const name of names) {
    const found: { id: string } = await prisma.category.findFirstOrThrow({
      where: { userId: account.id, kind: "category", parentId, name },
      select: { id: true },
    });
    parentId = found.id;
  }
  return parentId!;
}

async function share(account: Account, printId: string) {
  const collection = await request(app)
    .post("/api/collections")
    .set(auth(account))
    .send({ name: `Shared ${printId}`, is_public: true });
  await request(app).post(`/api/collection/${collection.body.id}/items/${printId}`).set(auth(account));
}

/** Copies the partner's model for `account`, and waits for it. */
async function copied(account: Account, remoteId: string): Promise<string> {
  await startRemoteCopy(account.id, remoteId);
  for (let i = 0; i < 100; i++) {
    const status = await remoteCopyStatus(account.id, remoteId);
    if (status.state === "failed") throw new Error(status.error ?? "failed");
    if (status.state === "done") return status.copy_id!;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The copy didn't finish");
}

/** `printId`, shared by `account`, as the partner's index has it. */
async function indexed(account: Account, printId: string): Promise<string> {
  const page = await modelsPage(account.id);
  const { models } = await readModels(
    async () => JSON.parse(JSON.stringify(page)),
    `${ORIGIN}/api/ap/actors/${account.id}/models`,
    own,
  );
  const model = models.find((item) => item.id === `${ORIGIN}/api/ap/models/${printId}`)!;
  return (
    await prisma.remoteModel.create({ data: { peerId, personId, apId: model.id, ...remoteModelData(model, own) } })
  ).id;
}

/** A model of `account`'s, shared, with one plate. */
async function sharedModel(account: Account, title: string, filename: string): Promise<string> {
  const { print } = await createPrint(
    account.id,
    { title: `${title} ${stamp}` },
    title,
    [{ filename, tempFilePath: tmpFile(filename, `solid ${title} endsolid`) }],
    { describe: false, classify: false },
  );
  await share(account, print.id);
  return print.id;
}

const FACTS = {
  title: "0.2mm layer, 2 walls",
  origin: "designer",
  creator: "Maker",
  seconds: 5400,
  grams: 32,
  filaments: [{ type: "PLA", color: "#FFFFFF", grams: 32 }],
  plates: [{ index: 1, name: "Body", seconds: 5400, grams: 32 }],
  printer: "Bambu Lab A1 mini",
};

const KEYS = ["federation", "public_url"];
let savedSocial: Awaited<ReturnType<typeof getSocialSettings>>;
let savedSettings: { key: string; value: Prisma.JsonValue }[];
let server: ReturnType<express.Express["listen"]>;
let owner: Account;
let viewer: Account;
let sourceId: string;
let platePicture: string;
let peerId: string;
let personId: string;
let remoteId: string;
let published: Record<string, unknown>;
// As MakerWorld numbers its models: a partner's word for its source is taken only as a link would give it.
const externalId = String(stamp);

beforeAll(async () => {
  savedSocial = await getSocialSettings();
  savedSettings = await prisma.setting.findMany({ where: { key: { in: KEYS } } });
  await setSocialSettings({ enabled: true });
  // This instance is the partner, at ORIGIN, as its documents name it.
  await prisma.setting.upsert({
    where: { key: "public_url" },
    create: { key: "public_url", value: ORIGIN },
    update: { value: ORIGIN },
  });
  await updateFederationSettings({ enabled: true });
  resetRuntime();
  server = express()
    .get(["/api/ap/files/:kind/:id", "/api/ap/files/:kind/:id/:name"], (req, res) => {
      void sendSharedFile(res, req.params.kind, req.params.id);
    })
    .get("/api/ap/media/:kind/:id", (req, res) => void sendMedia(res, req.params.kind, req.params.id))
    .listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  partner.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  owner = await register("Ruta");
  viewer = await register("Alex");
  const authorId = buildAuthorId("makerworld", externalId);
  await prisma.author.create({ data: { id: authorId, provider: "makerworld", externalId, name: "Maker" } });

  // An imported model as fully described as one gets: a print profile, a file beside it, pictures real and rendered,
  // and a description with an image of its own and one from elsewhere.
  const { print, plates } = await createPrint(
    owner.id,
    {
      title: `Gridfinity bin ${stamp}`,
      tags: ["Gridfinity", "Bin"],
      creator: "Maker",
      authorId,
      sourceProvider: "makerworld",
      sourceExternalId: externalId,
      unfillableGaps: ["description"],
      generatorScriptWithheld: true,
      categoryId: await starter(owner, "3D Printer", "Test Models"),
      categorySource: "MANUAL",
      // Read from MakerWorld, which stated none.
      licenseColumns: licenseData(null, "provider", "makerworld"),
    },
    "bin",
    [{ filename: "bin.3mf", tempFilePath: await profileProject(dir, "bin.3mf", "all"), sourceInstanceId: "111" }],
    { describe: false, classify: false },
  );
  sourceId = print.id;
  await prisma.plate.update({
    where: { id: plates[0].id },
    data: { profile: { provider: FACTS, providerVersion: 1 } },
  });
  await saveThumbFromBytes(plates[0].id, await picture(0, 200, 0));
  await prisma.plate.update({ where: { id: plates[0].id }, data: { thumbGenerated: false } });
  platePicture = plates[0].id;
  await addPreviewImage(print.id, await picture(200, 0, 0));
  await addPreviewImage(print.id, await picture(0, 0, 200), { generated: true });
  await saveFileFromTemp(owner.id, print.id, tmpFile("notes.txt", "print it upright"), "notes.txt", "text/plain");
  const image = (await saveDescriptionImage(print.id, await picture(200, 200, 0), null))!;
  await prisma.print.update({
    where: { id: print.id },
    data: { notes: `Steps: ![step](/description-image/${image.id}) and ![cdn](https://cdn.example.org/other.png)` },
  });
  await share(owner, print.id);

  // As a partner reads and keeps it.
  const page = (await modelsPage(owner.id)) as { orderedItems: Record<string, unknown>[] };
  published = page.orderedItems.find((item) => item.id === `${ORIGIN}/api/ap/models/${sourceId}`)!;
  const { models } = await readModels(
    async () => JSON.parse(JSON.stringify(page)),
    `${ORIGIN}/api/ap/actors/${owner.id}/models`,
    own,
  );
  const peer = await prisma.peer.create({
    data: { origin: ORIGIN, name: "Makerspace", status: "ACTIVE", actorUrl: `${ORIGIN}/api/ap/actors/instance` },
  });
  peerId = peer.id;
  personId = (
    await prisma.remotePerson.create({
      data: { peerId, apId: `${ORIGIN}/api/ap/actors/${owner.id}`, username: "ruta", displayName: "Rūta" },
    })
  ).id;
  const model = models.find((item) => item.id === published.id)!;
  remoteId = (
    await prisma.remoteModel.create({ data: { peerId, personId, apId: model.id, ...remoteModelData(model, own) } })
  ).id;
});

afterAll(async () => {
  await prisma.peer.deleteMany({ where: { origin: ORIGIN } });
  await setSocialSettings(savedSocial);
  await prisma.setting.deleteMany({ where: { key: { in: KEYS } } });
  for (const row of savedSettings) {
    await prisma.setting.create({ data: { key: row.key, value: row.value as Prisma.InputJsonValue } });
  }
  clearFederationSettingsCache();
  invalidateAllowlist();
  resetRuntime();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a partner's model, copied", () => {
  it("is published with what a copy needs", () => {
    expect(published).toMatchObject({
      "thingport:tags": ["Gridfinity", "Bin"],
      "thingport:creator": "Maker",
      "thingport:importedFrom": { provider: "makerworld", externalId },
      "thingport:author": { provider: "makerworld", externalId },
      "thingport:category": { path: ["3D Printer", "Test Models"], siteIds: expect.any(Array) },
      "thingport:generatorScriptWithheld": true,
      "thingport:unfillableGaps": ["description"],
      "thingport:license": { none: true },
      "thingport:descriptionImages": [{ url: expect.stringMatching(`^${ORIGIN}/api/ap/media/description/`) }],
      attachment: [
        expect.objectContaining({
          name: "bin.3mf",
          "thingport:kind": "plate",
          "thingport:profileId": "111",
          "thingport:profile": { version: 1, facts: FACTS },
          "thingport:thumb": expect.stringMatching(`^${ORIGIN}/api/ap/media/plate/${platePicture}\\?v=`),
        }),
        expect.objectContaining({ name: "notes.txt", "thingport:kind": "file", "thingport:role": "SUPPORTING" }),
      ],
    });
    const images = published.image as Record<string, unknown>[];
    expect(images.map((image) => image["thingport:generated"] ?? false)).toEqual([false, true]);
  });

  it("is the same model in the copier's library", async () => {
    const copyId = await copied(viewer, remoteId);
    const copy = await prisma.print.findUniqueOrThrow({
      where: { id: copyId },
      include: { plates: true, files: true, previewImages: true, descriptionImages: true },
    });
    expect(copy).toMatchObject({
      userId: viewer.id,
      title: `Gridfinity bin ${stamp}`,
      tags: ["Gridfinity", "Bin"],
      creator: "Maker",
      authorId: buildAuthorId("makerworld", externalId),
      sourceProvider: "makerworld",
      sourceExternalId: externalId,
      unfillableGaps: ["description"],
      generatorScriptWithheld: true,
      // The copier's own category of the same names.
      categoryId: await starter(viewer, "3D Printer", "Test Models"),
      categorySource: "RULE",
      remoteSource: expect.objectContaining({ apId: published.id, ownerName: "Rūta" }),
      // Read, as by its partner: not read from MakerWorld again.
      license: null,
      licenseReadAt: expect.any(Date),
    });
    expect(copy.plates).toEqual([
      expect.objectContaining({
        filename: "bin.3mf",
        sourceInstanceId: "111",
        // The partner's picture of it, not a render.
        thumbGenerated: false,
        profile: { provider: FACTS, providerVersion: 1 },
      }),
    ]);
    expect(copy.files).toEqual([expect.objectContaining({ filename: "notes.txt", role: "SUPPORTING" })]);
    // Its real picture; the partner's render is left for the copy to make its own.
    expect(copy.previewImages.filter((image) => !image.generated)).toHaveLength(1);
    // Its own image kept here, and the one from elsewhere a link, so the page fetches nothing from elsewhere.
    expect(copy.descriptionImages).toHaveLength(1);
    expect(copy.notes).toBe(
      `Steps: ![step](/description-image/${copy.descriptionImages[0].id}) and [cdn](https://cdn.example.org/other.png)`,
    );

    const page = await request(app).get(`/api/print/${copyId}`).set(auth(viewer));
    expect(page.body).toMatchObject({
      source_url: expect.stringContaining("makerworld"),
      author: expect.objectContaining({ name: "Maker" }),
      category_name: "Test Models",
      generator_script_withheld: true,
      plates: [
        expect.objectContaining({ profile_id: "111", profile: expect.objectContaining({ title: FACTS.title }) }),
      ],
    });
    const described = await request(app)
      .get(`/api/description-image/${copy.descriptionImages[0].id}`)
      .set(auth(viewer));
    expect(described.status).toBe(200);
  });

  it("opens what the copier has of the same model from its site, rather than copy it", async () => {
    const bea = await register("Bea");
    const { print } = await createPrint(
      bea.id,
      { title: "Bea's bin", sourceProvider: "makerworld", sourceExternalId: externalId },
      "Bea's bin",
      [{ filename: "bea.stl", tempFilePath: tmpFile("bea.stl", "solid bea endsolid") }],
      { describe: false, classify: false },
    );
    expect(await startRemoteCopy(bea.id, remoteId)).toMatchObject({ state: "done", copy_id: print.id });
    expect((await remoteModel(remoteId, bea.id))?.library_copy_id).toBe(print.id);
    expect(await prisma.print.count({ where: { userId: bea.id } })).toBe(1);
  });

  it("copies one from a partner too old to say more as before", async () => {
    // Its files without kinds: the 3D file a plate and the rest beside it, and who shared it as its creator.
    const attachment = published.attachment as { name: string; url: string; "thingport:size": number }[];
    const old = await prisma.remoteModel.create({
      data: {
        peerId,
        personId,
        apId: `${ORIGIN}/api/ap/models/old-${stamp}`,
        title: "Old bin",
        images: [],
        files: attachment.map((file) => ({
          name: file.name,
          size: file["thingport:size"],
          mediaType: null,
          url: file.url,
        })),
      },
    });
    const sam = await register("Sam");
    const copy = await prisma.print.findUniqueOrThrow({
      where: { id: await copied(sam, old.id) },
      include: { plates: true, files: true },
    });
    expect(copy).toMatchObject({ creator: "Rūta", tags: [], sourceProvider: null, categoryId: null });
    expect(copy.plates.map((plate) => [plate.filename, plate.sourceInstanceId])).toEqual([["bin.3mf", null]]);
    expect(copy.files.map((file) => file.filename)).toEqual(["notes.txt"]);
  });

  // Files named alike in different folders: a partner that keeps folders copies them into theirs, and one too old to
  // know them sees each named after its folder, as its own zip imports name them, rather than two of one name.
  it("keeps its files' folders, and names them apart for a partner without folders", async () => {
    const kim = await register("Kim");
    const { print } = await createPrint(
      kim.id,
      { title: `Bandit ${stamp}` },
      "bandit",
      [
        { filename: "Top.stl", folder: "Supported", tempFilePath: tmpFile("Top.stl", "solid supported endsolid") },
        { filename: "Top.stl", folder: "Unsupported", tempFilePath: tmpFile("Top.stl", "solid bare endsolid") },
        { filename: "Base.stl", tempFilePath: tmpFile("Base.stl", "solid base endsolid") },
      ],
      { describe: false, classify: false },
    );
    await saveFileFromTemp(kim.id, print.id, tmpFile("notes.txt", "glue it"), "notes.txt", "text/plain", {
      folder: "Supported",
    });
    await share(kim, print.id);
    const page = (await modelsPage(kim.id)) as { orderedItems: Record<string, unknown>[] };
    const doc = page.orderedItems.find((item) => item.id === `${ORIGIN}/api/ap/models/${print.id}`)!;
    const attachment = doc.attachment as { name: string; url: string; "thingport:path"?: string }[];
    expect(attachment.map((file) => [file.name, file["thingport:path"]])).toEqual([
      ["Supported - Top.stl", "Supported/Top.stl"],
      ["Unsupported - Top.stl", "Unsupported/Top.stl"],
      ["Base.stl", undefined],
      ["notes.txt", "Supported/notes.txt"],
    ]);

    const remote = await indexed(kim, print.id);
    const kept = await prisma.remoteModel.findUniqueOrThrow({ where: { id: remote } });
    expect((kept.files as { name: string; folder?: string }[]).map((file) => [file.folder, file.name])).toEqual([
      ["Supported", "Top.stl"],
      ["Unsupported", "Top.stl"],
      [undefined, "Base.stl"],
      ["Supported", "notes.txt"],
    ]);
    const lee = await register("Lee");
    const copy = await prisma.print.findUniqueOrThrow({
      where: { id: await copied(lee, remote) },
      include: { plates: { orderBy: { position: "asc" } }, files: { where: { role: { not: "LICENSE" } } } },
    });
    expect(copy.plates.map((plate) => [plate.folder, plate.filename])).toEqual([
      ["Supported", "Top.stl"],
      ["Unsupported", "Top.stl"],
      [null, "Base.stl"],
    ]);
    expect(copy.plates[0].storagePath).toMatch(/\/Supported\/Top\.stl$/);
    expect(copy.files.map((file) => [file.folder, file.filename])).toEqual([["Supported", "notes.txt"]]);

    // As a partner from before folders keeps it: the names alone.
    const old = await prisma.remoteModel.create({
      data: {
        peerId,
        personId,
        apId: `${ORIGIN}/api/ap/models/old-folders-${stamp}`,
        title: "Old bandit",
        images: [],
        files: attachment.map((file) => ({ name: file.name, size: null, mediaType: null, url: file.url })),
      },
    });
    const oldCopy = await prisma.print.findUniqueOrThrow({
      where: { id: await copied(await register("Mo"), old.id) },
      include: { plates: { orderBy: { position: "asc" } } },
    });
    expect(oldCopy.plates.map((plate) => [plate.folder, plate.filename])).toEqual([
      [null, "Supported - Top.stl"],
      [null, "Unsupported - Top.stl"],
      [null, "Base.stl"],
    ]);
  });

  it("keeps a sliced print as its prepared print, and only one, whatever the partner lists", async () => {
    const printId = await sharedModel(owner, "Sliced", "sliced.stl");
    const tempPath = tmpFile("sliced.gcode.3mf", "sliced");
    await saveFileFromTemp(owner.id, printId, tempPath, "sliced.gcode.3mf", null, { role: "PREPARED" });
    const page = (await modelsPage(owner.id)) as {
      orderedItems: { id: string; attachment: Record<string, unknown>[] }[];
    };
    const [stl, sliced] = page.orderedItems.find((item) => item.id.endsWith(printId))!.attachment;
    const entry = (file: Record<string, unknown>, more: Record<string, unknown> = {}) => ({
      name: file.name,
      size: file["thingport:size"],
      mediaType: null,
      url: file.url,
      ...more,
    });
    const copyOf = async (name: string, files: Record<string, unknown>[]) => {
      const row = await prisma.remoteModel.create({
        data: {
          peerId,
          personId,
          apId: `${ORIGIN}/api/ap/models/${name}-${stamp}`,
          title: name,
          images: [],
          files: files as Prisma.InputJsonValue,
        },
      });
      return prisma.print.findUniqueOrThrow({
        where: { id: await copied(await register(name), row.id) },
        include: { plates: true, files: { orderBy: { filename: "asc" } } },
      });
    };

    // From a partner too old to mark them: the 3D file a plate, the sliced one beside it its prepared print.
    const old = await copyOf("Olds", [entry(stl), entry(sliced)]);
    expect(old.plates.map((plate) => plate.filename)).toEqual(["sliced.stl"]);
    expect(old.files.map((file) => [file.filename, file.role])).toEqual([["sliced.gcode.3mf", "PREPARED"]]);
    expect(old.preparedFileId).toBe(old.files[0].id);

    // Two said to be: the first is, and the other is kept beside it rather than in its place.
    const twice = await copyOf("Twice", [
      entry(stl, { kind: "plate" }),
      entry(sliced, { kind: "file", role: "PREPARED" }),
      entry({ ...sliced, name: "again.gcode.3mf" }, { kind: "file", role: "PREPARED" }),
    ]);
    expect(twice.files.map((file) => [file.filename, file.role])).toEqual([
      ["again.gcode.3mf", "SUPPORTING"],
      ["sliced.gcode.3mf", "PREPARED"],
    ]);
    expect(twice.preparedFileId).toBe(twice.files[1].id);
  });

  it("takes the partner's render as a plate's picture only where this instance won't render one", async () => {
    const printId = await sharedModel(owner, "Rendered", "rendered.stl");
    const plate = await prisma.plate.findFirstOrThrow({ where: { printId } });
    await saveThumbFromBytes(plate.id, await picture(0, 0, 90));
    await prisma.plate.update({ where: { id: plate.id }, data: { thumbGenerated: true } });
    const remote = await indexed(owner, printId);
    const mode = await getPreviewMode();
    try {
      await setPreviewMode("disabled");
      const copy = await prisma.print.findUniqueOrThrow({
        where: { id: await copied(await register("Norender"), remote) },
        include: { plates: true },
      });
      expect(plateThumbExists(copy.plates[0].id, copy.assetsPath)).toBe(true);
      // Still a render: a picture added later takes its place.
      expect(copy.plates[0].thumbGenerated).toBe(true);
    } finally {
      await setPreviewMode(mode);
    }
  });

  it("keeps the description's images that were saved when another isn't", async () => {
    const printId = await sharedModel(owner, "Illustrated", "illustrated.stl");
    const [first, second] = [
      (await saveDescriptionImage(printId, await picture(1, 2, 3), null))!,
      (await saveDescriptionImage(printId, await picture(3, 2, 1), null))!,
    ];
    await prisma.print.update({
      where: { id: printId },
      data: { notes: `![a](/description-image/${first.id}) ![b](/description-image/${second.id})` },
    });
    const remote = await indexed(owner, printId);
    saves.count = 0;
    saves.failAt = 1;
    try {
      const copy = await prisma.print.findUniqueOrThrow({
        where: { id: await copied(await register("Halfway"), remote) },
        include: { descriptionImages: true },
      });
      expect(copy.descriptionImages).toHaveLength(1);
      expect(copy.notes).toBe(`![a](/description-image/${copy.descriptionImages[0].id}) `);
    } finally {
      saves.failAt = -1;
    }
  });

  it("serves a description's image only while its model is shared", async () => {
    const image = await prisma.descriptionImage.findFirstOrThrow({ where: { printId: sourceId } });
    const shared = await fetch(`${partner.base}/api/ap/media/description/${image.id}`);
    expect(shared.status).toBe(200);
    expect(shared.headers.get("content-type")).toBe(image.mime);
    const { print } = await createPrint(
      owner.id,
      { title: `Private ${stamp}` },
      "private",
      [{ filename: "private.stl", tempFilePath: tmpFile("private.stl", "solid private endsolid") }],
      { describe: false, classify: false },
    );
    const hidden = (await saveDescriptionImage(print.id, await picture(9, 9, 9), null))!;
    expect((await fetch(`${partner.base}/api/ap/media/description/${hidden.id}`)).status).toBe(404);
  });
});

describe("what a partner says a copy needs", () => {
  it("is kept only as far as it can be checked", async () => {
    const elsewhere = "http://198.51.100.7";
    const doc = {
      id: `${ORIGIN}/api/ap/models/odd`,
      type: "thingport:Model",
      name: "Odd",
      attributedTo: `${ORIGIN}/api/ap/actors/odd`,
      image: [{ type: "Image", url: `${elsewhere}/x.png` }],
      attachment: [
        {
          type: "Document",
          name: "odd.stl",
          url: `${ORIGIN}/api/ap/files/plate/p/odd.stl`,
          "thingport:kind": "plate",
          "thingport:thumb": `${elsewhere}/thumb.png`,
          "thingport:profile": { version: 1, facts: { title: 7, seconds: -5, filaments: [{ color: "red" }, 3] } },
        },
      ],
      "thingport:tags": ["  bins ", 4, ""],
      "thingport:importedFrom": { provider: "makerworld", externalId: "123/../../elsewhere" },
      "thingport:author": { provider: "nowhere", externalId: "1" },
      "thingport:category": { path: [] },
      "thingport:unfillableGaps": ["author", "everything"],
      "thingport:descriptionImages": [
        { id: "abc", url: `${elsewhere}/d.png` },
        // Not an id Thingport makes, which its description would never be found by.
        { id: "Step_A-1", url: `${ORIGIN}/api/ap/media/description/s` },
        { id: "c1x9", url: `${ORIGIN}/api/ap/media/description/c` },
      ],
    };
    const { models } = await readModels(
      async () => ({ orderedItems: [doc] }),
      `${ORIGIN}/api/ap/actors/odd/models`,
      own,
    );
    const data = remoteModelData(models[0], own);
    expect(data.images).toEqual([]);
    expect(data.details).toEqual({
      tags: ["bins"],
      creator: null,
      importedFrom: null,
      author: null,
      category: null,
      generatorScriptWithheld: false,
      unfillableGaps: ["author"],
      descriptionImages: [{ id: "c1x9", url: `${ORIGIN}/api/ap/media/description/c` }],
      renders: [],
      platePictures: [],
    });
    expect(data.files).toEqual([
      expect.objectContaining({
        kind: "plate",
        thumb: undefined,
        profile: { version: 1, facts: { filaments: [{ type: null, color: null, grams: null }] } },
      }),
    ]);
  });

  it("is kept of a model without files, from a partner that says it", async () => {
    const bare = (more: Record<string, unknown>) => ({
      id: `${ORIGIN}/api/ap/models/bare`,
      type: "thingport:Model",
      name: "Bare",
      attributedTo: `${ORIGIN}/api/ap/actors/bare`,
      ...more,
    });
    const read = async (doc: unknown) =>
      remoteModelData(
        (await readModels(async () => ({ orderedItems: [doc] }), `${ORIGIN}/api/ap/actors/bare/models`, own)).models[0],
        own,
      ).details;
    const site = { provider: "makerworld", externalId: "42" };
    expect(await read(bare({ "thingport:tags": ["bins"], "thingport:importedFrom": site }))).toMatchObject({
      tags: ["bins"],
      importedFrom: site,
    });
    // One that says nothing more is read as from a partner too old to.
    expect(await read(bare({}))).toBe(Prisma.DbNull);
    // A licence keeps the site it was read from; a site that stated none says so.
    const license = { id: "CC-BY-4.0", raw: "BY", source: "provider", provider: "makerworld" };
    expect(await read(bare({ "thingport:license": license }))).toMatchObject({
      license: { id: "CC-BY-4.0", source: "provider", provider: "makerworld" },
    });
    expect(await read(bare({ "thingport:license": { none: true } }))).toMatchObject({ license: null });
    expect(await read(bare({ "thingport:license": { none: false } }))).toBe(Prisma.DbNull);
  });

  it("leaves a model's print profiles out rather than make it too big for a page", () => {
    const big = { facts: { description: "x".repeat(MODEL_MAX_BYTES) } };
    const doc = fitModel({ id: "m", attachment: [{ name: "a.3mf", "thingport:profile": big }] });
    expect(doc.attachment).toEqual([{ name: "a.3mf" }]);
    expect(fitModel({ id: "m", attachment: [{ name: "a.3mf", "thingport:profile": { facts: {} } }] })).toEqual({
      id: "m",
      attachment: [{ name: "a.3mf", "thingport:profile": { facts: {} } }],
    });
    // Too big without them too: its category, description's images and plates' pictures go next.
    const extras = {
      "thingport:tags": ["bins"],
      "thingport:category": { path: ["x".repeat(MODEL_MAX_BYTES)], siteIds: [] },
      "thingport:descriptionImages": [{ id: "a", url: "u" }],
    };
    const plate = { name: "a.3mf", "thingport:profile": big, "thingport:thumb": "t", "thingport:thumbGenerated": true };
    expect(fitModel({ id: "m", ...extras, attachment: [plate] })).toEqual({
      id: "m",
      "thingport:tags": ["bins"],
      attachment: [{ name: "a.3mf" }],
    });
  });

  it("fits a page whatever its owner wrote in it", async () => {
    const big = await register("Wordy");
    const long = "ü".repeat(50_000);
    const category = await prisma.category.create({ data: { userId: big.id, name: long, kind: "category" } });
    const printId = await sharedModel(big, "Wordy", "wordy.stl");
    await prisma.print.update({
      where: { id: printId },
      data: {
        title: long,
        notes: long,
        categoryId: category.id,
        tags: Array.from({ length: 60 }, (_, i) => `${i}${long}`),
      },
    });
    const plate = await prisma.plate.findFirstOrThrow({ where: { printId } });
    await prisma.plate.update({
      where: { id: plate.id },
      data: {
        filename: `${long}.stl`,
        mime: `model/${long}`,
        profile: { provider: { ...FACTS, title: "x".repeat(MODEL_MAX_BYTES) } },
      },
    });
    try {
      const page = (await modelsPage(big.id)) as { orderedItems: Record<string, unknown>[] };
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(PAGE_BYTES);
      const [doc] = page.orderedItems;
      expect(Buffer.byteLength(JSON.stringify(doc))).toBeLessThanOrEqual(MODEL_MAX_BYTES);
      // A category a partner wouldn't keep isn't sent; the rest is cut to what it keeps.
      expect(doc["thingport:category"]).toBeUndefined();
      expect((doc["thingport:tags"] as string[]).every((tag) => tag.length <= 100)).toBe(true);
      const [file] = doc.attachment as { name: string; mediaType: string; url: string }[];
      expect([file.name.length, file.mediaType.length]).toEqual([255, 120]);
      // Cut before its extension, which says what it is.
      expect(file.name.endsWith("ü.stl")).toBe(true);
      expect(file).not.toHaveProperty("thingport:profile");
      expect(file.url.endsWith(`/${encodeURIComponent(file.name)}`)).toBe(true);
    } finally {
      // Gone again: no other file's storage move should meet names like these.
      expect((await request(app).delete(`/api/print/${printId}`).set(auth(big))).status).toBe(200);
    }
  });

  it("stays within its own size with a hundred files whose names escape", async () => {
    const many = await register("Many");
    const printId = await sharedModel(many, "Many", "many.stl");
    // Six bytes a character as JSON, the most any takes.
    const escaping = "\u0001";
    await prisma.print.update({ where: { id: printId }, data: { notes: escaping.repeat(20_000) } });
    await prisma.plate.updateMany({ where: { printId }, data: { filename: `${escaping.repeat(300)}.stl` } });
    await prisma.plate.createMany({
      data: Array.from({ length: 99 }, (_, i) => ({
        printId,
        position: i + 1,
        filename: `${escaping.repeat(300)}-${i}.stl`,
        mime: "model/stl",
        storagePath: `fc-many-${stamp}-${i}.stl`,
      })),
    });
    try {
      const page = (await modelsPage(many.id)) as { orderedItems: Record<string, unknown>[] };
      const [doc] = page.orderedItems;
      expect(Buffer.byteLength(JSON.stringify(doc))).toBeLessThanOrEqual(MODEL_MAX_BYTES);
      const files = doc.attachment as { name: string; url: string }[];
      expect(files).toHaveLength(100);
      expect(files.every((file) => file.name.length <= 255 && file.name.endsWith(".stl"))).toBe(true);
      // Each where it's fetched all the same, without its name at the end; the description shortened, not gone.
      expect(files.every((file) => /\/api\/ap\/files\/plate\/[^/]+$/.test(file.url))).toBe(true);
      const content = (doc.source as { content: string }).content;
      expect(content.length).toBeGreaterThan(0);
      expect(content.length).toBeLessThan(20_000);
    } finally {
      // Gone again: these names make one storage path, which a later storage move would refuse.
      expect((await request(app).delete(`/api/print/${printId}`).set(auth(many))).status).toBe(200);
    }
  });
});
