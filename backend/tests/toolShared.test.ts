import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { addPreviewImage, previewImagePath } from "../src/services/previewImageService";
import { setToolsAccess } from "../src/services/settingsService";
import { setToolsRepoForTest, toolFetchSettled } from "../src/services/toolsService";

const app = createApp();
const stamp = Date.now();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const SCRIPT = "export default function mount({ root }) { root.textContent = 'hi'; }";
const STL =
  "solid p\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid p\n";

type Person = { token: string; id: string };
let admin: Person;
let dad: Person;
let son: Person;
let repo: string;
let toolId: string;

async function register(name: string): Promise<Person> {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: name, email: `shared-${name}-${stamp}@example.com`, password: "password123" });
  return { token: res.body.token as string, id: res.body.user.id as string };
}

async function upload(person: Person, name: string): Promise<string> {
  const res = await request(app).post("/api/upload").set(auth(person.token)).attach("files", Buffer.from(STL), name);
  return res.body.prints[0].id as string;
}

/** A queue tool as the repository would hold it: a command, and a part of the model page it draws. */
function writeRepo() {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.mkdirSync(path.join(repo, "queue"), { recursive: true });
  fs.writeFileSync(path.join(repo, "index.json"), JSON.stringify({ tools: ["queue"] }));
  fs.writeFileSync(
    path.join(repo, "queue", "tool.json"),
    JSON.stringify({
      name: "Queue",
      author: "Tests",
      commands: [{ id: "queue", title: "Add to queue", window: false }],
      modelPage: { info: true },
    }),
  );
  fs.writeFileSync(path.join(repo, "queue", "tool.js"), SCRIPT);
}

async function install(): Promise<string> {
  const res = await request(app).post("/api/admin/tools/queue/install").set(auth(admin.token));
  expect(res.status).toBe(200);
  await toolFetchSettled(res.body.id);
  return res.body.id as string;
}

const share = (person: Person, key: string, body: object) =>
  request(app).put(`/api/tools/${toolId}/shared/${key}`).set(auth(person.token)).send(body);
const list = async (person: Person, query = "") =>
  (await request(app).get(`/api/tools/${toolId}/shared${query}`).set(auth(person.token))).body.entries as {
    key: string;
    value: unknown;
    mine: boolean;
    preview_match?: boolean;
    user: { id: string; display_name: string };
  }[];

beforeAll(async () => {
  admin = await register("admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  admin.token = (
    await request(app)
      .post("/api/login")
      .send({ email: `shared-admin-${stamp}@example.com`, password: "password123" })
  ).body.token;
  dad = await register("dad");
  son = await register("son");
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-shared-"));
  setToolsRepoForTest({ dir: repo });
  await setToolsAccess({ audience: "everyone", userIds: [], userTools: false });
});

afterEach(async () => {
  await setToolsAccess({ audience: "everyone", userIds: [], userTools: false });
  await request(app).delete("/api/admin/tools/queue").set(auth(admin.token));
});

afterAll(async () => {
  setToolsRepoForTest();
  fs.rmSync(repo, { recursive: true, force: true });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, dad.id, son.id] } } });
});

describe("shared entries", () => {
  it("are read by everyone who uses the tool, and changed only by whoever wrote them", async () => {
    writeRepo();
    toolId = await install();
    expect((await share(dad, "job:1", { value: { status: "queued" } })).status).toBe(204);
    expect((await share(son, "job:1", { value: { status: "printing" } })).status).toBe(204);

    const seen = await list(son, "?prefix=job:");
    expect(seen).toHaveLength(2);
    expect(seen.find((entry) => entry.mine)).toMatchObject({ value: { status: "printing" } });
    expect(seen.find((entry) => !entry.mine)).toMatchObject({
      value: { status: "queued" },
      user: { id: dad.id, display_name: "dad" },
    });
    // Nobody's email goes out with their name.
    expect(JSON.stringify(seen)).not.toContain("@example.com");

    // The same key is each writer's own: the son's delete leaves the dad's entry be.
    await request(app).delete(`/api/tools/${toolId}/shared/job:1`).set(auth(son.token));
    expect((await list(dad)).map((entry) => entry.user.id)).toEqual([dad.id]);
  });

  it("reach only the people their writer picked, once they picked any", async () => {
    writeRepo();
    toolId = await install();
    await share(dad, "job:1", { value: { status: "queued" } });
    const audience = (body: object) =>
      request(app).put(`/api/tools/${toolId}/audience`).set(auth(dad.token)).send(body);

    expect((await audience({ everyone: false, userIds: [] })).body).toEqual({ everyone: false, people: [] });
    expect(await list(son)).toEqual([]);
    expect(await list(dad)).toHaveLength(1);

    expect((await audience({ everyone: false, userIds: [son.id] })).body.people).toEqual([
      expect.objectContaining({ id: son.id, display_name: "son" }),
    ]);
    expect(await list(son)).toHaveLength(1);
    expect((await request(app).get(`/api/tools/${toolId}/audience`).set(auth(son.token))).body).toEqual({
      everyone: true,
      people: [],
    });

    // Only someone who can use tools can be picked.
    await setToolsAccess({ audience: "selected", userIds: [dad.id] });
    expect((await audience({ everyone: false, userIds: [son.id] })).status).toBe(400);
    const people = await request(app).get(`/api/tools/${toolId}/people?q=admin`).set(auth(dad.token));
    const ids = people.body.people.map((person: { id: string }) => person.id);
    expect(ids).toContain(admin.id);
    expect(ids).not.toContain(son.id);
    expect(ids).not.toContain(dad.id);
    expect((await request(app).get(`/api/tools/${toolId}/shared`).set(auth(son.token))).status).toBe(403);

    await setToolsAccess({ audience: "everyone" });
    expect((await audience({ everyone: true })).body).toEqual({ everyone: true, people: [] });
    expect(await list(son)).toHaveLength(1);

    // Found by a whole email too, which isn't sent back.
    const byEmail = await request(app)
      .get(`/api/tools/${toolId}/people?q=${encodeURIComponent(`SHARED-son-${stamp}@example.com`)}`)
      .set(auth(dad.token));
    expect(byEmail.body.people).toEqual([{ id: son.id, display_name: "son", avatar_url: expect.anything() }]);
    expect(JSON.stringify(byEmail.body)).not.toContain("@example.com");
    const byPart = await request(app).get(`/api/tools/${toolId}/people?q=son-${stamp}`).set(auth(dad.token));
    expect(byPart.body.people).toEqual([]);
  });

  it("keep JSON's null as a value", async () => {
    writeRepo();
    toolId = await install();
    expect((await share(dad, "flag", { value: null })).status).toBe(204);
    expect(await list(dad)).toEqual([expect.objectContaining({ key: "flag", value: null })]);
  });

  it("aren't crowded out of a read by entries kept from the reader", async () => {
    writeRepo();
    toolId = await install();
    const dadsModel = await upload(dad, "crowd.stl");
    const sonsCopy = await upload(son, "crowd.stl");
    await prisma.print.update({ where: { id: sonsCopy }, data: { originalId: dadsModel, copiedFromId: dadsModel } });
    expect((await share(son, "job:mine", { value: 1, model: sonsCopy })).status).toBe(204);
    // More of the dad's, newer and kept from the son, than a read takes.
    await prisma.toolSharedData.createMany({
      data: Array.from({ length: 5000 }, (_, i) => ({
        toolId,
        userId: dad.id,
        key: `job:${i}`,
        value: i,
        size: 1,
        printId: dadsModel,
        originKey: `orig:${dadsModel}`,
        updatedAt: new Date(Date.now() + 60_000),
      })),
    });
    await request(app).put(`/api/tools/${toolId}/audience`).set(auth(dad.token)).send({ everyone: false });
    expect((await list(son)).map((entry) => entry.key)).toEqual(["job:mine"]);
    expect((await list(son, `?model=${sonsCopy}`)).map((entry) => entry.key)).toEqual(["job:mine"]);
  });

  it("are read on page by page from a cursor, none twice and none left out, even written in the same moment", async () => {
    writeRepo();
    toolId = await install();
    const at = new Date();
    // 5,000 of the dad's and 3 of the son's, all written in the same millisecond but one older entry of the son's.
    await prisma.toolSharedData.createMany({
      data: [
        ...Array.from({ length: 5000 }, (_, i) => ({ toolId, userId: dad.id, key: `job:${i}`, value: i, size: 1 })),
        ...[0, 1, 2].map((i) => ({ toolId, userId: son.id, key: `job:${i}`, value: i, size: 1 })),
      ].map((row) => ({ ...row, updatedAt: at })),
    });
    await prisma.toolSharedData.create({
      data: { toolId, userId: son.id, key: "job:old", value: 0, size: 1, updatedAt: new Date(at.getTime() - 1000) },
    });
    const first = await list(son, "?prefix=job:");
    expect(first).toHaveLength(5000);
    const last = first.at(-1) as { cursor: string };
    const rest = await list(son, `?prefix=job:&before=${encodeURIComponent(last.cursor)}`);
    expect(rest).toHaveLength(4);
    expect(rest.at(-1)).toMatchObject({ key: "job:old" });
    const seen = [...first, ...rest].map((entry) => `${entry.user.id}:${entry.key}`);
    expect(new Set(seen).size).toBe(5004);
    expect((await request(app).get(`/api/tools/${toolId}/shared?before=nonsense`).set(auth(son.token))).status).toBe(
      400,
    );
  });

  it("stay within a writer's limit when several are written at once", async () => {
    writeRepo();
    toolId = await install();
    await prisma.toolSharedData.createMany({
      data: Array.from({ length: 4998 }, (_, i) => ({ toolId, userId: dad.id, key: `old:${i}`, value: i, size: 1 })),
    });
    const tries = await Promise.all(
      Array.from({ length: 6 }, (_, i) => share(dad, `new:${i}`, { value: i }).then((res) => res.status)),
    );
    expect(tries.filter((status) => status === 204)).toHaveLength(2);
    expect(tries.filter((status) => status === 413)).toHaveLength(4);
    expect(await prisma.toolSharedData.count({ where: { toolId, userId: dad.id } })).toBe(5000);
  });

  it("are about a model the writer can read", async () => {
    writeRepo();
    toolId = await install();
    const dadsModel = await upload(dad, "bracket.stl");
    expect((await share(son, "job:1", { value: {}, model: dadsModel })).status).toBe(404);
    expect((await share(dad, "job:1", { value: {}, model: dadsModel })).status).toBe(204);
  });
});

describe("entries about a model", () => {
  it.each(["note:", ""])("matches previews on equivalent copies with prefix %j", async (prefix) => {
    writeRepo();
    toolId = await install();
    const original = await upload(dad, "preview.stl");
    const copy = await upload(son, "preview-copy.stl");
    await prisma.print.update({ where: { id: copy }, data: { originalId: original, copiedFromId: original } });

    const photo = await sharp(
      Buffer.from(
        '<svg width="320" height="240"><rect width="320" height="240" fill="white"/><circle cx="100" cy="80" r="58" fill="blue"/></svg>',
      ),
    )
      .png()
      .toBuffer();
    const otherPhoto = await sharp(
      Buffer.from(
        '<svg width="320" height="240"><rect width="320" height="240" fill="white"/><circle cx="215" cy="150" r="58" fill="blue"/></svg>',
      ),
    )
      .png()
      .toBuffer();
    const originalImage = (await addPreviewImage(original, photo))!;
    const otherImage = (await addPreviewImage(original, otherPhoto))!;
    const { assetsPath } = await prisma.print.findUniqueOrThrow({
      where: { id: original },
      select: { assetsPath: true },
    });
    const stored = fs.readFileSync(previewImagePath(originalImage.id, assetsPath));
    const copyImage = (await addPreviewImage(copy, stored, { keepExif: true }))!;
    const legacyKey = `${prefix}${original}:image:${originalImage.id}:before-review`;
    const otherKey = `${prefix}${original}:image:${otherImage.id}:elsewhere`;
    const spoofedKey = `${prefix}${original}:image:${copyImage.id}:unrelated-id`;
    for (const key of [legacyKey, otherKey, spoofedKey]) {
      expect((await share(dad, key, { value: {}, model: original })).status).toBe(204);
    }

    const previewQuery = `model=${copy}&preview=image:${copyImage.id}`;
    const query = `?prefix=${prefix}&${previewQuery}`;
    const matches = await list(son, query);
    expect(matches.filter((entry) => entry.preview_match).map(({ key }) => key)).toEqual([legacyKey]);
    expect(matches).toHaveLength(3);
    const withoutPrefix = await list(son, `?${previewQuery}`);
    expect(withoutPrefix).toHaveLength(3);
    expect(withoutPrefix.every((entry) => entry.preview_match === undefined)).toBe(true);
    await request(app).put(`/api/tools/${toolId}/audience`).set(auth(dad.token)).send({ everyone: false });
    expect(await list(son, query)).toEqual([]);
  });

  it("are found from the model and from any copy of it, as long as they reach the reader", async () => {
    writeRepo();
    toolId = await install();
    const dadsModel = await upload(dad, "bracket.stl");
    // The son's copy of it, and another model of his imported from the same page as the dad's next one.
    const sonsCopy = await upload(son, "bracket.stl");
    await prisma.print.update({ where: { id: sonsCopy }, data: { originalId: dadsModel, copiedFromId: dadsModel } });
    const dadsImport = await upload(dad, "hook.stl");
    const sonsImport = await upload(son, "hook.stl");
    for (const id of [dadsImport, sonsImport])
      await prisma.print.update({
        where: { id },
        data: { sourceProvider: "printables", sourceExternalId: `9${stamp}` },
      });

    await share(dad, "job:1", { value: { n: 1 }, model: dadsModel });
    await share(dad, "job:2", { value: { n: 2 }, model: dadsModel });
    await share(dad, "job:3", { value: { n: 3 }, model: dadsImport });
    await share(son, "note", { value: "x", model: sonsCopy });

    expect((await list(son, `?model=${sonsCopy}`)).map((entry) => entry.key).toSorted()).toEqual([
      "job:1",
      "job:2",
      "note",
    ]);
    expect((await list(son, `?model=${sonsImport}`)).map((entry) => entry.key)).toEqual(["job:3"]);

    // Kept from the son, the dad's entries leave his copy's reads.
    await request(app).put(`/api/tools/${toolId}/audience`).set(auth(dad.token)).send({ everyone: false });
    expect((await list(son, `?model=${sonsCopy}`)).map((entry) => entry.key)).toEqual(["note"]);
    // The dad still reads his own, and the son's about his copy.
    expect((await list(dad, `?model=${dadsModel}`)).map((entry) => entry.key).toSorted()).toEqual([
      "job:1",
      "job:2",
      "note",
    ]);
  });
});
