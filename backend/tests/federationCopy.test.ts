import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { originOf } from "../src/federation/addresses";
import { invalidateAllowlist } from "../src/federation/allowlist";
import { fitModel, MODEL_MAX_BYTES, modelsPage, sendMedia, sendSharedFile } from "../src/federation/publish";
import { remoteCopyStatus, startRemoteCopy } from "../src/federation/remoteCopy";
import { remoteModel } from "../src/federation/remoteExplore";
import { readModels, remoteModelData } from "../src/federation/remoteIndex";
import { resetRuntime } from "../src/federation/runtime";
import { clearFederationSettingsCache, updateFederationSettings } from "../src/federation/settings";
import { buildAuthorId } from "../src/services/authorService";
import { saveDescriptionImage } from "../src/services/descriptionImageService";
import { addPreviewImage } from "../src/services/previewImageService";
import { createPrint } from "../src/services/printCreation";
import { saveFileFromTemp } from "../src/services/printFileService";
import { saveThumbFromBytes } from "../src/services/printService";
import { getSocialSettings, setSocialSettings } from "../src/services/settingsService";
import { profileProject } from "./helpers/profileProject";

// A partner's model copied the whole way: published by this instance as a partner sees it, read as a partner reads it,
// and copied, its files and pictures fetched from this process's own partner routes, which skip the signature check.
const { ORIGIN, partner } = vi.hoisted(() => ({ ORIGIN: "http://192.0.2.62:8000", partner: { base: "" } }));
vi.mock("../src/federation/fetch", async (original) => ({
  ...(await original<typeof import("../src/federation/fetch")>()),
  federationFetch: (url: string, init?: RequestInit) => fetch(url.replace(ORIGIN, partner.base), init),
}));

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
      "thingport:descriptionImages": [{ id: "abc", url: `${elsewhere}/d.png` }],
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
      descriptionImages: [],
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

  it("leaves a model's print profiles out rather than make it too big for a page", () => {
    const big = { facts: { description: "x".repeat(MODEL_MAX_BYTES) } };
    const doc = fitModel({ id: "m", attachment: [{ name: "a.3mf", "thingport:profile": big }] });
    expect(doc.attachment).toEqual([{ name: "a.3mf" }]);
    expect(fitModel({ id: "m", attachment: [{ name: "a.3mf", "thingport:profile": { facts: {} } }] })).toEqual({
      id: "m",
      attachment: [{ name: "a.3mf", "thingport:profile": { facts: {} } }],
    });
  });
});
