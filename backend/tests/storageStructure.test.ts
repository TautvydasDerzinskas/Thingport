import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { getStorageTemplate, reorganizeManagedPrints, setStorageTemplate } from "../src/services/printService";
import { storageTemplateProblems } from "../src/services/storageTemplateRules";

const app = createApp();
const stamp = Date.now();
let admin: string;
let adminId: string;
// The template is one instance-wide row, so it's put back afterwards.
let previousTemplate: string;

const auth = () => ({ Authorization: `Bearer ${admin}` });
const codes = (template: string) => storageTemplateProblems(template).problems.map((problem) => problem.code);

async function upload(filename: string, contents: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-test-"));
  const file = path.join(dir, filename);
  fs.writeFileSync(file, contents);
  const res = await request(app).post("/api/upload").set(auth()).attach("files", file);
  expect(res.status).toBe(200);
  return res.body.prints[0].id;
}

beforeAll(async () => {
  previousTemplate = await getStorageTemplate();
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: `Browse ${stamp}`, email: `storage-structure-${stamp}@example.com`, password: "password123" });
  admin = res.body.token;
  adminId = res.body.user.id;
  await prisma.user.update({ where: { id: adminId }, data: { role: "ADMIN" } });
});

afterAll(async () => {
  await setStorageTemplate(previousTemplate);
});

describe("storage template rules", () => {
  it("accepts the default and other sensible layouts", () => {
    expect(codes("{category-or-folder}/{model}/{filename}")).toEqual([]);
    expect(codes("Library/{creator}/{model} ({id})/{plate} - {filename}")).toEqual([]);
    expect(codes("{collection}/{id}/{filename}")).toEqual([]);
  });

  it("names what's wrong with a layout that can't work", () => {
    // The one from the report: everything wrong with it, at once.
    expect(
      codes("{category-or-folder}/{creator}/{model}/{id}/{id}/{plate}/{plate}/{id}/{filename}/{id}/{plate}/{plate}"),
    ).toEqual(["filename_not_last", "duplicate_token", "plate_in_folder", "too_deep"]);
    expect(codes("")).toEqual(["empty"]);
    expect(codes("{id}/{bogus}/{filename}")).toEqual(["unknown_token"]);
    expect(codes("{id}/a}/{filename}")).toEqual(["stray_brace"]);
    expect(codes("{id}/{model}")).toEqual(["filename_count"]);
    expect(codes("{id}/{id}/{filename}")).toEqual(["duplicate_token"]);
    expect(codes("{id}/{filename}-{plate}")).toEqual(["filename_not_last"]);
    expect(codes("{id}/{plate}/{filename}")).toEqual(["plate_in_folder"]);
    expect(codes("Props-{category-or-folder}/{model}/{filename}")).toEqual(["category_not_whole_folder"]);
    expect(codes("{id}/what?/{filename}")).toEqual(["unsafe_text"]);
    expect(codes("a/b/c/d/e/f/g/h/{id}/{filename}")).toEqual(["too_deep"]);
  });

  it("refuses layouts where two models could get the same path", () => {
    expect(codes("{creator}/{filename}")).toEqual(["not_unique"]);
    // Model names are only unique within a category.
    expect(codes("{collection}/{model}/{filename}")).toEqual(["not_unique"]);
  });
});

describe("storage settings", () => {
  it("previews a template with its problems, and won't save one that has any", async () => {
    const preview = await request(app)
      .post("/api/settings/storage/preview")
      .set(auth())
      .send({ template: "{creator}/{name}/{filename}" });
    expect(preview.status).toBe(200);
    expect(preview.body.template).toBe("{creator}/{model}/{filename}");
    expect(preview.body.problems).toEqual([{ code: "not_unique" }]);
    expect(preview.body.plate_paths).toHaveLength(2);

    const save = await request(app)
      .post("/api/settings/storage")
      .set(auth())
      .send({ template: "{creator}/{model}/{filename}" });
    expect(save.status).toBe(400);
    expect(save.body.code).toBe("invalid_storage_template");
  });

  it("reports a template saved before the rules, which keeps working", async () => {
    await setStorageTemplate("{creator}/{filename}");
    const res = await request(app).get("/api/settings/storage").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.template).toBe("{creator}/{filename}");
    expect(res.body.problems).toEqual([{ code: "not_unique" }]);
  });
});

describe("files with the same path", () => {
  it("never overwrite each other: the second goes in a folder named after its model", async () => {
    await setStorageTemplate("{creator}/{filename}");
    const first = await upload(`clash-${stamp}.stl`, "solid first endsolid");
    const second = await upload(`clash-${stamp}.stl`, "solid second endsolid");
    const [a, b] = await Promise.all(
      [first, second].map((printId) => prisma.plate.findFirstOrThrow({ where: { printId } })),
    );
    expect(b.storagePath).toBe(path.join(path.dirname(a.storagePath), second, `clash-${stamp}.stl`));
    expect(fs.readFileSync(path.join(STORAGE, a.storagePath), "utf8")).toBe("solid first endsolid");
    expect(fs.readFileSync(path.join(STORAGE, b.storagePath), "utf8")).toBe("solid second endsolid");

    // Reorganizing leaves both where they are, rather than swapping or refusing them.
    await reorganizeManagedPrints(undefined, adminId);
    const after = await prisma.plate.findMany({ where: { id: { in: [a.id, b.id] } }, orderBy: { position: "asc" } });
    expect(new Set(after.map((plate) => plate.storagePath))).toEqual(new Set([a.storagePath, b.storagePath]));
  });
});

describe("moving files to a new structure", () => {
  it("moves every model's files in the background after saving, and says when it's done", async () => {
    await setStorageTemplate("{category-or-folder}/{model}/{filename}");
    const printId = await upload(`mover-${stamp}.stl`, "solid mover endsolid");
    const template = "{category-or-folder}/{model}/{id}/{filename}";

    const impact = await request(app).post("/api/settings/storage/impact").set(auth()).send({ template });
    expect(impact.status).toBe(200);
    expect(impact.body.files).toBeGreaterThanOrEqual(1);

    const save = await request(app).post("/api/settings/storage").set(auth()).send({ template });
    expect(save.status).toBe(200);
    expect(save.body.move).toMatchObject({ running: true });
    // One at a time: a second structure would race the first.
    const again = await request(app).post("/api/settings/storage").set(auth()).send({ template });
    expect(again.status).toBe(409);

    for (let i = 0; i < 300; i++) {
      const state = await request(app).get("/api/settings/storage/move").set(auth());
      if (!state.body.move.running) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const plate = await prisma.plate.findFirstOrThrow({ where: { printId } });
    expect(plate.storagePath).toBe(
      path.join(`u-${adminId}`, "Unassigned", `mover-${stamp}`, printId, `mover-${stamp}.stl`),
    );
    expect(fs.readFileSync(path.join(STORAGE, plate.storagePath), "utf8")).toBe("solid mover endsolid");
    expect(
      await prisma.notification.findFirst({ where: { userId: adminId, title: "Model files moved" } }),
    ).not.toBeNull();
  }, 90_000);
});

describe("browsing stored files", () => {
  it("lists a folder per user, then folders and files down to each model's", async () => {
    await setStorageTemplate("{category-or-folder}/{model}/{filename}");
    const printId = await upload(`browse-${stamp}.stl`, "solid browse endsolid");

    const top = await request(app).get("/api/admin/storage/browse").set(auth());
    expect(top.status).toBe(200);
    const mine = top.body.folders.find((folder: { name: string }) => folder.name === `u-${adminId}`);
    expect(mine).toMatchObject({ label: `Browse ${stamp}`, path: `u-${adminId}` });
    expect(mine.files).toBeGreaterThanOrEqual(1);

    const modelFolder = await request(app)
      .get("/api/admin/storage/browse")
      .query({ path: `u-${adminId}/Unassigned/browse-${stamp}` })
      .set(auth());
    expect(modelFolder.status).toBe(200);
    expect(modelFolder.body.crumbs[0]).toMatchObject({ name: `u-${adminId}`, label: `Browse ${stamp}` });
    expect(modelFolder.body.files).toEqual([
      expect.objectContaining({ name: `browse-${stamp}.stl`, print_id: printId, location: "managed" }),
    ]);
  });

  it("refuses paths outside storage and answers 404 for an empty one", async () => {
    expect((await request(app).get("/api/admin/storage/browse").query({ path: "../etc" }).set(auth())).status).toBe(
      400,
    );
    expect((await request(app).get("/api/admin/storage/browse").query({ path: "nope" }).set(auth())).status).toBe(404);
  });
});
