import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { listZipEntries } from "../src/utils/zipReader";
import { addUploadedFiles } from "../src/services/uploadService";
import { STORAGE } from "../src/config";

const app = createApp();

let token: string;
const createdPrintIds: string[] = [];
const createdCategoryIds: string[] = [];

function tmpFile(name: string, contents: string | Buffer): string {
  // supertest uses the basename as the upload filename, so each file gets its own directory.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-test-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, contents);
  return p;
}

async function trackPrint(id: string) {
  createdPrintIds.push(id);
}

async function cleanupPrint(id: string) {
  await request(app).delete(`/api/print/${id}`).set("Authorization", `Bearer ${token}`);
}

const TEST_EMAIL = "test@example.com";
const TEST_PASSWORD = "test-password-123";

beforeAll(async () => {
  // Log in instead if a persistent test DB already has the account.
  let res = await request(app)
    .post("/api/register")
    .send({ displayName: "Test User", email: TEST_EMAIL, password: TEST_PASSWORD });
  if (res.status === 409) {
    res = await request(app).post("/api/login").send({ email: TEST_EMAIL, password: TEST_PASSWORD });
  }
  if (res.status !== 200) {
    throw new Error(`Failed to authenticate during test setup: ${res.status} ${JSON.stringify(res.body)}`);
  }
  token = res.body.token;
});

afterAll(async () => {
  for (const id of createdPrintIds) {
    await cleanupPrint(id).catch(() => undefined);
  }
  for (const id of createdCategoryIds) {
    await request(app)
      .delete(`/api/category/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .catch(() => undefined);
  }
  await prisma.$disconnect();
});

function auth(req: request.Test): request.Test {
  return req.set("Authorization", `Bearer ${token}`);
}

describe("auth", () => {
  it("rejects requests without a token", async () => {
    const res = await request(app).get("/api/prints");
    expect(res.status).toBe(401);
  });

  it("rejects a bad login", async () => {
    const res = await request(app).post("/api/login").send({ email: TEST_EMAIL, password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("rejects login for an email that doesn't exist with the same generic message", async () => {
    const res = await request(app).post("/api/login").send({ email: "nobody@example.com", password: "whatever123" });
    expect(res.status).toBe(401);
    expect(res.body.detail).toBe("Invalid email or password");
  });

  it("rejects registration with a password under 8 characters", async () => {
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "X", email: `short-${Date.now()}@example.com`, password: "short" });
    expect(res.status).toBe(400);
  });

  it("rejects registration with an invalid email", async () => {
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "X", email: "not-an-email", password: "validpass123" });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate email registration", async () => {
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Dup", email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(409);
  });

  it("scopes prints per user -- a second account cannot see or modify the first's", async () => {
    const otherEmail = `other-${Date.now()}@example.com`;
    const registerRes = await request(app)
      .post("/api/register")
      .send({ displayName: "Other", email: otherEmail, password: "other-password-123" });
    expect(registerRes.status).toBe(200);
    const otherToken = registerRes.body.token as string;

    const f = tmpFile("cross-tenant.stl", "solid x endsolid");
    const uploadRes = await auth(request(app).post("/api/upload")).attach("files", f);
    fs.rmSync(f, { force: true });
    expect(uploadRes.status).toBe(200);
    const printId = uploadRes.body.prints[0].id as string;
    await trackPrint(printId);

    const listRes = await request(app).get("/api/prints").set("Authorization", `Bearer ${otherToken}`);
    expect(listRes.body.find((p: { id: string }) => p.id === printId)).toBeUndefined();

    const tagRes = await request(app)
      .post(`/api/print/${printId}/tags`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ tags: ["hijacked"] });
    expect(tagRes.status).toBe(404);
  });
});

describe("tag filtering is case-insensitive", () => {
  it("GET /prints?tags= matches regardless of casing on either side", async () => {
    const f = tmpFile("cased-tag.stl", "solid cased endsolid");
    const uploadRes = await auth(request(app).post("/api/upload")).attach("files", f);
    fs.rmSync(f, { force: true });
    expect(uploadRes.status).toBe(200);
    const printId = uploadRes.body.prints[0].id as string;
    await trackPrint(printId);

    const tagRes = await auth(request(app).post(`/api/print/${printId}/tags`)).send({ tags: ["Fun"] });
    expect(tagRes.status).toBe(200);

    const lower = await auth(request(app).get("/api/prints")).query({ tags: "fun" });
    expect(lower.body.some((p: { id: string }) => p.id === printId)).toBe(true);

    const upper = await auth(request(app).get("/api/prints")).query({ tags: "FUN" });
    expect(upper.body.some((p: { id: string }) => p.id === printId)).toBe(true);

    const tagsList = await auth(request(app).get("/api/tags")).query({ tags: "fun" });
    expect(tagsList.body).toContain("Fun");
  });
});

describe("upload: separate vs multiplate", () => {
  it("uploading a single file creates a one-plate print", async () => {
    const f = tmpFile("solo.stl", "solid solo endsolid");
    const res = await auth(request(app).post("/api/upload")).attach("files", f);
    expect(res.status).toBe(200);
    expect(res.body.prints).toHaveLength(1);
    expect(res.body.prints[0].plates).toHaveLength(1);
    expect(res.body.prints[0].plates[0].filename).toBe("solo.stl");
    await trackPrint(res.body.prints[0].id);
    fs.rmSync(f, { force: true });
  });

  it("mode=separate creates one print per file", async () => {
    const f1 = tmpFile("sep1.stl", "solid sep1 endsolid");
    const f2 = tmpFile("sep2.stl", "solid sep2 endsolid");
    const res = await auth(request(app).post("/api/upload"))
      .field("mode", "separate")
      .attach("files", f1)
      .attach("files", f2);
    expect(res.status).toBe(200);
    expect(res.body.prints).toHaveLength(2);
    for (const p of res.body.prints) {
      expect(p.plates).toHaveLength(1);
      await trackPrint(p.id);
    }
    fs.rmSync(f1, { force: true });
    fs.rmSync(f2, { force: true });
  });

  it("mode=multiplate creates one print with several plates in submitted order", async () => {
    const f1 = tmpFile("multi-a.stl", "solid a endsolid");
    const f2 = tmpFile("multi-b.stl", "solid b endsolid");
    const f3 = tmpFile("multi-c.stl", "solid c endsolid");
    const res = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .field("title", "Multi Test Print")
      .attach("files", f1)
      .attach("files", f2)
      .attach("files", f3);
    expect(res.status).toBe(200);
    expect(res.body.prints).toHaveLength(1);
    const print = res.body.prints[0];
    expect(print.plates.map((p: any) => p.filename)).toEqual(["multi-a.stl", "multi-b.stl", "multi-c.stl"]);
    expect(print.plates.map((p: any) => p.position)).toEqual([0, 1, 2]);
    await trackPrint(print.id);
    fs.rmSync(f1, { force: true });
    fs.rmSync(f2, { force: true });
    fs.rmSync(f3, { force: true });
  });

  it("requires mode when uploading more than one file without specifying it", async () => {
    const f1 = tmpFile("nomodeA.stl", "solid a endsolid");
    const f2 = tmpFile("nomodeB.stl", "solid b endsolid");
    const res = await auth(request(app).post("/api/upload")).attach("files", f1).attach("files", f2);
    expect(res.status).toBe(400);
    fs.rmSync(f1, { force: true });
    fs.rmSync(f2, { force: true });
  });
});

describe("plate add/remove/reorder/rename", () => {
  let printId: string;
  let plateIds: string[] = [];

  beforeAll(async () => {
    const f1 = tmpFile("plate-x.stl", "solid x endsolid");
    const f2 = tmpFile("plate-y.stl", "solid y endsolid");
    const res = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .field("title", "Plate Ops Print")
      .attach("files", f1)
      .attach("files", f2);
    printId = res.body.prints[0].id;
    plateIds = res.body.prints[0].plates.map((p: any) => p.id);
    await trackPrint(printId);
    fs.rmSync(f1, { force: true });
    fs.rmSync(f2, { force: true });
  });

  it("adds a plate to an existing print", async () => {
    const f = tmpFile("plate-z.stl", "solid z endsolid");
    const res = await auth(request(app).post(`/api/print/${printId}/plates`)).attach("files", f);
    expect(res.status).toBe(200);
    expect(res.body.print.plates).toHaveLength(3);
    expect(res.body.print.plates[2].filename).toBe("plate-z.stl");
    plateIds = res.body.print.plates.map((p: any) => p.id);
    fs.rmSync(f, { force: true });
  });

  it("reorders plates", async () => {
    const reversed = plateIds.toReversed();
    const res = await auth(request(app).post(`/api/print/${printId}/plates/reorder`)).send({ plate_ids: reversed });
    expect(res.status).toBe(200);
    expect(res.body.print.plates.map((p: any) => p.id)).toEqual(reversed);
    expect(res.body.print.plates.map((p: any) => p.position)).toEqual([0, 1, 2]);
  });

  it("renames a plate's filename", async () => {
    const target = plateIds[0];
    const res = await auth(request(app).post(`/api/print/${printId}/plate/${target}/rename`)).send({
      filename: "renamed.stl",
    });
    expect(res.status).toBe(200);
    const renamed = res.body.print.plates.find((p: any) => p.id === target);
    expect(renamed.filename).toBe("renamed.stl");
  });

  it("removes plates down to one, then 409s on the last one", async () => {
    let res = await auth(request(app).delete(`/api/print/${printId}/plates/${plateIds[0]}`));
    expect(res.status).toBe(200);
    expect(res.body.print.plates).toHaveLength(2);
    expect(res.body.print.plates.map((p: any) => p.position)).toEqual([0, 1]);

    res = await auth(request(app).delete(`/api/print/${printId}/plates/${plateIds[1]}`));
    expect(res.status).toBe(200);
    expect(res.body.print.plates).toHaveLength(1);

    const lastPlateId = res.body.print.plates[0].id;
    res = await auth(request(app).delete(`/api/print/${printId}/plates/${lastPlateId}`));
    expect(res.status).toBe(409);
  });

  it("says which plates an upload made, in the order of its files", async () => {
    const made = await auth(request(app).post("/api/upload")).attach("files", tmpFile("base.stl", "solid b endsolid"));
    const modelId = made.body.prints[0].id;
    await trackPrint(modelId);
    // The Edit dialog names and orders the plates it sent by these, so another tab's are never taken for them.
    const res = await auth(request(app).post(`/api/print/${modelId}/plates`))
      .attach("files", tmpFile("lid.stl", "solid l endsolid"))
      .attach("files", tmpFile("arm.stl", "solid a endsolid"));
    expect(res.status).toBe(200);
    const byId = new Map(res.body.print.plates.map((plate: { id: string; filename: string }) => [plate.id, plate]));
    expect(res.body.plate_ids.map((id: string) => (byId.get(id) as { filename: string }).filename)).toEqual([
      "lid.stl",
      "arm.stl",
    ]);
  });

  it("adds none of a batch's files when one can't be stored, so a retry doesn't bring any in twice", async () => {
    const made = await auth(request(app).post("/api/upload")).attach("files", tmpFile("base.stl", "solid b endsolid"));
    const modelId = made.body.prints[0].id;
    await trackPrint(modelId);
    const create = prisma.plate.create.bind(prisma.plate);
    let calls = 0;
    const spy = vi.spyOn(prisma.plate, "create").mockImplementation(((
      args: Parameters<typeof prisma.plate.create>[0],
    ) => {
      calls += 1;
      return calls === 2 ? Promise.reject(new Error("the disk is full")) : create(args);
    }) as never);
    try {
      const res = await auth(request(app).post(`/api/print/${modelId}/plates`))
        .attach("files", tmpFile("lid.stl", "solid l endsolid"))
        .attach("files", tmpFile("arm.stl", "solid a endsolid"));
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(calls).toBe(2);
    const plates = await prisma.plate.findMany({ where: { printId: modelId } });
    expect(plates.map((plate) => plate.filename)).toEqual(["base.stl"]);
  });

  it("leaves nothing of a file whose plate fails after it's stored, so a retry doesn't bring it in twice", async () => {
    const made = await auth(request(app).post("/api/upload")).attach("files", tmpFile("base.stl", "solid b endsolid"));
    const modelId = made.body.prints[0].id;
    await trackPrint(modelId);
    // Its thumbnail step reads the preview setting once the row and file are in.
    const findSetting = prisma.setting.findUnique.bind(prisma.setting);
    const spy = vi
      .spyOn(prisma.setting, "findUnique")
      .mockImplementation(((args: Parameters<typeof prisma.setting.findUnique>[0]) =>
        args.where.key === "preview_mode"
          ? Promise.reject(new Error("the settings went away"))
          : findSetting(args)) as never);
    try {
      const res = await auth(request(app).post(`/api/print/${modelId}/plates`)).attach(
        "files",
        tmpFile("lid.stl", "solid l endsolid"),
      );
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    const plates = await prisma.plate.findMany({ where: { printId: modelId } });
    expect(plates.map((plate) => plate.filename)).toEqual(["base.stl"]);
    expect(fs.existsSync(path.join(STORAGE, path.dirname(plates[0].storagePath), "lid.stl"))).toBe(false);
  });

  it("packs a .gltf sent with its .bin into one .glb plate, and refuses one sent without it", async () => {
    const made = await auth(request(app).post("/api/upload")).attach("files", tmpFile("base.stl", "solid b endsolid"));
    const modelId = made.body.prints[0].id;
    await trackPrint(modelId);
    const positions = Buffer.from(new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0]).buffer);
    const gltf = JSON.stringify({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{ uri: "tri.bin", byteLength: positions.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [0.01, 0.01, 0] }],
    });
    const res = await auth(request(app).post(`/api/print/${modelId}/plates`))
      .attach("files", tmpFile("tri.gltf", gltf))
      .attach("files", tmpFile("tri.bin", positions));
    expect(res.status).toBe(200);
    expect(res.body.plate_ids).toHaveLength(1);
    const byId = new Map(res.body.print.plates.map((plate: { id: string; filename: string }) => [plate.id, plate]));
    expect((byId.get(res.body.plate_ids[0]) as { filename: string }).filename).toBe("tri.glb");
    expect(res.body.print.plates).toHaveLength(2);

    const lone = await auth(request(app).post(`/api/print/${modelId}/plates`)).attach(
      "files",
      tmpFile("tri.gltf", gltf),
    );
    expect(lone.status).toBe(400);
    expect(JSON.stringify(lone.body)).toContain("tri.bin");
    expect(await prisma.plate.count({ where: { printId: modelId } })).toBe(2);
  });

  // The Edit dialog's order for swapping a model's only file for an edited copy of the same name.
  it("replaces the only plate with a same-named file: upload, delete the old one, rename back", async () => {
    let res = await auth(request(app).get(`/api/print/${printId}`));
    const [original] = res.body.plates;

    res = await auth(request(app).post(`/api/print/${printId}/plates`)).attach(
      "files",
      tmpFile(original.filename, "solid replacement endsolid"),
    );
    const added = res.body.print.plates.find((p: any) => p.id !== original.id);
    expect(added.filename).not.toBe(original.filename); // suffixed while the old one exists

    res = await auth(request(app).delete(`/api/print/${printId}/plates/${original.id}`));
    expect(res.status).toBe(200);
    res = await auth(request(app).post(`/api/print/${printId}/plate/${added.id}/rename`)).send({
      filename: original.filename,
    });
    expect(res.status).toBe(200);
    expect(res.body.print.plates).toEqual([expect.objectContaining({ id: added.id, filename: original.filename })]);
  });
});

describe("category CRUD + cycle rejection", () => {
  it("creates, lists, updates, and deletes a category", async () => {
    const create = await auth(request(app).post("/api/categories")).send({ name: "Test Category A", tags: ["x"] });
    expect(create.status).toBe(200);
    const categoryId = create.body.id;

    const list = await auth(request(app).get("/api/categories"));
    expect(list.status).toBe(200);
    expect(list.body.some((f: any) => f.id === categoryId)).toBe(true);

    const update = await auth(request(app).patch(`/api/category/${categoryId}`)).send({
      name: "Test Category A Renamed",
      tags: [],
    });
    expect(update.status).toBe(200);
    expect(update.body.name).toBe("Test Category A Renamed");

    const del = await auth(request(app).delete(`/api/category/${categoryId}`));
    expect(del.status).toBe(200);
  });

  it("rejects a parent that does not exist", async () => {
    const res = await auth(request(app).post("/api/categories")).send({
      name: "Orphan",
      tags: [],
      parent_id: "does-not-exist",
    });
    expect(res.status).toBe(400);
  });

  it("rejects creating a cycle", async () => {
    const parent = await auth(request(app).post("/api/categories")).send({ name: "Cycle Parent", tags: [] });
    const child = await auth(request(app).post("/api/categories")).send({
      name: "Cycle Child",
      tags: [],
      parent_id: parent.body.id,
    });
    const attempt = await auth(request(app).patch(`/api/category/${parent.body.id}`)).send({
      name: "Cycle Parent",
      tags: [],
      parent_id: child.body.id,
    });
    expect(attempt.status).toBe(400);

    await auth(request(app).delete(`/api/category/${child.body.id}`));
    await auth(request(app).delete(`/api/category/${parent.body.id}`));
  });
});

describe("prepared-print attach/detect/remove", () => {
  let printId: string;

  beforeAll(async () => {
    const f = tmpFile("bare.stl", "solid bare endsolid");
    const res = await auth(request(app).post("/api/upload")).attach("files", f);
    printId = res.body.prints[0].id;
    await trackPrint(printId);
    fs.rmSync(f, { force: true });
  });

  it("starts with no prepared print", async () => {
    const res = await auth(request(app).get("/api/prints"));
    const print = res.body.find((p: any) => p.id === printId);
    expect(print.prepared_print).toBeNull();
  });

  it("attaches an explicit prepared gcode file", async () => {
    const gcode = tmpFile(
      "sliced.gcode",
      "; printer_model = Bambu Lab X1 Carbon\n; filament_type = PETG\n; nozzle_diameter = 0.4\n; layer_height = 0.16\n; estimated printing time (normal mode) = 1h 5m\nG28\n",
    );
    const res = await auth(request(app).post(`/api/print/${printId}/files`)).attach("file", gcode);
    expect(res.status).toBe(200);
    expect(res.body.print.prepared_print).toMatchObject({
      printer: "Bambu Lab X1 Carbon",
      material: "PETG",
      nozzle_mm: 0.4,
      layer_height_mm: 0.16,
      removable: true,
    });
    expect(res.body.print.slicer_filename).toBe("sliced.gcode");
    fs.rmSync(gcode, { force: true });
  });

  it("keeps the first sliced file of an upload as its prepared print and the rest as supporting files", async () => {
    const stl = tmpFile("frog.stl", "solid frog endsolid");
    const first = tmpFile("first.gcode", "; printer_model = Bambu Lab P1S\nG28\n");
    const second = tmpFile("second.gcode", "; printer_model = Bambu Lab A1\nG28\n");
    const res = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", stl)
      .attach("files", first)
      .attach("files", second);
    expect(res.status).toBe(200);
    const uploaded = res.body.prints[0];
    await trackPrint(uploaded.id);
    expect(uploaded.slicer_filename).toBe("first.gcode");
    const files = await auth(request(app).get(`/api/print/${uploaded.id}/files`));
    expect(files.body.map((file: { filename: string }) => file.filename)).toEqual(["second.gcode"]);
    for (const file of [stl, first, second]) fs.rmSync(file, { force: true });
  });

  it("removes the prepared file and falls back to null (bare .stl isn't sniffable)", async () => {
    const res = await auth(request(app).delete(`/api/print/${printId}/prepared-print`));
    expect(res.status).toBe(200);
    expect(res.body.print.prepared_print).toBeNull();
  });
});

describe("uploads of one model's several files", () => {
  it("keeps each file in its folder, and a sliced 3MF beside the model files as its prepared print", async () => {
    const stl = tmpFile("body.stl", "solid body endsolid");
    const guide = tmpFile("guide.pdf", "%PDF-1.4 guide");
    const sliced = tmpFile("sliced.gcode.3mf", "not really a 3mf");
    const res = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .field("folders", JSON.stringify(["parts", "docs", null]))
      .attach("files", stl)
      .attach("files", guide)
      .attach("files", sliced);
    expect(res.status).toBe(200);
    const uploaded = res.body.prints[0];
    await trackPrint(uploaded.id);
    expect(
      uploaded.plates.map((plate: { filename: string; folder: string | null }) => [plate.filename, plate.folder]),
    ).toEqual([["body.stl", "parts"]]);
    const files = await prisma.printFile.findMany({ where: { printId: uploaded.id }, orderBy: { filename: "asc" } });
    expect(files.map((file) => [file.filename, file.role, file.folder])).toEqual([
      ["guide.pdf", "SUPPORTING", "docs"],
      ["sliced.gcode.3mf", "PREPARED", null],
    ]);
    for (const file of [stl, guide, sliced]) fs.rmSync(file, { force: true });
  });

  it("makes a sliced 3MF the plate when there's no other model file, the rest beside it as with a model file", async () => {
    const sliced = tmpFile("frog.gcode.3mf", "not really a 3mf");
    const guide = tmpFile("frog guide.pdf", "%PDF-1.4 guide");
    const picture = tmpFile("frog.png", "not really a png");
    const res = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", sliced)
      .attach("files", guide)
      .attach("files", picture);
    expect(res.status).toBe(200);
    const uploaded = res.body.prints[0];
    await trackPrint(uploaded.id);
    expect(uploaded.plates.map((plate: { filename: string }) => plate.filename)).toEqual(["frog.gcode.3mf"]);
    const files = await prisma.printFile.findMany({ where: { printId: uploaded.id }, orderBy: { filename: "asc" } });
    expect(files.map((file) => [file.filename, file.role])).toEqual([
      ["frog guide.pdf", "SUPPORTING"],
      ["frog.png", "SUPPORTING"],
    ]);
    for (const file of [sliced, guide, picture]) fs.rmSync(file, { force: true });
  });

  it("makes a picture the plate when there's no model file, and keeps a document beside it", async () => {
    const picture = tmpFile("sign.png", "not really a png");
    const notes = tmpFile("sign notes.txt", "cut at 80% power");
    const res = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", picture)
      .attach("files", notes);
    expect(res.status).toBe(200);
    const uploaded = res.body.prints[0];
    await trackPrint(uploaded.id);
    expect(uploaded.plates.map((plate: { filename: string }) => plate.filename)).toEqual(["sign.png"]);
    const files = await prisma.printFile.findMany({ where: { printId: uploaded.id } });
    expect(files.map((file) => [file.filename, file.role])).toEqual([["sign notes.txt", "SUPPORTING"]]);
    for (const file of [picture, notes]) fs.rmSync(file, { force: true });
  });

  it("keeps a lone file in its folder, as it would one of several, and one sent without a folder at the top", async () => {
    // A zip's "parts/body.stl" beside its photo: the photo goes to the gallery, leaving the model file to go up alone.
    const stl = tmpFile("body.stl", "solid body endsolid");
    const inFolder = await auth(request(app).post("/api/upload"))
      .field("folders", JSON.stringify(["parts"]))
      .attach("files", stl);
    expect(inFolder.status).toBe(200);
    await trackPrint(inFolder.body.prints[0].id);
    expect(inFolder.body.prints[0].plates.map((plate: { folder: string | null }) => plate.folder)).toEqual(["parts"]);

    const plain = await auth(request(app).post("/api/upload")).attach("files", stl);
    expect(plain.status).toBe(200);
    await trackPrint(plain.body.prints[0].id);
    expect(plain.body.prints[0].plates.map((plate: { folder: string | null }) => plate.folder)).toEqual([null]);

    // Each a model of its own, separate files have no model to be in a folder of.
    const other = tmpFile("lid.stl", "solid lid endsolid");
    const separate = await auth(request(app).post("/api/upload"))
      .field("mode", "separate")
      .field("folders", JSON.stringify(["parts", "parts"]))
      .attach("files", stl)
      .attach("files", other);
    expect(separate.status).toBe(200);
    for (const print of separate.body.prints) await trackPrint(print.id);
    expect(
      separate.body.prints.flatMap((print: { plates: { folder: string | null }[] }) =>
        print.plates.map((p) => p.folder),
      ),
    ).toEqual([null, null]);
    for (const file of [stl, other]) fs.rmSync(file, { force: true });
  });

  it("refuses folders that don't line up with the files", async () => {
    const a = tmpFile("a.stl", "solid a endsolid");
    const b = tmpFile("b.stl", "solid b endsolid");
    const res = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .field("folders", JSON.stringify(["only one"]))
      .attach("files", a)
      .attach("files", b);
    expect(res.status).toBe(400);
    for (const file of [a, b]) fs.rmSync(file, { force: true });
  });

  it("keeps a model's prepared print when files added with a sliced one fail", async () => {
    const stl = tmpFile("held.stl", "solid held endsolid");
    const made = await auth(request(app).post("/api/upload")).attach("files", stl);
    const printId = made.body.prints[0].id;
    await trackPrint(printId);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: TEST_EMAIL } });
    const old = tmpFile("old.gcode", "; printer_model = Bambu Lab P1S\nG28\n");
    await addUploadedFiles(user.id, printId, [{ path: old, originalname: "old.gcode" }]);
    const { preparedFile: kept } = await prisma.print.findUniqueOrThrow({
      where: { id: printId },
      include: { preparedFile: true },
    });
    expect(kept?.filename).toBe("old.gcode");

    // The sliced file first, then one that can't be stored: its temp file is gone.
    const replacement = tmpFile("new.gcode", "; printer_model = Bambu Lab A1\nG28\n");
    const gone = path.join(path.dirname(replacement), "gone.txt");
    await expect(
      addUploadedFiles(user.id, printId, [
        { path: replacement, originalname: "new.gcode" },
        { path: gone, originalname: "gone.txt" },
      ]),
    ).rejects.toThrow(/ENOENT/);
    const after = await prisma.print.findUniqueOrThrow({ where: { id: printId }, include: { preparedFile: true } });
    expect(after.preparedFile?.id).toBe(kept?.id);
    expect(after.preparedFile && fs.existsSync(path.join(STORAGE, after.preparedFile.storagePath))).toBe(true);
    expect(await prisma.printFile.count({ where: { printId } })).toBe(1);
    for (const file of [stl, replacement]) fs.rmSync(file, { force: true });
  });

  it("keeps a sliced file asked for as a supporting one as that, rather than the prepared print", async () => {
    const stl = tmpFile("own.stl", "solid own endsolid");
    const made = await auth(request(app).post("/api/upload")).attach("files", stl);
    const printId = made.body.prints[0].id;
    await trackPrint(printId);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: TEST_EMAIL } });
    const gcode = tmpFile("kept.gcode", "; sliced\nG28\n");
    await addUploadedFiles(user.id, printId, [{ path: gcode, originalname: "kept.gcode", kind: "supporting" }]);
    const files = await prisma.printFile.findMany({ where: { printId } });
    expect(files.map((file) => [file.filename, file.role])).toEqual([["kept.gcode", "SUPPORTING"]]);
    fs.rmSync(stl, { force: true });
  });
});

describe("zip download arcname structure", () => {
  it("nests plates under {category}/{print.name}/ and supporting files under .../supporting/", async () => {
    const category = await auth(request(app).post("/api/categories")).send({ name: "Zip Category Test", tags: [] });
    createdCategoryIds.push(category.body.id);

    const f = tmpFile("zippy.stl", "solid zippy endsolid");
    const upload = await auth(request(app).post("/api/upload"))
      .field("title", "Zippy Print")
      .field("category_id", category.body.id)
      .attach("files", f);
    const printId = upload.body.prints[0].id;
    createdPrintIds.push(printId);
    fs.rmSync(f, { force: true });

    const note = tmpFile("readme.txt", "hello");
    await auth(request(app).post(`/api/print/${printId}/files`)).attach("file", note);
    fs.rmSync(note, { force: true });

    const zipRes = await auth(request(app).post("/api/download/zip"))
      .send({ print_ids: [printId] })
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(zipRes.status).toBe(200);

    const tmpZip = path.join(os.tmpdir(), `test-${Date.now()}.zip`);
    fs.writeFileSync(tmpZip, zipRes.body as Buffer);
    const entries = await listZipEntries(tmpZip);
    const names = entries
      .filter((e) => !e.isDirectory)
      .map((e) => e.name)
      .toSorted();
    expect(names).toEqual([
      "Zip Category Test/Zippy Print/supporting/readme.txt",
      "Zip Category Test/Zippy Print/zippy.stl",
    ]);
    fs.rmSync(tmpZip, { force: true });
  });
});
