import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import JSZip from "jszip";
import { createApp } from "../src/app";
import { BUNDLES, STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { listZipEntries } from "../src/utils/zipReader";
import { resolvePlateFilePath } from "../src/services/printCreation";
import { printFilePathFree } from "../src/services/printService";
import { checkLibraryInvariants } from "./harness";
import { faults, pauseAt, track } from "./harness/lifecycle";
import { disputeTransactions } from "./helpers/transactions";

const app = createApp();

let token: string;
let userId: string;
const createdPrintIds: string[] = [];
const createdCategoryIds: string[] = [];

function tmpFile(name: string, contents: string): string {
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
  userId = res.body.user.id;
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
    const previousIds = new Set(plateIds);
    const f = tmpFile("plate-z.stl", "solid z endsolid");
    const res = await auth(request(app).post(`/api/print/${printId}/plates`)).attach("files", f);
    expect(res.status).toBe(200);
    expect(res.body.print.plates).toHaveLength(3);
    expect(res.body.print.plates[2].filename).toBe("plate-z.stl");
    const addedIds = res.body.print.plates.filter((p: any) => !previousIds.has(p.id)).map((p: any) => p.id);
    expect(res.body.added_plate_ids).toEqual(addedIds);
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

  it("numbers an upload when a rename took its filename during file placement", async () => {
    const originalBytes = Buffer.from("original plate bytes");
    const submittedBytes = Buffer.from("new plate bytes");
    const uploadId = randomUUID();
    const filename = `thingport-upload-${uploadId}-new.gcode.3mf`;
    const uploaded = await auth(request(app).post("/api/upload"))
      .attach("files", originalBytes, "old.gcode.3mf")
      .expect(200);
    const model = uploaded.body.prints[0];
    const modelId: string = model.id;
    const originalId: string = model.plates[0].id;
    await trackPrint(modelId);

    const placement = pauseAt("fileState:path.taken");
    const append = track(
      Promise.resolve(
        auth(request(app).post(`/api/print/${modelId}/plates`)).attach("files", submittedBytes, filename),
      ),
    );
    try {
      await placement.reachedBy(append);
      await auth(request(app).post(`/api/print/${modelId}/plate/${originalId}/rename`))
        .send({ filename })
        .expect(200);
    } finally {
      placement.release();
    }

    const res = await append;
    expect(res.status).toBe(200);
    const [appendedId] = res.body.added_plate_ids;
    const plates = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
    expect(plates.map((plate) => [plate.id, plate.filename])).toEqual([
      [originalId, filename],
      [appendedId, `thingport-upload-${uploadId}-new (2).gcode.3mf`],
    ]);
    expect(
      plates.map((plate) => {
        const file = resolvePlateFilePath(plate);
        if (!file) throw new Error("Expected a readable plate");
        return fs.readFileSync(file);
      }),
    ).toEqual([originalBytes, submittedBytes]);
    expect(
      await prisma.plateUploadAttempt.findUnique({
        where: { printId_clientUploadId: { printId: modelId, clientUploadId: uploadId } },
      }),
    ).toMatchObject({ status: "complete", plateId: appendedId });
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("keeps swapped names and readable bytes after a storage move fails", async () => {
    const uploaded = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", Buffer.from("solid first endsolid"), "swap-a.stl")
      .attach("files", Buffer.from("solid second endsolid"), "swap-b.stl");
    expect(uploaded.status).toBe(200);
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const [first, second] = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
    const badName = await auth(request(app).post(`/api/print/${modelId}/plate/${first.id}/rename`)).send({
      filename: "swap-a",
    });
    expect(badName.status).toBe(400);
    const gone = await auth(request(app).post(`/api/print/${modelId}/plates/rename`)).send({
      renames: [{ plate_id: "no-such-plate", filename: "swap-c.stl" }],
    });
    expect(gone.status).toBe(404);
    expect(gone.body.code).toBe("plate_not_found");

    const swap = () =>
      auth(request(app).post(`/api/print/${modelId}/plates/rename`)).send({
        renames: [
          { plate_id: first.id, filename: second.filename },
          { plate_id: second.id, filename: first.filename },
        ],
      });
    const firstPath = resolvePlateFilePath(first);
    const rename = fsPromises.rename;
    const failMove = vi.spyOn(fsPromises, "rename").mockImplementation(async (from, to) => {
      if (String(from) === firstPath) throw new Error("Storage move failed");
      return rename(from, to);
    });
    try {
      expect((await swap()).status).toBe(500);
      expect(failMove.mock.calls.some(([from]) => String(from) === firstPath)).toBe(true);
    } finally {
      failMove.mockRestore();
    }
    const stuck = await prisma.plate.findUniqueOrThrow({ where: { id: first.id } });
    // The names committed; the first plate's file stayed where the failed move found it.
    expect(stuck.storagePath).toBe(first.storagePath);

    const expectSwap = async () => {
      const stored = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
      expect(stored.map((plate) => plate.filename)).toEqual(["swap-b.stl", "swap-a.stl"]);
      const contents = stored.map((plate) => {
        const file = resolvePlateFilePath(plate);
        if (!file) throw new Error("Expected a readable plate");
        return fs.readFileSync(file, "utf8");
      });
      expect(contents).toEqual(["solid first endsolid", "solid second endsolid"]);
    };
    await expectSwap();
    expect((await swap()).status).toBe(200);
    await expectSwap();
    const moved = await prisma.plate.findUniqueOrThrow({ where: { id: first.id } });
    expect(path.basename(moved.storagePath)).toBe("swap-b.stl");
    expect(fs.readFileSync(resolvePlateFilePath(moved) ?? "", "utf8")).toBe("solid first endsolid");
    // Neither attempt left a copy behind.
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("records no name when a file a rename would move can't be looked at", async () => {
    const uploaded = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", Buffer.from("solid look a endsolid"), "look-a.stl")
      .attach("files", Buffer.from("solid look b endsolid"), "look-b.stl");
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const before = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
    const rename = () =>
      auth(request(app).post(`/api/print/${modelId}/plates/rename`)).send({
        renames: [{ plate_id: before[1].id, filename: "look-c.stl" }],
      });

    faults.at("fileState:rename.look", 1, "EIO");
    expect((await rename()).status).toBe(500);
    const after = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
    expect(after.map((plate) => [plate.filename, plate.storagePath])).toEqual(
      before.map((plate) => [plate.filename, plate.storagePath]),
    );

    expect((await rename()).status).toBe(200);
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("removes a plate only once a rename has moved its file", async () => {
    const uploaded = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", Buffer.from("solid move a endsolid"), "move-a.stl")
      .attach("files", Buffer.from("solid move b endsolid"), "move-b.stl");
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const [moving] = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });

    const move = pauseAt("fileState:move.source");
    const rename = track(
      Promise.resolve(
        auth(request(app).post(`/api/print/${modelId}/plate/${moving.id}/rename`)).send({ filename: "moved-a.stl" }),
      ),
    );
    await move.reachedBy(rename);
    const queued = pauseAt("lock:plate.rename");
    const removal = track(Promise.resolve(auth(request(app).delete(`/api/print/${modelId}/plates/${moving.id}`))));
    try {
      // Queued behind the rename, whose names are committed and whose file is still moving: nothing of it ran yet.
      await queued.reachedBy(removal);
      expect(await prisma.plate.findUnique({ where: { id: moving.id } })).not.toBeNull();
    } finally {
      queued.release();
      move.release();
    }

    expect((await rename).status).toBe(200);
    expect((await removal).status).toBe(200);
    expect(await prisma.plate.findUnique({ where: { id: moving.id } })).toBeNull();
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("numbers the second of two uploads of a name that both found the same path free", async () => {
    const uploaded = await auth(request(app).post("/api/upload")).attach(
      "files",
      Buffer.from("solid base endsolid"),
      "base.stl",
    );
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const firstLook = pauseAt("fileState:path.taken");
    const secondLook = pauseAt("fileState:path.taken", 2);
    const post = (bytes: string) =>
      track(
        Promise.resolve(
          auth(request(app).post(`/api/print/${modelId}/plates`)).attach("files", Buffer.from(bytes), "bracket.stl"),
        ),
      );
    const first = post("solid first bracket endsolid");
    const second = post("solid second bracket endsolid");
    try {
      await firstLook.reachedBy(first);
      await secondLook.reachedBy(second);
    } finally {
      firstLook.release();
      secondLook.release();
    }

    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    const plates = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
    expect(plates.map((plate) => plate.filename).toSorted()).toEqual(["base.stl", "bracket (2).stl", "bracket.stl"]);
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("puts both files of a swap where their new names say, in one request", async () => {
    const uploaded = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", Buffer.from("solid pair a endsolid"), "pair-a.stl")
      .attach("files", Buffer.from("solid pair b endsolid"), "pair-b.stl");
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const [a, b] = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });

    const res = await auth(request(app).post(`/api/print/${modelId}/plates/rename`)).send({
      renames: [
        { plate_id: a.id, filename: "pair-b.stl" },
        { plate_id: b.id, filename: "pair-a.stl" },
      ],
    });
    expect(res.status).toBe(200);
    const stored = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
    expect(stored.map((plate) => [plate.filename, path.basename(plate.storagePath)])).toEqual([
      ["pair-b.stl", "pair-b.stl"],
      ["pair-a.stl", "pair-a.stl"],
    ]);
    // Both in the model's folder: a move left aside while its target was held sits under the model's id.
    const [folderA, folderB] = stored.map((plate) => path.dirname(plate.storagePath));
    expect(folderA).toBe(folderB);
    expect(path.basename(folderA)).not.toBe(modelId);
    expect(stored.map((plate) => fs.readFileSync(resolvePlateFilePath(plate) ?? "", "utf8"))).toEqual([
      "solid pair a endsolid",
      "solid pair b endsolid",
    ]);
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("keeps an upload's ID when the name's cut takes the marker's last character", async () => {
    const uploaded = await auth(request(app).post("/api/upload")).attach(
      "files",
      Buffer.from("solid own endsolid"),
      "own.stl",
    );
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const clientUploadId = randomUUID();
    // Combining marks join the marker's last hyphen into one character, which the byte limit cuts whole.
    const filename = `thingport-upload-${clientUploadId}-${"\u0301".repeat(100)}part.stl`;
    const upload = () =>
      auth(request(app).post(`/api/print/${modelId}/plates`)).attach(
        "files",
        Buffer.from("solid marked endsolid"),
        filename,
      );

    const first = await upload();
    expect(first.status).toBe(200);
    expect(
      await prisma.plateUploadAttempt.findUnique({
        where: { printId_clientUploadId: { printId: modelId, clientUploadId } },
      }),
    ).toMatchObject({ status: "complete", plateId: first.body.added_plate_ids[0] });
    const replay = await upload();
    expect(replay.status).toBe(200);
    expect(replay.body.added_plate_ids).toEqual(first.body.added_plate_ids);
    // The premise: the stored name kept its extension and lost the marker's end.
    const stored = await prisma.plate.findUniqueOrThrow({ where: { id: first.body.added_plate_ids[0] } });
    expect(stored.filename.endsWith(".stl")).toBe(true);
    expect(stored.filename.startsWith(`thingport-upload-${clientUploadId}-`)).toBe(false);
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("reorders only once a rename has moved its files", async () => {
    const uploaded = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", Buffer.from("solid order a endsolid"), "order-a.stl")
      .attach("files", Buffer.from("solid order b endsolid"), "order-b.stl");
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const [a, b] = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });

    const move = pauseAt("fileState:move.source");
    const rename = track(
      Promise.resolve(
        auth(request(app).post(`/api/print/${modelId}/plate/${a.id}/rename`)).send({ filename: "order-c.stl" }),
      ),
    );
    await move.reachedBy(rename);
    const queued = pauseAt("lock:plate.rename");
    const reorder = track(
      Promise.resolve(
        auth(request(app).post(`/api/print/${modelId}/plates/reorder`)).send({ plate_ids: [b.id, a.id] }),
      ),
    );
    try {
      // Queued behind the rename, which renders its file's path from the position it read: nothing has moved yet.
      await queued.reachedBy(reorder);
      expect((await prisma.plate.findUniqueOrThrow({ where: { id: a.id } })).position).toBe(0);
    } finally {
      queued.release();
      move.release();
    }

    expect((await rename).status).toBe(200);
    expect((await reorder).status).toBe(200);
    const plates = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
    expect(plates.map((plate) => plate.id)).toEqual([b.id, a.id]);
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("says a rename is unfinished when its names are saved and a file couldn't move", async () => {
    const uploaded = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", Buffer.from("solid stuck endsolid"), "stuck.stl")
      .attach("files", Buffer.from("solid other endsolid"), "other.stl");
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const [stuck] = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
    // Files no plate owns at the new name's place and at the place a taken one falls back to.
    const folder = path.dirname(stuck.storagePath);
    const blockers = [path.join(folder, "unstuck.stl"), path.join(folder, modelId, "unstuck.stl")].map((relative) =>
      path.join(STORAGE, relative),
    );
    const rename = () =>
      auth(request(app).post(`/api/print/${modelId}/plate/${stuck.id}/rename`)).send({ filename: "unstuck.stl" });
    try {
      for (const blocker of blockers) {
        fs.mkdirSync(path.dirname(blocker), { recursive: true });
        fs.writeFileSync(blocker, "in the way");
      }
      const unfinished = await rename();
      expect(unfinished.status).toBe(409);
      expect(unfinished.body.code).toBe("rename_unfinished");
      expect(await prisma.plate.findUniqueOrThrow({ where: { id: stuck.id } })).toMatchObject({
        filename: "unstuck.stl",
        storagePath: stuck.storagePath,
      });
    } finally {
      for (const blocker of blockers) fs.rmSync(blocker, { force: true });
    }
    expect((await rename()).status).toBe(200);
    const moved = await prisma.plate.findUniqueOrThrow({ where: { id: stuck.id } });
    expect(moved.storagePath).toBe(path.join(folder, "unstuck.stl"));
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("finishes a swap a failed request left halfway when its files are then renamed one at a time", async () => {
    const uploaded = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", Buffer.from("solid half a endsolid"), "half-a.stl")
      .attach("files", Buffer.from("solid half b endsolid"), "half-b.stl");
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const [a, b] = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
    const aPath = resolvePlateFilePath(a);
    const bPath = resolvePlateFilePath(b);
    const rename = fsPromises.rename;
    let refused = false;
    const failMove = vi.spyOn(fsPromises, "rename").mockImplementation(async (from, to) => {
      if (String(from) === bPath) {
        refused = true;
        throw new Error("Storage move failed");
      }
      return rename(from, to);
    });
    try {
      const swap = await auth(request(app).post(`/api/print/${modelId}/plates/rename`)).send({
        renames: [
          { plate_id: a.id, filename: "half-b.stl" },
          { plate_id: b.id, filename: "half-a.stl" },
        ],
      });
      expect(swap.status).toBe(500);
    } finally {
      failMove.mockRestore();
    }
    // Halfway: the first file moved aside to wait for the second's place, and the second never left it.
    expect(refused).toBe(true);
    expect([fs.existsSync(aPath ?? ""), fs.existsSync(bPath ?? "")]).toEqual([false, true]);
    const aside = await prisma.plate.findUniqueOrThrow({ where: { id: a.id } });
    expect(path.dirname(aside.storagePath).split(path.sep).slice(-2)).toEqual([modelId, a.id]);
    expect(fs.readFileSync(resolvePlateFilePath(aside) ?? "", "utf8")).toBe("solid half a endsolid");

    // The names are saved, so the editor's next save finds no swap and renames each file on its own.
    for (const [plate, filename] of [
      [a, "half-b.stl"],
      [b, "half-a.stl"],
    ] as const) {
      const res = await auth(request(app).post(`/api/print/${modelId}/plate/${plate.id}/rename`)).send({ filename });
      expect(res.status).toBe(200);
    }
    const stored = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
    expect(stored.map((plate) => [plate.filename, path.basename(plate.storagePath)])).toEqual([
      ["half-b.stl", "half-b.stl"],
      ["half-a.stl", "half-a.stl"],
    ]);
    const [folderA, folderB] = stored.map((plate) => path.dirname(plate.storagePath));
    expect(folderA).toBe(folderB);
    expect(path.basename(folderA)).not.toBe(modelId);
    expect(stored.map((plate) => fs.readFileSync(resolvePlateFilePath(plate) ?? "", "utf8"))).toEqual([
      "solid half a endsolid",
      "solid half b endsolid",
    ]);
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("swaps two files when the place a taken name falls back to is held too", async () => {
    const uploaded = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", Buffer.from("solid fall a endsolid"), "fall-a.stl")
      .attach("files", Buffer.from("solid fall b endsolid"), "fall-b.stl");
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const [a, b] = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
    // A file no plate owns where the first move's taken name would fall back to.
    const blocker = path.join(STORAGE, path.dirname(a.storagePath), modelId, "fall-b.stl");
    fs.mkdirSync(path.dirname(blocker), { recursive: true });
    fs.writeFileSync(blocker, "in the way");
    try {
      const res = await auth(request(app).post(`/api/print/${modelId}/plates/rename`)).send({
        renames: [
          { plate_id: a.id, filename: "fall-b.stl" },
          { plate_id: b.id, filename: "fall-a.stl" },
        ],
      });
      expect(res.status).toBe(200);
      const stored = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
      expect(stored.map((plate) => path.relative(path.dirname(a.storagePath), plate.storagePath))).toEqual([
        "fall-b.stl",
        "fall-a.stl",
      ]);
      // Each plate, by its id, still has the bytes it was uploaded with.
      for (const [id, bytes] of [
        [a.id, "solid fall a endsolid"],
        [b.id, "solid fall b endsolid"],
      ] as const) {
        const plate = await prisma.plate.findUniqueOrThrow({ where: { id } });
        expect(fs.readFileSync(resolvePlateFilePath(plate) ?? "", "utf8")).toBe(bytes);
      }
      expect(fs.readFileSync(blocker, "utf8")).toBe("in the way");
    } finally {
      fs.rmSync(blocker, { force: true });
    }
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("goes on when a test's fault lands where a caller queues for the rename lock", async () => {
    const uploaded = await auth(request(app).post("/api/upload")).attach(
      "files",
      Buffer.from("solid q endsolid"),
      "q.stl",
    );
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const [plate] = await prisma.plate.findMany({ where: { printId: modelId } });

    faults.at("lock:plate.rename", 1, "EIO");
    const res = await auth(request(app).post(`/api/print/${modelId}/plate/${plate.id}/rename`)).send({
      filename: "queued.stl",
    });
    expect(res.status).toBe(200);
    const renamed = await prisma.plate.findUniqueOrThrow({ where: { id: plate.id } });
    expect([renamed.filename, path.basename(renamed.storagePath)]).toEqual(["queued.stl", "queued.stl"]);
    expect(fs.readFileSync(resolvePlateFilePath(renamed) ?? "", "utf8")).toBe("solid q endsolid");
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("refuses more pictures in one upload than it holds in memory, before reading them all", async () => {
    const picture = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#cc3366" } })
      .png()
      .toBuffer();
    let upload = auth(request(app).post(`/api/print/${printId}/preview-images`));
    for (let at = 0; at < 21; at++) upload = upload.attach("files", picture, `picture-${at}.png`);
    const res = await upload;
    expect(res.status).toBe(413);
    expect(res.body.detail).toBe("At most 20 pictures go in one upload");
  });

  it("tells a picture sent under another field from one too many", async () => {
    const picture = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#cc3366" } })
      .png()
      .toBuffer();
    const res = await auth(request(app).post(`/api/print/${printId}/preview-images`)).attach(
      "pictures",
      picture,
      "picture.png",
    );
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe("Send the pictures as the files field");
  });

  it("tells too many form fields from too many pictures", async () => {
    const picture = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#cc3366" } })
      .png()
      .toBuffer();
    let upload = auth(request(app).post(`/api/print/${printId}/preview-images`)).attach("files", picture, "one.png");
    for (let at = 0; at < 60; at++) upload = upload.field("note", "x");
    const res = await upload;
    expect(res.status).toBe(413);
    expect(res.body.detail).toBe("The upload has too many form fields");
  });

  it("doesn't take a plate another upload's receipt names for an older server's upload", async () => {
    const uploaded = await auth(request(app).post("/api/upload")).attach(
      "files",
      Buffer.from("solid own endsolid"),
      "own.stl",
    );
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const bytes = Buffer.from("solid claimed endsolid");
    const [firstId, secondId] = [randomUUID(), randomUUID()];
    const upload = (uploadId: string) =>
      auth(request(app).post(`/api/print/${modelId}/plates`)).attach(
        "files",
        bytes,
        `thingport-upload-${uploadId}-claimed.stl`,
      );

    const first = await upload(firstId);
    expect(first.status).toBe(200);
    const [claimedId] = first.body.added_plate_ids;
    // Renamed to the second upload's marker, the name an older server's plate of that upload would have.
    await auth(request(app).post(`/api/print/${modelId}/plate/${claimedId}/rename`))
      .send({ filename: `thingport-upload-${secondId}-claimed.stl` })
      .expect(200);

    const second = await upload(secondId);
    expect(second.status).toBe(200);
    expect(second.body.added_plate_ids).toHaveLength(1);
    expect(second.body.added_plate_ids[0]).not.toBe(claimedId);
    expect(await prisma.plate.count({ where: { printId: modelId } })).toBe(3);
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("keeps a swap's files where its rows say when a saved path's answer is lost", async () => {
    const uploaded = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", Buffer.from("solid lost a endsolid"), "lost-a.stl")
      .attach("files", Buffer.from("solid lost b endsolid"), "lost-b.stl");
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const [a, b] = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
    const swap = () =>
      auth(request(app).post(`/api/print/${modelId}/plates/rename`)).send({
        renames: [
          { plate_id: a.id, filename: "lost-b.stl" },
          { plate_id: b.id, filename: "lost-a.stl" },
        ],
      });
    const update = prisma.plate.update;
    let lostOnce = false;
    // The path saved for the plate waiting aside commits, and its answer is lost.
    const lost = vi.spyOn(prisma.plate, "update").mockImplementation((async (args: {
      data: { storagePath?: unknown };
    }) => {
      const row = await Reflect.apply(update, prisma.plate, [args]);
      if (!lostOnce && typeof args.data.storagePath === "string" && args.data.storagePath.includes(a.id)) {
        lostOnce = true;
        throw new Error("Connection lost after COMMIT");
      }
      return row;
    }) as never);
    try {
      await swap();
    } finally {
      lost.mockRestore();
    }
    expect(lostOnce).toBe(true);

    // The same rename again finishes whatever is left.
    expect((await swap()).status).toBe(200);
    for (const [id, filename, bytes] of [
      [a.id, "lost-b.stl", "solid lost a endsolid"],
      [b.id, "lost-a.stl", "solid lost b endsolid"],
    ] as const) {
      const plate = await prisma.plate.findUniqueOrThrow({ where: { id } });
      expect([plate.filename, path.basename(plate.storagePath)]).toEqual([filename, filename]);
      expect(fs.readFileSync(resolvePlateFilePath(plate) ?? "", "utf8")).toBe(bytes);
    }
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("moves a file back before its next move when a saved path's outcome couldn't be read", async () => {
    const uploaded = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", Buffer.from("solid unread a endsolid"), "unread-a.stl")
      .attach("files", Buffer.from("solid unread b endsolid"), "unread-b.stl");
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const [a] = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
    const rename = () =>
      auth(request(app).post(`/api/print/${modelId}/plates/rename`)).send({
        renames: [{ plate_id: a.id, filename: "unread-c.stl" }],
      });
    const update = prisma.plate.update;
    const findUnique = prisma.plate.findUnique;
    let failed = false;
    let readFailed = false;
    // The file is renamed, the path saved for it doesn't commit, and the read that would tell fails too.
    const saving = vi.spyOn(prisma.plate, "update").mockImplementation((async (args: {
      data: { storagePath?: unknown };
    }) => {
      if (!failed && typeof args.data.storagePath === "string" && args.data.storagePath.includes("unread-c")) {
        failed = true;
        throw new Error("The database went away");
      }
      return Reflect.apply(update, prisma.plate, [args]);
    }) as never);
    const reading = vi.spyOn(prisma.plate, "findUnique").mockImplementation((async (args: unknown) => {
      if (failed && !readFailed) {
        readFailed = true;
        throw new Error("The database went away");
      }
      return Reflect.apply(findUnique, prisma.plate, [args]);
    }) as never);
    try {
      expect((await rename()).status).not.toBe(200);
    } finally {
      saving.mockRestore();
      reading.mockRestore();
    }
    expect(readFailed).toBe(true);

    // The same rename again finds the file where it went, not a place of its own beside it.
    expect((await rename()).status).toBe(200);
    const plate = await prisma.plate.findUniqueOrThrow({ where: { id: a.id } });
    expect(plate.storagePath).not.toContain(modelId);
    expect(path.basename(plate.storagePath)).toBe("unread-c.stl");
    expect(fs.readFileSync(resolvePlateFilePath(plate) ?? "", "utf8")).toBe("solid unread a endsolid");
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("reads the print facts again when a later reorder keeps the first plate whose facts failed", async () => {
    const uploaded = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", Buffer.from("solid facts endsolid"), "facts.stl")
      .attach(
        "files",
        await new JSZip()
          .file("Metadata/plate_1.gcode", "; printer_model = Bambu Lab X1 Carbon\nG28\n")
          .generateAsync({ type: "nodebuffer" }),
        "facts.gcode.3mf",
      )
      .attach("files", Buffer.from("solid more facts endsolid"), "more-facts.stl");
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const [stl, gcode, more] = await prisma.plate.findMany({
      where: { printId: modelId },
      orderBy: { position: "asc" },
    });
    const reorder = (order: string[]) =>
      auth(request(app).post(`/api/print/${modelId}/plates/reorder`)).send({ plate_ids: order });
    const update = prisma.print.update;
    let failed = false;
    // The order commits; the print facts read from its new first plate don't.
    const facts = vi.spyOn(prisma.print, "update").mockImplementation((async (args: { data: object }) => {
      if (!failed && "preparedMetadata" in args.data) {
        failed = true;
        throw new Error("The database went away");
      }
      return Reflect.apply(update, prisma.print, [args]);
    }) as never);
    try {
      expect((await reorder([gcode.id, stl.id, more.id])).status).toBe(500);
    } finally {
      facts.mockRestore();
    }
    expect(failed).toBe(true);
    const saved = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
    expect(saved.map((plate) => plate.id)).toEqual([gcode.id, stl.id, more.id]);

    // Another order, with the same first plate.
    expect((await reorder([gcode.id, more.id, stl.id])).status).toBe(200);
    const print = await prisma.print.findUniqueOrThrow({ where: { id: modelId } });
    expect(print.preparedMetadata).toMatchObject({ printer: "Bambu Lab X1 Carbon" });
  });

  it("settles a move whose outcome went unread while another move of its file waited, before that one saves", async () => {
    const uploaded = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", Buffer.from("solid race a endsolid"), "race-a.stl")
      .attach("files", Buffer.from("solid race b endsolid"), "race-b.stl");
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const [a] = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
    const update = prisma.plate.update;
    const findUnique = prisma.plate.findUnique;
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let saving = () => {};
    const atSave = new Promise<void>((resolve) => (saving = resolve));
    let chose = () => {};
    const chosen = new Promise<void>((resolve) => (chose = resolve));
    let holding = false;
    let failRead = false;
    // The rename moves its file, and the save of its path waits, then fails with the read that would tell.
    const saves = vi.spyOn(prisma.plate, "update").mockImplementation((async (args: {
      data: { storagePath?: unknown };
    }) => {
      if (!holding && typeof args.data.storagePath === "string" && args.data.storagePath.includes("race-c")) {
        holding = true;
        saving();
        await held;
        failRead = true;
        throw new Error("The database went away");
      }
      return Reflect.apply(update, prisma.plate, [args]);
    }) as never);
    const reads = vi.spyOn(prisma.plate, "findUnique").mockImplementation((async (args: {
      where: { storagePath?: string };
    }) => {
      if (failRead) {
        failRead = false;
        throw new Error("The database went away");
      }
      // The name change has settled what it could and is choosing where the file goes.
      if (holding && args.where.storagePath) chose();
      return Reflect.apply(findUnique, prisma.plate, [args]);
    }) as never);
    const endedFirst = (what: string) => (res: { status: number }) => {
      throw new Error(`The ${what} ended first, with ${res.status}`);
    };
    try {
      const rename = track(
        Promise.resolve(
          auth(request(app).post(`/api/print/${modelId}/plates/rename`)).send({
            renames: [{ plate_id: a.id, filename: "race-c.stl" }],
          }),
        ),
      );
      await Promise.race([atSave, rename.then(endedFirst("rename"))]);
      // The model's name moves its files too, without the rename's lock.
      const named = track(
        Promise.resolve(auth(request(app).post(`/api/print/${modelId}/meta`)).send({ name: "race renamed" })),
      );
      await Promise.race([chosen, named.then(endedFirst("name change"))]);
      release();
      expect((await rename).status).not.toBe(200);
      expect((await named).status).toBe(200);
    } finally {
      release();
      saves.mockRestore();
      reads.mockRestore();
    }

    const plate = await prisma.plate.findUniqueOrThrow({ where: { id: a.id } });
    expect(path.basename(plate.storagePath)).toBe("race-c.stl");
    expect(fs.readFileSync(resolvePlateFilePath(plate) ?? "", "utf8")).toBe("solid race a endsolid");
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("stops settling an unread move when its look fails, and settles it on the next try", async () => {
    const uploaded = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", Buffer.from("solid settle a endsolid"), "settle-a.stl")
      .attach("files", Buffer.from("solid settle b endsolid"), "settle-b.stl");
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const [a] = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
    const original = path.join(STORAGE, a.storagePath);
    const movedTo = path.join(path.dirname(original), "settle-c.stl");
    const rename = () =>
      auth(request(app).post(`/api/print/${modelId}/plates/rename`)).send({
        renames: [{ plate_id: a.id, filename: "settle-c.stl" }],
      });
    const update = prisma.plate.update;
    const findUnique = prisma.plate.findUnique;
    let failed = false;
    let readFailed = false;
    const saving = vi.spyOn(prisma.plate, "update").mockImplementation((async (args: {
      data: { storagePath?: unknown };
    }) => {
      if (!failed && typeof args.data.storagePath === "string" && args.data.storagePath.includes("settle-c")) {
        failed = true;
        throw new Error("The database went away");
      }
      return Reflect.apply(update, prisma.plate, [args]);
    }) as never);
    const reading = vi.spyOn(prisma.plate, "findUnique").mockImplementation((async (args: unknown) => {
      if (failed && !readFailed) {
        readFailed = true;
        throw new Error("The database went away");
      }
      return Reflect.apply(findUnique, prisma.plate, [args]);
    }) as never);
    try {
      expect((await rename()).status).not.toBe(200);
    } finally {
      saving.mockRestore();
      reading.mockRestore();
    }
    expect(readFailed).toBe(true);
    expect([fs.existsSync(original), fs.existsSync(movedTo)]).toEqual([false, true]);

    // A rename to another name whose settling look fails: no name is recorded, nothing is renamed, and the bytes stay
    // where the move left them.
    const renameTo = (filename: string) =>
      auth(request(app).post(`/api/print/${modelId}/plates/rename`)).send({
        renames: [{ plate_id: a.id, filename }],
      });
    faults.at("fileState:move.settle", 1, "EIO");
    expect((await renameTo("settle-d.stl")).status).not.toBe(200);
    expect([fs.existsSync(original), fs.existsSync(movedTo)]).toEqual([false, true]);
    expect(await prisma.plate.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      filename: "settle-c.stl",
      storagePath: a.storagePath,
    });

    expect((await renameTo("settle-d.stl")).status).toBe(200);
    const plate = await prisma.plate.findUniqueOrThrow({ where: { id: a.id } });
    expect([plate.filename, path.basename(plate.storagePath)]).toEqual(["settle-d.stl", "settle-d.stl"]);
    expect(fs.readFileSync(resolvePlateFilePath(plate) ?? "", "utf8")).toBe("solid settle a endsolid");
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  /** Renames the plate with the save of its new path failing, and the read that would tell failing too: its file
   *  waits where the move left it, with the row still naming the old place. */
  async function leaveUnreadMove(modelId: string, plateId: string, filename: string) {
    const update = prisma.plate.update;
    const findUnique = prisma.plate.findUnique;
    let failed = false;
    let readFailed = false;
    const saving = vi.spyOn(prisma.plate, "update").mockImplementation((async (args: {
      data: { storagePath?: unknown };
    }) => {
      if (!failed && typeof args.data.storagePath === "string" && args.data.storagePath.endsWith(filename)) {
        failed = true;
        throw new Error("The database went away");
      }
      return Reflect.apply(update, prisma.plate, [args]);
    }) as never);
    const reading = vi.spyOn(prisma.plate, "findUnique").mockImplementation((async (args: unknown) => {
      if (failed && !readFailed) {
        readFailed = true;
        throw new Error("The database went away");
      }
      return Reflect.apply(findUnique, prisma.plate, [args]);
    }) as never);
    try {
      const res = await auth(request(app).post(`/api/print/${modelId}/plates/rename`)).send({
        renames: [{ plate_id: plateId, filename }],
      });
      expect(res.status).not.toBe(200);
    } finally {
      saving.mockRestore();
      reading.mockRestore();
    }
    expect(readFailed).toBe(true);
  }

  async function twoPlateModel(prefix: string) {
    const uploaded = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", Buffer.from(`solid ${prefix} a endsolid`), `${prefix}-a.stl`)
      .attach("files", Buffer.from(`solid ${prefix} b endsolid`), `${prefix}-b.stl`);
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const [a, b] = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
    return { modelId, a, b, original: path.join(STORAGE, a.storagePath) };
  }

  it("puts back a file an unread move left before removing its plate", async () => {
    const { modelId, a, original } = await twoPlateModel("gone");
    const movedTo = path.join(path.dirname(original), "gone-c.stl");
    await leaveUnreadMove(modelId, a.id, "gone-c.stl");
    expect([fs.existsSync(original), fs.existsSync(movedTo)]).toEqual([false, true]);

    expect((await auth(request(app).delete(`/api/print/${modelId}/plates/${a.id}`))).status).toBe(200);
    expect([fs.existsSync(original), fs.existsSync(movedTo)]).toEqual([false, false]);
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("keeps an unread move waiting while something else holds the place its file came from", async () => {
    const { modelId, a, b, original } = await twoPlateModel("held");
    const movedTo = path.join(path.dirname(original), "held-c.stl");
    await leaveUnreadMove(modelId, a.id, "held-c.stl");
    const rename = () =>
      auth(request(app).post(`/api/print/${modelId}/plates/rename`)).send({
        renames: [{ plate_id: a.id, filename: "held-c.stl" }],
      });
    fs.mkdirSync(original);
    try {
      expect((await rename()).status).toBe(409);
      expect(fs.readFileSync(movedTo, "utf8")).toBe("solid held a endsolid");
      expect((await prisma.plate.findUniqueOrThrow({ where: { id: a.id } })).storagePath).toBe(a.storagePath);
      // Renaming the other plate, which this rename doesn't move, isn't held up by it.
      const other = await auth(request(app).post(`/api/print/${modelId}/plates/rename`)).send({
        renames: [{ plate_id: b.id, filename: "held-d.stl" }],
      });
      expect(other.status).toBe(200);
    } finally {
      fs.rmSync(original, { recursive: true, force: true });
    }

    // With the old place free again, the same rename finishes.
    expect((await rename()).status).toBe(200);
    const plate = await prisma.plate.findUniqueOrThrow({ where: { id: a.id } });
    expect(path.basename(plate.storagePath)).toBe("held-c.stl");
    expect(plate.storagePath).not.toContain(modelId);
    expect(fs.readFileSync(resolvePlateFilePath(plate) ?? "", "utf8")).toBe("solid held a endsolid");
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("gives no other file the place an unread move went until it's settled", async () => {
    const { modelId, a, original } = await twoPlateModel("claimed");
    const movedTo = path.join(path.dirname(original), "claimed-c.stl");
    await leaveUnreadMove(modelId, a.id, "claimed-c.stl");
    // Even with its bytes gone from there, the place stays the unsettled move's.
    fs.rmSync(movedTo);
    expect(await printFilePathFree(path.relative(STORAGE, movedTo), "another-file")).toBe(false);
    expect((await auth(request(app).delete(`/api/print/${modelId}/plates/${a.id}`))).status).toBe(200);
    expect(await printFilePathFree(path.relative(STORAGE, movedTo), "another-file")).toBe(true);
  });

  it("brings back only the file an unread move put in its place, not another one there now", async () => {
    const { modelId, a, original } = await twoPlateModel("swapped");
    const movedTo = path.join(path.dirname(original), "swapped-c.stl");
    await leaveUnreadMove(modelId, a.id, "swapped-c.stl");
    // What the move put there went, and another file is there now.
    fs.rmSync(movedTo);
    fs.writeFileSync(movedTo, "solid someone else's endsolid");
    try {
      expect((await auth(request(app).delete(`/api/print/${modelId}/plates/${a.id}`))).status).toBe(200);
      expect(fs.readFileSync(movedTo, "utf8")).toBe("solid someone else's endsolid");
      expect(fs.existsSync(original)).toBe(false);
    } finally {
      fs.rmSync(movedTo, { force: true });
    }
  });

  it("appends after a plate removed while the new file was being placed", async () => {
    const uploaded = await auth(request(app).post("/api/upload"))
      .field("mode", "multiplate")
      .attach("files", Buffer.from("solid keep endsolid"), "keep.stl")
      .attach("files", Buffer.from("solid gone endsolid"), "gone.stl");
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const [, gone] = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });

    const placement = pauseAt("fileState:path.taken");
    const append = track(
      Promise.resolve(
        auth(request(app).post(`/api/print/${modelId}/plates`)).attach(
          "files",
          Buffer.from("solid late endsolid"),
          "late.stl",
        ),
      ),
    );
    try {
      await placement.reachedBy(append);
      await auth(request(app).delete(`/api/print/${modelId}/plates/${gone.id}`)).expect(200);
    } finally {
      placement.release();
    }

    expect((await append).status).toBe(200);
    const plates = await prisma.plate.findMany({ where: { printId: modelId }, orderBy: { position: "asc" } });
    expect(plates.map((plate) => [plate.filename, plate.position])).toEqual([
      ["keep.stl", 0],
      ["late.stl", 1],
    ]);
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
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

  it("returns the same plate for concurrent retries with the same upload id", async () => {
    const capability = await auth(request(app).get(`/api/print/${printId}/plates/upload-idempotency`));
    expect(capability.status).toBe(200);
    expect(capability.body).toEqual({ supported: true });

    const uploadId = "00000000-0000-4000-8000-000000000457";
    const filename = `thingport-upload-${uploadId}-retry.stl`;
    const original = "solid retry endsolid";
    // Another file under the same upload ID isn't a retry, even one with the bytes the stored plate was edited to.
    const changed = "solid edits endsolid";
    const post = (bytes: string) =>
      auth(request(app).post(`/api/print/${printId}/plates`)).attach("files", Buffer.from(bytes), filename);

    {
      const [first, second] = await Promise.all([post(original), post(original)]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body.added_plate_ids).toHaveLength(1);
      expect(second.body.added_plate_ids).toEqual(first.body.added_plate_ids);
      expect(
        second.body.print.plates.filter((p: any) => p.filename.startsWith(`thingport-upload-${uploadId}-`)),
      ).toHaveLength(1);

      // Edited outside Thingport, the stored plate no longer has the bytes the upload was first sent with.
      const stored = resolvePlateFilePath(
        await prisma.plate.findUniqueOrThrow({ where: { id: first.body.added_plate_ids[0] } }),
      );
      if (!stored) throw new Error("Expected a readable plate");
      // Same length, so the row's size still holds, as an edit in place keeps it.
      fs.writeFileSync(stored, changed);
      const replay = await post(original);
      expect(replay.status).toBe(200);
      expect(replay.body.added_plate_ids).toEqual(first.body.added_plate_ids);

      const other = await post(changed);
      expect(other.status).toBe(409);
      expect(await prisma.plate.count({ where: { printId } })).toBe(second.body.print.plates.length);
    }
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("retries a concurrent append position conflict with the same upload claim and bytes", async () => {
    const firstId = randomUUID();
    const secondId = randomUUID();
    const firstBytes = Buffer.from("solid first concurrent endsolid");
    const upload = async (uploadId: string, bytes: Buffer) =>
      await auth(request(app).post(`/api/print/${printId}/plates`)).attach(
        "files",
        bytes,
        `thingport-upload-${uploadId}-concurrent.stl`,
      );
    const firstPlacement = pauseAt("fileState:path.taken");
    const first = track(upload(firstId, firstBytes));
    try {
      await firstPlacement.reachedBy(first);
      const second = await upload(secondId, Buffer.from("solid second concurrent endsolid"));
      expect(second.status).toBe(200);
      const secondPlateId: string = second.body.added_plate_ids[0];

      firstPlacement.release();
      const resumed = await first;
      expect(resumed.status).toBe(200);
      const resumedPlateId: string = resumed.body.added_plate_ids[0];
      const completed = await prisma.plateUploadAttempt.findUniqueOrThrow({
        where: { printId_clientUploadId: { printId, clientUploadId: firstId } },
      });
      expect(completed).toMatchObject({ status: "complete", plateId: resumedPlateId });
      const saved = await prisma.plate.findUniqueOrThrow({ where: { id: resumedPlateId } });
      const ahead = await prisma.plate.findUniqueOrThrow({ where: { id: secondPlateId } });
      expect(saved.position).toBe(ahead.position + 1);
      const file = resolvePlateFilePath(saved);
      if (!file) throw new Error("Expected a stored plate after the position retry");
      expect(fs.readFileSync(file)).toEqual(firstBytes);
      // The attempt that lost the position took its file back.
      expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
    } finally {
      firstPlacement.release();
    }
  });

  it("keeps plate positions dense when a batch replays a completed upload", async () => {
    const firstName = `thingport-upload-${randomUUID()}-first.stl`;
    const secondName = `thingport-upload-${randomUUID()}-second.stl`;
    const upload = () =>
      auth(request(app).post(`/api/print/${printId}/plates`)).attach(
        "files",
        Buffer.from("solid first endsolid"),
        firstName,
      );

    const first = await upload();
    expect(first.status).toBe(200);
    const [firstId] = first.body.added_plate_ids;

    const retry = await upload().attach("files", Buffer.from("solid second endsolid"), secondName);
    expect(retry.status).toBe(200);
    expect(retry.body.added_plate_ids).toEqual([firstId, expect.any(String)]);
    const plates: { position: number }[] = retry.body.print.plates;
    expect(plates).toHaveLength(first.body.print.plates.length + 1);
    expect(plates.map((plate) => plate.position)).toEqual(plates.map((_, position) => position));
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it.each([
    { status: "pending", claimToken: randomUUID(), leaseExpiresAt: new Date(0) },
    { status: "pending", claimToken: null, leaseExpiresAt: null },
    { status: "failed", claimToken: null, leaseExpiresAt: null },
  ])("reclaims a $status upload without a live lease ($leaseExpiresAt)", async (previousAttempt) => {
    const clientUploadId = randomUUID();
    const filename = `thingport-upload-${clientUploadId}-recover.stl`;
    const bytes = Buffer.from("solid recovered endsolid");
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    await prisma.plateUploadAttempt.create({ data: { printId, clientUploadId, contentSha256, ...previousAttempt } });

    const upload = () => auth(request(app).post(`/api/print/${printId}/plates`)).attach("files", bytes, filename);
    const res = await upload();
    expect(res.status).toBe(200);
    expect(res.body.added_plate_ids).toHaveLength(1);
    expect(
      await prisma.plateUploadAttempt.findUnique({ where: { printId_clientUploadId: { printId, clientUploadId } } }),
    ).toMatchObject({
      status: "complete",
      plateId: res.body.added_plate_ids[0],
      claimToken: null,
      leaseExpiresAt: null,
    });
    const retry = await upload();
    expect(retry.status).toBe(200);
    expect(retry.body.added_plate_ids).toEqual(res.body.added_plate_ids);
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it.each([true, false])("checks legacy marker bytes before reusing a plate (same bytes: %s)", async (sameBytes) => {
    const uploadId = randomUUID();
    const filename = `thingport-upload-${uploadId}-legacy.stl`;
    const initialBytes = Buffer.from("solid legacy endsolid");
    const submitted = sameBytes ? initialBytes : Buffer.from("solid different endsolid");
    const legacy = await auth(request(app).post("/api/upload")).attach("files", initialBytes, filename);
    expect(legacy.status).toBe(200);
    const model = legacy.body.prints[0];
    await trackPrint(model.id);
    const legacyId = model.plates[0].id;
    const result = await auth(request(app).post(`/api/print/${model.id}/plates`)).attach("files", submitted, filename);

    expect(result.status).toBe(200);
    const [storedId] = result.body.added_plate_ids;
    expect(result.body.print.plates).toHaveLength(sameBytes ? 1 : 2);
    expect(storedId === legacyId).toBe(sameBytes);
    const stored = await prisma.plate.findUniqueOrThrow({ where: { id: storedId } });
    const file = resolvePlateFilePath(stored);
    if (!file) throw new Error("Expected the submitted plate on disk");
    expect(fs.readFileSync(file)).toEqual(submitted);
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("rolls back a plate when its worker resumes after losing its lease", async () => {
    const clientUploadId = randomUUID();
    const filename = `thingport-upload-${clientUploadId}-suspended.stl`;
    const where = { printId_clientUploadId: { printId, clientUploadId } };
    const upload = async () =>
      await auth(request(app).post(`/api/print/${printId}/plates`)).attach(
        "files",
        Buffer.from("solid resumed endsolid"),
        filename,
      );
    const firstPlacement = pauseAt("fileState:path.taken");
    const replacementPlacement = pauseAt("fileState:path.taken", 2);
    const first = track(upload());
    try {
      await firstPlacement.reachedBy(first);
      await prisma.plateUploadAttempt.update({ where, data: { leaseExpiresAt: new Date(0) } });
      const replacement = track(upload());
      await replacementPlacement.reachedBy(replacement);
      const claim = await prisma.plateUploadAttempt.findUniqueOrThrow({ where });

      firstPlacement.release();
      const lost = await first;
      expect(lost.status).toBe(409);
      expect(lost.body.detail).toBe("The plate upload claim was lost; try again");
      expect(await prisma.plate.count({ where: { printId, filename } })).toBe(0);
      expect(await prisma.plateUploadAttempt.findUnique({ where })).toMatchObject({
        status: "pending",
        claimToken: claim.claimToken,
      });

      replacementPlacement.release();
      const saved = await replacement;
      expect(saved.status).toBe(200);
      expect(await prisma.plateUploadAttempt.findUnique({ where })).toMatchObject({
        status: "complete",
        plateId: saved.body.added_plate_ids[0],
      });
      // The worker that lost its lease took its file back; the replacement's is its plate's.
      expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
    } finally {
      firstPlacement.release();
      replacementPlacement.release();
    }
  });

  it("keeps a plate's file when its commit was reported failed but went through", async () => {
    const clientUploadId = randomUUID();
    const filename = `thingport-upload-${clientUploadId}-committed.stl`;
    const upload = () =>
      auth(request(app).post(`/api/print/${printId}/plates`)).attach(
        "files",
        Buffer.from("solid committed endsolid"),
        filename,
      );
    // The plate's transaction commits and its acknowledgement is lost, as when the connection drops at COMMIT.
    const lost = disputeTransactions({ caller: "createPlateAtPosition", outcome: "commit unanswered" });
    try {
      expect((await upload()).status).toBe(500);
      expect(lost.unconsumed()).toEqual([]);
    } finally {
      lost.mockRestore();
    }

    const plate = await prisma.plate.findFirstOrThrow({ where: { printId, filename } });
    expect(resolvePlateFilePath(plate)).not.toBeNull();
    const replay = await upload();
    expect(replay.status).toBe(200);
    expect(replay.body.added_plate_ids).toEqual([plate.id]);
    expect(await checkLibraryInvariants({ userIds: [userId] })).toEqual([]);
  });

  it("renames a plate without touching the model's other files", async () => {
    const uploaded = await auth(request(app).post("/api/upload")).attach(
      "files",
      Buffer.from("solid own endsolid"),
      "own.stl",
    );
    const modelId: string = uploaded.body.prints[0].id;
    await trackPrint(modelId);
    const [plate] = await prisma.plate.findMany({ where: { printId: modelId } });
    // A supporting file still where older versions kept them, which a move of the model's files would take along.
    const file = await prisma.printFile.create({
      data: { printId: modelId, role: "SUPPORTING", filename: "guide.txt", mime: "text/plain", storagePath: "pending" },
    });
    const bundled = path.join("bundles", modelId, file.id, "guide.txt");
    await prisma.printFile.update({ where: { id: file.id }, data: { storagePath: bundled, size: 5 } });
    const legacy = path.join(BUNDLES, modelId, file.id, "guide.txt");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, "guide");

    // Moved along, it would be looked at after the name is recorded, where a disk error leaves a failed save renamed.
    const res = await auth(request(app).post(`/api/print/${modelId}/plate/${plate.id}/rename`)).send({
      filename: "renamed-own.stl",
    });
    expect(res.status).toBe(200);
    expect(await prisma.printFile.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
      storagePath: bundled,
    });
    expect(fs.readFileSync(legacy, "utf8")).toBe("guide");
  });

  it("uses the completed plate's id even when another plate has its original upload name", async () => {
    const clientUploadId = randomUUID();
    const filename = `thingport-upload-${clientUploadId}-part.stl`;
    const upload = () =>
      auth(request(app).post(`/api/print/${printId}/plates`)).attach(
        "files",
        Buffer.from("solid original endsolid"),
        filename,
      );
    const first = await upload();
    expect(first.status).toBe(200);
    const [uploadedId] = first.body.added_plate_ids;
    const otherPlate = first.body.print.plates.find((plate: { id: string }) => plate.id !== uploadedId);
    const rename = (id: string, newFilename: string) =>
      auth(request(app).post(`/api/print/${printId}/plate/${id}/rename`)).send({ filename: newFilename });
    expect((await rename(uploadedId, "uploaded-part.stl")).status).toBe(200);
    expect((await rename(otherPlate.id, filename)).status).toBe(200);

    const retry = await upload();
    expect(retry.status).toBe(200);
    expect(retry.body.added_plate_ids).toEqual([uploadedId]);
    expect(retry.body.print.plates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: uploadedId, filename: "uploaded-part.stl" }),
        expect.objectContaining({ id: otherPlate.id, filename }),
      ]),
    );

    expect((await auth(request(app).delete(`/api/print/${printId}/plates/${uploadedId}`))).status).toBe(200);
    expect((await upload()).status).toBe(409);
    const results = await auth(request(app).post(`/api/print/${printId}/plates/upload-results`)).send({
      upload_ids: [clientUploadId, randomUUID()],
    });
    expect(results.status).toBe(200);
    expect(results.body.upload_results).toEqual([{ upload_id: clientUploadId, plate_id: uploadedId }]);
    expect(results.body.print.plates.map((plate: { id: string }) => plate.id)).not.toContain(uploadedId);
  });

  it("returns preview image ids aligned with the files, including a skipped image", async () => {
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#3366cc" } })
      .png()
      .toBuffer();
    const res = await auth(request(app).post(`/api/print/${printId}/preview-images`))
      .attach("files", image, "first.png")
      .attach("files", Buffer.from("invalid"), "invalid.png")
      .attach("files", image, "third.png");
    expect(res.status).toBe(200);
    expect(res.body.added_image_ids).toEqual([expect.any(String), null, expect.any(String)]);
    expect(res.body.print.preview_images.map((preview: { id: string }) => preview.id)).toEqual(
      res.body.added_image_ids.filter(Boolean),
    );
  });
  it("recovers keyed preview upload receipts and replays the same result without adding another image", async () => {
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#3366cc" } })
      .png()
      .toBuffer();
    const truncated = image.subarray(0, image.indexOf("IDAT") + 6);
    await expect(sharp(truncated).metadata()).resolves.toMatchObject({ format: "png" });
    const [uploadId, skippedId, unknownId] = [randomUUID(), randomUUID(), randomUUID()];
    const upload = () =>
      auth(request(app).post(`/api/print/${printId}/preview-images/idempotent`))
        .field("upload_ids", uploadId)
        .field("upload_ids", skippedId)
        .attach("files", image, "picture.png")
        .attach("files", truncated, "truncated.png");
    const results = () =>
      auth(request(app).post(`/api/print/${printId}/preview-images/upload-results`)).send({
        upload_ids: [uploadId, skippedId, unknownId],
      });

    const baseline = await auth(request(app).get(`/api/print/${printId}`));
    const [first, replay] = await Promise.all([upload(), upload()]);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(first.body.added_image_ids).toEqual([expect.any(String), null]);
    expect(replay.body.added_image_ids).toEqual(first.body.added_image_ids);

    const [imageId] = first.body.added_image_ids;
    const recovered = await results();
    expect(recovered.status).toBe(200);
    expect(recovered.body.upload_results).toHaveLength(2);
    expect(recovered.body.upload_results).toEqual(
      expect.arrayContaining([
        { upload_id: uploadId, image_id: imageId },
        { upload_id: skippedId, image_id: null },
      ]),
    );
    expect(recovered.body.print.preview_images).toHaveLength(baseline.body.preview_images.length + 1);

    const removed = await auth(request(app).delete(`/api/print/${printId}/preview-images/${imageId}`));
    expect(removed.status).toBe(200);
    const afterRemoval = await upload();
    expect(afterRemoval.status).toBe(200);
    expect(afterRemoval.body.added_image_ids).toEqual([imageId, null]);
    expect(afterRemoval.body.print.preview_images).toHaveLength(baseline.body.preview_images.length);
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

  it("removes the prepared file and falls back to null (bare .stl isn't sniffable)", async () => {
    const res = await auth(request(app).delete(`/api/print/${printId}/prepared-print`));
    expect(res.status).toBe(200);
    expect(res.body.print.prepared_print).toBeNull();
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
