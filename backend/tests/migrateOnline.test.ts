import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { dump, hasPgTools, oldInstance, tmp } from "./migrateFixture";

const app = createApp();
process.env.MIGRATE_DIR = fs.realpathSync(tmp());

async function admin(tag: string): Promise<{ id: string; token: string }> {
  const email = `online-admin-${tag}@example.com`;
  const registered = await request(app)
    .post("/api/register")
    .send({ displayName: "Online Admin", email, password: "password123" });
  await prisma.user.update({ where: { id: registered.body.user.id }, data: { role: "ADMIN" } });
  const signedIn = await request(app).post("/api/login").send({ email, password: "password123" });
  return { id: registered.body.user.id, token: signedIn.body.token };
}

describe("letting another instance copy this one", () => {
  const tag = crypto.randomBytes(4).toString("hex");
  let adminToken = "";
  let adminId = "";
  let exportToken = "";
  const auth = () => ({ Authorization: `Bearer ${adminToken}` });
  const asOther = (token = exportToken) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    ({ id: adminId, token: adminToken } = await admin(tag));
  });

  afterAll(async () => {
    await request(app).delete("/api/admin/migrate/export-token").set(auth());
    await prisma.user.deleteMany({ where: { id: adminId } });
  });

  it("answers nothing without a token, or with a wrong one", async () => {
    await request(app).delete("/api/admin/migrate/export-token").set(auth()).expect(204);
    expect((await request(app).get("/api/migrate-export/info")).status).toBe(401);
    expect((await request(app).get("/api/migrate-export/info").set(asOther("tpm_wrong"))).status).toBe(401);
    // An admin's own sign-in isn't a migration token either.
    expect((await request(app).get("/api/migrate-export/info").set(auth())).status).toBe(401);
  });

  it("makes a token shown once, which opens the exporter until it's revoked", async () => {
    const made = await request(app).post("/api/admin/migrate/export-token").set(auth()).expect(200);
    exportToken = made.body.token;
    expect(exportToken).toMatch(/^tpm_/);
    const state = await request(app).get("/api/admin/migrate/export-token").set(auth());
    expect(state.body).toMatchObject({ active: true, used_at: null });
    expect(JSON.stringify(state.body)).not.toContain(exportToken);
    // Kept only as its hash.
    const stored = await prisma.setting.findUniqueOrThrow({ where: { key: "migration_export" } });
    expect(JSON.stringify(stored.value)).not.toContain(exportToken);

    const info = await request(app).get("/api/migrate-export/info").set(asOther()).expect(200);
    expect(info.body).toHaveProperty("models");
    expect(info.body).toHaveProperty("people");

    // A new one replaces it.
    const next = await request(app).post("/api/admin/migrate/export-token").set(auth()).expect(200);
    expect((await request(app).get("/api/migrate-export/info").set(asOther())).status).toBe(401);
    exportToken = next.body.token;
    expect((await request(app).get("/api/migrate-export/info").set(asOther())).status).toBe(200);
  });

  it("serves files in storage only, and lists and finds them", async () => {
    const folder = path.join(STORAGE, `u-export-${tag}`, "Thing");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "part.stl"), "solid part");
    fs.writeFileSync(path.join(folder, ".hidden.stl"), "solid hidden");
    const outside = path.join(tmp(), "secret.txt");
    fs.writeFileSync(outside, "secret");
    fs.symlinkSync(outside, path.join(folder, "link.stl"));
    try {
      const file = (relative: string) =>
        request(app)
          .get(`/api/migrate-export/file?path=${encodeURIComponent(relative)}`)
          .set(asOther());
      expect((await file(`u-export-${tag}/Thing/part.stl`)).text).toBe("solid part");
      expect((await file(`u-export-${tag}/Thing/.hidden.stl`)).text).toBe("solid hidden");
      expect((await file(`u-export-${tag}/Thing/link.stl`)).status).toBe(404);
      expect((await file(`u-export-${tag}/../../etc/hosts`)).status).toBe(404);
      expect((await file(outside)).status).toBe(404);
      expect((await file(`u-export-${tag}/Thing/nope.stl`)).status).toBe(404);

      const missing = await request(app)
        .post("/api/migrate-export/missing")
        .set(asOther())
        .send({ paths: [`u-export-${tag}/Thing/part.stl`, `u-export-${tag}/Thing/nope.stl`, "../x"] });
      expect(missing.body.missing).toEqual([`u-export-${tag}/Thing/nope.stl`, "../x"]);

      const listed = await request(app)
        .get(`/api/migrate-export/folder?path=${encodeURIComponent(`u-export-${tag}`)}`)
        .set(asOther());
      expect(listed.body.files.toSorted()).toEqual(["Thing/.hidden.stl", "Thing/part.stl"]);

      // A folder it can't read fails the listing, rather than leave its files out of it.
      const denied = Object.assign(new Error("EACCES: permission denied, scandir"), { code: "EACCES" });
      const readdir = vi.spyOn(fsPromises, "readdir").mockRejectedValueOnce(denied);
      try {
        const refused = await request(app)
          .get(`/api/migrate-export/folder?path=${encodeURIComponent(`u-export-${tag}`)}`)
          .set(asOther());
        expect(refused.status).toBe(500);
      } finally {
        readdir.mockRestore();
      }
    } finally {
      fs.rmSync(path.join(STORAGE, `u-export-${tag}`), { recursive: true, force: true });
    }
  });

  it.skipIf(!hasPgTools)("streams this instance's database as a pg_dump archive, and says it was read", async () => {
    const res = await request(app)
      .get("/api/migrate-export/dump")
      .set(asOther())
      .buffer(true)
      .parse((stream, done) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 5).toString("latin1")).toBe("PGDMP");
    const state = await request(app).get("/api/admin/migrate/export-token").set(auth());
    expect(state.body.used_at).toBeTruthy();
  });

  it("stops answering once revoked", async () => {
    await request(app).delete("/api/admin/migrate/export-token").set(auth()).expect(204);
    expect((await request(app).get("/api/migrate-export/info").set(asOther())).status).toBe(401);
    expect((await request(app).get("/api/admin/migrate/export-token").set(auth())).body.active).toBe(false);
  });
});

/** An older instance online, as its exporter answers: its dump, and the files of its storage folder. */
function standIn(token: string, dumpFile: string, folder: string): Promise<http.Server> {
  const inFolder = (relative: string) => {
    const full = path.resolve(folder, relative);
    return full.startsWith(folder + path.sep) && fs.existsSync(full) && fs.statSync(full).isFile() ? full : null;
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stand-in");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${token}`) return json(401, { detail: "No", code: "online_token" });
    if (url.pathname === "/api/migrate-export/info") return json(200, { version: "1.0.0", people: 3, models: 5 });
    if (url.pathname === "/api/migrate-export/dump") {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      fs.createReadStream(dumpFile).pipe(res);
      return;
    }
    if (url.pathname === "/api/migrate-export/file") {
      const file = inFolder(url.searchParams.get("path") ?? "");
      if (!file) return json(404, { detail: "No such file" });
      res.writeHead(200);
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(file).pipe(res);
      return;
    }
    if (url.pathname === "/api/migrate-export/missing") {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      req.on("end", () => {
        const { paths } = JSON.parse(body) as { paths: string[] };
        json(200, { missing: paths.filter((relative) => !inFolder(relative)) });
      });
      return;
    }
    if (url.pathname === "/api/migrate-export/folder") return json(200, { files: [] });
    json(404, { detail: "Not found" });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

describe.skipIf(!hasPgTools)("copying an older instance online", () => {
  const tag = crypto.randomBytes(4).toString("hex");
  const sourceDb = `thingport_migrate_online_${tag}`;
  const token = `tpm_${crypto.randomBytes(12).toString("hex")}`;
  const folder = fs.realpathSync(tmp());
  let server: http.Server;
  let address = "";
  let adminToken = "";
  const created: string[] = [];
  const runs: string[] = [];
  const auth = () => ({ Authorization: `Bearer ${adminToken}` });
  const until = async (id: string, done: (status: string) => boolean) => {
    for (let tries = 0; tries < 600; tries++) {
      const res = await request(app).get(`/api/admin/migrate/${id}`).set(auth());
      if (done(res.body.status)) return res.body;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("it never finished");
  };

  beforeAll(async () => {
    await oldInstance(sourceDb, tag, folder);
    const dumpFile = path.join(tmp(), "old.dump");
    dump(sourceDb, dumpFile);
    server = await standIn(token, dumpFile, folder);
    address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const signedIn = await admin(`${tag}-in`);
    adminToken = signedIn.token;
    created.push(signedIn.id);
  }, 180_000);

  afterAll(async () => {
    server?.close();
    const people = await prisma.user.findMany({
      where: { email: { in: [`Alice-${tag}@example.com`, `bob-${tag}@example.com`, `carol-${tag}@example.com`] } },
      select: { id: true },
    });
    await prisma.user.deleteMany({ where: { id: { in: [...created, ...people.map((person) => person.id)] } } });
    await prisma.migrationRun.deleteMany({ where: { id: { in: runs } } });
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${sourceDb}"`);
  }, 60_000);

  it("says at once when the address or the token is wrong", async () => {
    const wrongToken = await request(app)
      .post("/api/admin/migrate/thingport-online")
      .set(auth())
      .send({ address, token: "tpm_wrong" });
    expect(wrongToken.status).toBe(400);
    expect(wrongToken.body.code).toBe("online_token");
    const nowhere = await request(app)
      .post("/api/admin/migrate/thingport-online")
      .set(auth())
      .send({ address: "http://127.0.0.1:9", token });
    expect(nowhere.body).toMatchObject({ code: "online_unreachable", values: { address: "http://127.0.0.1:9" } });
    const notAnAddress = await request(app)
      .post("/api/admin/migrate/thingport-online")
      .set(auth())
      .send({ address: "ftp://old.lan", token });
    expect(notAnAddress.body.code).toBe("online_address");
  });

  it("downloads its dump, reads its files over the network, and forgets the token once done", async () => {
    const prepared = await request(app)
      .post("/api/admin/migrate/thingport-online")
      .set(auth())
      .send({ address: `${address}/`, token });
    expect(prepared.status).toBe(202);
    runs.push(prepared.body.id);
    expect(JSON.stringify(prepared.body)).not.toContain(token);
    const ready = await until(prepared.body.id, (status) => status !== "preparing");
    expect(ready.error).toBeNull();
    expect(ready.plan).toMatchObject({ address, missingFiles: 1 });
    expect(ready.plan.people).toHaveLength(3);

    await request(app)
      .post(`/api/admin/migrate/${prepared.body.id}/start`)
      .set(auth())
      .send({
        people: ready.plan.people.map((person: { id: string }) => person.id),
        collections: true,
        studio: true,
        widgets: true,
        tools: true,
        syncs: true,
        signIns: true,
        settings: false,
        secrets: false,
      })
      .expect(202);
    const done = await until(prepared.body.id, (status) => status === "done" || status === "failed");
    expect(done.error).toBeNull();
    expect(done.report.people.created).toBe(3);
    expect(done.report.models).toMatchObject({ brought: 4, noFiles: 1 });
    const alice = await prisma.user.findFirstOrThrow({ where: { email: `Alice-${tag}@example.com` } });
    const benchy = await prisma.print.findFirstOrThrow({
      where: { userId: alice.id, name: "Benchy" },
      include: { plates: true },
    });
    expect(fs.readFileSync(path.join(STORAGE, benchy.plates[0].storagePath), "utf8")).toBe("solid lbenchy");
    // The address stays for the list; the token doesn't.
    const run = await prisma.migrationRun.findUniqueOrThrow({ where: { id: prepared.body.id } });
    expect(run.remote).toEqual({ address });
  }, 240_000);
});
