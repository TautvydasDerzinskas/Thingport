import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { setToolsAccess } from "../src/services/settingsService";
import { parseToolManifest } from "../src/services/toolFormat";
import { setToolsRepoForTest, syncToolModels, toolFetchSettled, toolsSource } from "../src/services/toolsService";

const app = createApp();
const stamp = Date.now();
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const SCRIPT = "export default function mount({ root }) { root.textContent = 'hi'; }";
const STL = (name: string) =>
  `solid ${name}\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid ${name}\n`;

let adminToken: string;
let adminId: string;
let memberToken: string;
let memberId: string;
let repo: string;

async function register(name: string) {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: name, email: `tools-${name}-${stamp}@example.com`, password: "password123" });
  return { token: res.body.token as string, id: res.body.user.id as string };
}

/** A tools folder as the repository holds it, with one tool that brings two models. */
function writeRepo(version = "1.0.0", models = ["tile", "clip"]) {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.mkdirSync(path.join(repo, "planner", "models"), { recursive: true });
  fs.writeFileSync(path.join(repo, "index.json"), JSON.stringify({ tools: ["planner", "missing"] }));
  fs.writeFileSync(
    path.join(repo, "planner", "tool.json"),
    JSON.stringify({
      name: "Planner",
      version,
      collection: {
        name: "Planner parts",
        models: models.map((key) => ({ key, name: `Part ${key}`, files: [`models/${key}.stl`] })),
      },
    }),
  );
  fs.writeFileSync(path.join(repo, "planner", "tool.js"), SCRIPT);
  for (const key of models) fs.writeFileSync(path.join(repo, "planner", "models", `${key}.stl`), STL(key));
}

async function install() {
  const res = await request(app).post("/api/admin/tools/planner/install").set(auth(adminToken));
  expect(res.status).toBe(200);
  await toolFetchSettled(res.body.id);
  // Everyone's copies are made in the background; the two users the tests look at get theirs now.
  for (const user of [
    { id: adminId, role: "ADMIN" as const },
    { id: memberId, role: "MEMBER" as const },
  ])
    await syncToolModels(user);
  return res.body.id as string;
}

beforeAll(async () => {
  const admin = await register("admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  adminToken = (
    await request(app)
      .post("/api/login")
      .send({ email: `tools-admin-${stamp}@example.com`, password: "password123" })
  ).body.token;
  adminId = admin.id;
  const member = await register("member");
  memberToken = member.token;
  memberId = member.id;
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-tools-"));
  setToolsRepoForTest({ dir: repo });
});

afterEach(async () => {
  await setToolsAccess({ audience: "everyone", userIds: [], userTools: false });
  const res = await request(app).delete("/api/admin/tools/planner").set(auth(adminToken));
  // Left installed, it would show in the next test's lists.
  if (res.status !== 204 && res.status !== 404) throw new Error(`Uninstalling failed: ${JSON.stringify(res.body)}`);
});

afterAll(async () => {
  setToolsRepoForTest();
  fs.rmSync(repo, { recursive: true, force: true });
  await prisma.tool.deleteMany({ where: { userId: { in: [adminId, memberId] } } });
});

describe("metadata", () => {
  it("fills in the defaults and checks a tool's models", () => {
    expect(parseToolManifest('{"name":"x"}')).toMatchObject({ version: "1.0.0", window: { width: 960 }, hosts: [] });
    expect(() => parseToolManifest('{"name":"x","collection":{"name":"c","models":[{"key":"a","name":"A"}]}}')).toThrow(
      /files or a source/,
    );
    expect(() =>
      parseToolManifest(
        '{"name":"x","collection":{"name":"c","models":[{"key":"a","name":"A","files":["../x.stl"]}]}}',
      ),
    ).toThrow(/beside tool.json/);
    expect(() =>
      parseToolManifest('{"name":"x","collection":{"name":"c","models":[{"key":"a","name":"A","files":["a.exe"]}]}}'),
    ).toThrow(/3D model/);
    const sourced = parseToolManifest(
      '{"name":"x","collection":{"name":"c","models":[{"key":"a","name":"A","source":"https://thangs.com/m/1"}]}}',
    );
    expect(sourced.collection?.models[0].source).toBe("https://thangs.com/m/1");
  });
});

describe("where tools come from", () => {
  it("reads the checkout's own tools folder when run from one", () => {
    setToolsRepoForTest();
    expect(toolsSource()).toEqual({ kind: "folder", location: path.resolve(__dirname, "../../tools") });
    setToolsRepoForTest({ dir: repo });
  });

  it("tells admins which", async () => {
    const res = await request(app).get("/api/admin/tools").set(auth(adminToken));
    expect(res.body.source).toEqual({ kind: "folder", location: repo });
  });
});

describe("installing", () => {
  it("lists the repository's tools, leaving out one that doesn't load", async () => {
    writeRepo();
    const res = await request(app).get("/api/admin/tools").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.tools.map((t: { slug: string }) => t.slug)).toEqual(["planner"]);
    expect(res.body.tools[0].installed).toBeNull();
    expect((await request(app).get("/api/admin/tools").set(auth(memberToken))).status).toBe(403);
  });

  it("gives every user a fixed collection of the tool's models, listed last", async () => {
    writeRepo();
    const toolId = await install();
    const catalog = await request(app).get("/api/admin/tools").set(auth(adminToken));
    expect(catalog.body.tools[0].installed.models).toMatchObject({ total: 2, ready: 2, failed: [] });

    const collections = await request(app).get("/api/collections").set(auth(memberToken));
    const last = collections.body.at(-1);
    expect(last).toMatchObject({ name: "Tool: Planner parts", tool_id: toolId, item_count: 2 });
    const prints = await prisma.print.findMany({ where: { userId: memberId, toolId }, orderBy: { toolKey: "asc" } });
    expect(prints.map((p) => p.toolKey)).toEqual(["clip", "tile"]);

    const listed = await request(app).get("/api/tools").set(auth(memberToken));
    expect(listed.body.tools).toHaveLength(1);
    expect(listed.body.tools[0]).toMatchObject({ source: "repo", slug: "planner", collectionId: last.id });
    const models = await request(app).get(`/api/tools/${toolId}/models`).set(auth(memberToken));
    expect(models.body.models.map((m: { key: string; printId: string }) => [m.key, Boolean(m.printId)])).toEqual([
      ["tile", true],
      ["clip", true],
    ]);
  });

  it("won't let the tool's models or collection be changed, but they can be opened and favourited", async () => {
    writeRepo();
    const toolId = await install();
    await syncToolModels({ id: memberId, role: "MEMBER" });
    const print = await prisma.print.findFirstOrThrow({ where: { userId: memberId, toolId } });
    const collection = await prisma.collection.findFirstOrThrow({ where: { userId: memberId, toolId } });
    const as = auth(memberToken);

    expect((await request(app).get(`/api/print/${print.id}`).set(as)).body.tool_id).toBe(toolId);
    expect((await request(app).post(`/api/print/${print.id}/favorite`).set(as)).status).toBe(200);
    expect((await request(app).delete(`/api/print/${print.id}`).set(as)).status).toBe(403);
    expect((await request(app).post(`/api/print/${print.id}/meta`).set(as).send({ name: "x" })).status).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/print/${print.id}/tags`)
          .set(as)
          .send({ tags: ["x"] })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/prints/delete")
          .set(as)
          .send({ print_ids: [print.id] })
      ).body,
    ).toMatchObject({
      deleted: [],
      failed: 1,
    });
    expect((await request(app).delete(`/api/collection/${collection.id}`).set(as)).status).toBe(403);
    expect(
      (await request(app).patch(`/api/collection/${collection.id}`).set(as).send({ name: "Mine", tags: [] })).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/collections/delete")
          .set(as)
          .send({ ids: [collection.id] })
      ).status,
    ).toBe(403);
    expect((await request(app).delete(`/api/collection/${collection.id}/items/${print.id}`).set(as)).status).toBe(403);
    // Not offered as somewhere to put a model.
    const pickers = await request(app).get(`/api/print/${print.id}/collections`).set(as);
    expect(pickers.body.some((c: { id: string }) => c.id === collection.id)).toBe(false);
  });

  it("takes everyone's copies and the collection away on uninstall", async () => {
    writeRepo();
    const toolId = await install();
    expect(await prisma.print.count({ where: { toolId } })).toBeGreaterThan(0);
    expect((await request(app).delete("/api/admin/tools/planner").set(auth(adminToken))).status).toBe(204);
    expect(await prisma.print.count({ where: { toolKey: { not: null }, userId: { in: [adminId, memberId] } } })).toBe(
      0,
    );
    expect(await prisma.collection.count({ where: { toolId } })).toBe(0);
    expect(await prisma.tool.count({ where: { id: toolId } })).toBe(0);
  });

  it("offers an update and replaces the models when they changed", async () => {
    writeRepo("1.0.0", ["tile"]);
    const toolId = await install();
    writeRepo("1.1.0", ["tile", "clip"]);
    setToolsRepoForTest({ dir: repo });
    const catalog = await request(app).get("/api/admin/tools").set(auth(adminToken));
    expect(catalog.body.tools[0].installed.updateAvailable).toBe(true);
    expect(await install()).toBe(toolId);
    expect(await prisma.print.count({ where: { userId: memberId, toolId } })).toBe(2);
    expect(await prisma.collection.count({ where: { userId: memberId, toolId } })).toBe(1);
  });
});

describe("screenshots", () => {
  it("shows admins a tool's screenshots before it's installed", async () => {
    writeRepo();
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    fs.mkdirSync(path.join(repo, "planner", "screenshots"));
    fs.writeFileSync(path.join(repo, "planner", "screenshots", "plan.png"), png);
    fs.writeFileSync(
      path.join(repo, "planner", "tool.json"),
      JSON.stringify({ name: "Planner", screenshots: [{ file: "screenshots/plan.png", caption: "Planning" }] }),
    );
    setToolsRepoForTest({ dir: repo });
    const catalog = await request(app).get("/api/admin/tools").set(auth(adminToken));
    expect(catalog.body.tools[0].manifest.screenshots).toEqual([{ file: "screenshots/plan.png", caption: "Planning" }]);
    const shot = await request(app).get("/api/admin/tools/planner/screenshots/0").set(auth(adminToken));
    expect(shot.status).toBe(200);
    expect(shot.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(shot.body, png)).toBe(0);
    // An <img> sends the session in the address.
    expect((await request(app).get(`/api/admin/tools/planner/screenshots/0?token=${adminToken}`)).status).toBe(200);
    expect((await request(app).get("/api/admin/tools/planner/screenshots/1").set(auth(adminToken))).status).toBe(404);
    expect((await request(app).get("/api/admin/tools/planner/screenshots/0").set(auth(memberToken))).status).toBe(403);
  });

  it("are images beside tool.json", () => {
    expect(() => parseToolManifest('{"name":"x","screenshots":[{"file":"shot.svg"}]}')).toThrow(/PNG, JPEG or WebP/);
    expect(() => parseToolManifest('{"name":"x","screenshots":[{"file":"../shot.png"}]}')).toThrow(/beside tool.json/);
  });
});

describe("models from a provider", () => {
  it("says why they didn't come, and stops trying once the reason repeats", async () => {
    writeRepo();
    const models = [1, 2, 3, 4, 5].map((n) => ({
      key: `part-${n}`,
      name: `Part ${n}`,
      source: `https://models.example.invalid/part-${n}.stl`,
    }));
    fs.writeFileSync(
      path.join(repo, "planner", "tool.json"),
      JSON.stringify({ name: "Planner", collection: { name: "Planner parts", models } }),
    );
    await install();
    const catalog = await request(app).get("/api/admin/tools").set(auth(adminToken));
    const state = catalog.body.tools[0].installed.models;
    expect(state).toMatchObject({ total: 5, ready: 0, fetching: false });
    // A host that never answers: every part says so, though only the first few were tried.
    expect(state.failed).toHaveLength(5);
    expect(new Set(state.failed.map((f: { reason: string }) => f.reason)).size).toBe(1);
    // Everyone's collection is there already, waiting for them.
    const toolId = catalog.body.tools[0].installed.id;
    expect(await prisma.collection.count({ where: { userId: memberId, toolId } })).toBe(1);
  });
});

describe("who may use tools", () => {
  it("shows them to admins and the users picked, and takes their models from the rest", async () => {
    writeRepo();
    const toolId = await install();
    await setToolsAccess({ audience: "selected", userIds: [] });
    expect((await request(app).get("/api/tools").set(auth(memberToken))).body).toMatchObject({
      access: { canUse: false },
      tools: [],
    });
    await syncToolModels({ id: memberId, role: "MEMBER" });
    expect(await prisma.print.count({ where: { userId: memberId, toolId } })).toBe(0);
    expect(await prisma.collection.count({ where: { userId: memberId, toolId } })).toBe(0);
    expect((await request(app).get(`/api/tools/${toolId}/models`).set(auth(memberToken))).status).toBe(403);
    expect((await request(app).get("/api/tools").set(auth(adminToken))).body.access.canUse).toBe(true);

    const saved = await request(app)
      .post("/api/admin/tools/access")
      .set(auth(adminToken))
      .send({ userIds: [memberId, "nobody"] });
    expect(saved.body).toMatchObject({ audience: "selected", userIds: [memberId] });
    expect((await request(app).get("/api/tools").set(auth(memberToken))).body.access.canUse).toBe(true);
  });
});

describe("users' own tools", () => {
  const save = (token: string, slug = "mine") =>
    request(app)
      .put("/api/tools")
      .set(auth(token))
      .send({ slug, metadata: JSON.stringify({ name: "Mine" }), script: SCRIPT, html: "<p></p>" });

  it("are off until an admin allows them", async () => {
    expect((await save(memberToken)).status).toBe(403);
    await setToolsAccess({ userTools: true });
    const saved = await save(memberToken);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ source: "own", slug: "mine", manifest: { author: "member" } });
    const listed = await request(app).get("/api/tools").set(auth(memberToken));
    expect(listed.body.access.canCreate).toBe(true);
    expect(listed.body.tools.some((t: { id: string }) => t.id === saved.body.id)).toBe(true);
    // Nobody else's.
    expect((await request(app).get("/api/tools").set(auth(adminToken))).body.tools).toEqual([]);
    expect((await request(app).delete(`/api/tools/${saved.body.id}`).set(auth(adminToken))).status).toBe(404);
  });

  it("can't bring models", async () => {
    await setToolsAccess({ userTools: true });
    const res = await request(app)
      .put("/api/tools")
      .set(auth(memberToken))
      .send({
        slug: "models",
        metadata: JSON.stringify({
          name: "x",
          collection: { name: "c", models: [{ key: "a", name: "A", source: "https://thangs.com/m/1" }] },
        }),
        script: SCRIPT,
      });
    expect(res.status).toBe(400);
  });

  it("keep data per user", async () => {
    await setToolsAccess({ userTools: true });
    const tool = (await save(memberToken, "data")).body;
    const base = `/api/tools/${tool.id}/storage`;
    const as = auth(memberToken);
    expect((await request(app).get(`${base}/plan`).set(as)).body).toEqual({ found: false });
    expect(
      (
        await request(app)
          .put(`${base}/plan`)
          .set(as)
          .send({ value: { w: 3, cells: [1, 2] } })
      ).status,
    ).toBe(204);
    expect((await request(app).get(`${base}/plan`).set(as)).body).toEqual({
      found: true,
      value: { w: 3, cells: [1, 2] },
    });
    expect((await request(app).get(base).set(as)).body.keys).toMatchObject([{ key: "plan" }]);
    expect((await request(app).put(`${base}/bad key`).set(as).send({ value: 1 })).status).toBe(400);
    expect((await request(app).delete(`${base}/plan`).set(as)).status).toBe(204);
    expect((await request(app).get(base).set(as)).body.keys).toEqual([]);
    // Another user can't reach someone's own tool at all.
    expect((await request(app).get(base).set(auth(adminToken))).status).toBe(404);
  });
});
