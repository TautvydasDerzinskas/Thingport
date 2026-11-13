import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { MERGED_TABLES, type MigrateOptions, tablesThatCome } from "../src/services/migrate/merge";
import {
  createStaging,
  dropStaging,
  dumpFormat,
  restoreDump,
  restoreErrors,
  sslEnv,
  stagingClient,
  stagingName,
} from "../src/services/migrate/postgres";
import { MERGE_RULES } from "../src/services/migrate/rules";
import {
  changeFolder,
  holdMigrations,
  removeRun,
  settleMigrations,
  settleTuning,
  startRun,
  UPLOADS,
} from "../src/services/migrate/runs";
import { checkFolder, folderSource } from "../src/services/migrate/sourceFiles";
import { dump, hasPgTools, oldInstance, RELEASE_1_0_0_MIGRATIONS, tmp, urlFor } from "./migrateFixture";

// A notification that takes its time when a test asks, as one to a slow database would.
const notices = vi.hoisted(() => ({ delay: 0 }));
vi.mock("../src/services/notificationService", async (original) => {
  const real = await original<typeof import("../src/services/notificationService")>();
  return {
    ...real,
    createNotification: async (...args: Parameters<typeof real.createNotification>) => {
      if (notices.delay) await new Promise((resolve) => setTimeout(resolve, notices.delay));
      return real.createNotification(...args);
    },
  };
});

const app = createApp();
// The one folder a migration reads from, as /app/migrate is in the image. By its real path, as the checks compare those.
const MIGRATE_ROOT = fs.realpathSync(tmp());
process.env.MIGRATE_DIR = MIGRATE_ROOT;
const inRoot = () => fs.mkdtempSync(path.join(MIGRATE_ROOT, "old-"));

describe("migrate rules", () => {
  it("has a rule for every table, and merges each table it says comes", () => {
    const tables = Prisma.dmmf.datamodel.models.map((model) => model.name).toSorted();
    expect(Object.keys(MERGE_RULES).toSorted()).toEqual(tables);
    expect([...MERGED_TABLES].toSorted()).toEqual(tablesThatCome().toSorted());
  });
});

describe("dump formats", () => {
  it("tells pg_dump's archives from plain SQL and anything else", async () => {
    const dir = tmp();
    const write = (name: string, data: Buffer) => {
      fs.writeFileSync(path.join(dir, name), data);
      return path.join(dir, name);
    };
    const tar = Buffer.alloc(1024);
    tar.write("ustar", 257, "latin1");
    expect(await dumpFormat(write("custom", Buffer.from("PGDMP\x01\x0e\x00")))).toBe("custom");
    expect(await dumpFormat(write("tar", tar))).toBe("tar");
    expect(await dumpFormat(write("plain.sql", Buffer.from("--\n-- PostgreSQL database dump\n")))).toBe("plain");
    expect(await dumpFormat(write("plain.sql.gz", Buffer.from([0x1f, 0x8b, 0x08, 0x00])))).toBe("plain");
    expect(await dumpFormat(write("other", Buffer.from("hello")))).toBe("unknown");
  });
});

describe("restoring a dump", () => {
  it("stops at a table or its rows it couldn't restore, not at what the copy does without", () => {
    const errors = restoreErrors();
    const lines = [
      "pg_restore: connecting to database for restore",
      "pg_restore: while INITIALIZING:",
      'pg_restore: error: could not execute query: ERROR:  unrecognized configuration parameter "transaction_timeout"',
      "Command was: SET transaction_timeout = 0;",
      "pg_restore: while PROCESSING TOC:",
      'pg_restore: creating EXTENSION "pg_trgm"',
      "pg_restore: from TOC entry 2; 3079 1010499 EXTENSION pg_trgm (no owner)",
      'pg_restore: error: could not execute query: ERROR:  permission denied to create extension "pg_trgm"',
      "pg_restore: from TOC entry 3; 2615 2200 SCHEMA public postgres",
      'pg_restore: error: could not execute query: ERROR:  schema "public" already exists',
      "pg_restore: from TOC entry 210; 1259 1010580 TABLE Print thingport",
      'pg_restore: error: could not execute query: ERROR:  type "citext" does not exist',
      'pg_restore: processing data for table "public.Print"',
      "pg_restore: from TOC entry 3688; 0 1010580 TABLE DATA Print thingport",
      'pg_restore: error: COPY failed for table "Print": ERROR:  relation "Print" does not exist',
      "pg_restore: warning: errors ignored on restore: 4",
    ];
    for (const line of lines) errors.see(line);
    expect(errors.serious).toEqual([
      'TABLE Print thingport: could not execute query: ERROR:  type "citext" does not exist',
      'TABLE DATA Print thingport: COPY failed for table "Print": ERROR:  relation "Print" does not exist',
    ]);
    // --verbose's progress is left out of what's said.
    expect(errors.said).toEqual(lines.filter((line) => !/^pg_restore: (connecting|creating|processing)/.test(line)));
  });

  it.skipIf(!hasPgTools)("carries on past an extension it may not make, and stops at a table it lost", async () => {
    const tag = crypto.randomBytes(4).toString("hex");
    const dir = tmp();
    const restore = async (database: string, setup: string[]) => {
      await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}"`);
      await prisma.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
      const old = new PrismaClient({ datasources: { db: { url: urlFor(database) } } });
      try {
        for (const sql of setup) await old.$executeRawUnsafe(sql);
      } finally {
        await old.$disconnect();
      }
      const file = path.join(dir, `${database}.dump`);
      dump(database, file);
      await prisma.$executeRawUnsafe(`DROP DATABASE "${database}"`);
      const name = stagingName(`restore${database.slice(-12)}`);
      await createStaging(name);
      try {
        const skipped = await restoreDump(file, name);
        const copy = stagingClient(name);
        try {
          return { skipped, kept: await copy.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Kept"`) };
        } finally {
          await copy.$disconnect();
        }
      } finally {
        await dropStaging(name);
      }
    };
    // An extension the working copy's role may not make, with nothing that needs it: its rows all come.
    const harmless = await restore(`tp_restore_ext_${tag}`, [
      "CREATE EXTENSION IF NOT EXISTS pg_trgm",
      `CREATE TABLE "Kept" (id text PRIMARY KEY)`,
      `INSERT INTO "Kept" VALUES ('a'), ('b')`,
    ]);
    expect(harmless.skipped.join("\n")).toMatch(/errors ignored on restore/);
    expect(harmless.kept.map((row) => row.id).toSorted()).toEqual(["a", "b"]);
    // A table of a type from it can't be made, so its rows can't come: the restore stops rather than leave them out.
    await expect(
      restore(`tp_restore_lost_${tag}`, [
        "CREATE EXTENSION IF NOT EXISTS citext",
        `CREATE TABLE "Kept" (id text PRIMARY KEY)`,
        `CREATE TABLE "Lost" (id citext PRIMARY KEY)`,
        `INSERT INTO "Lost" VALUES ('a')`,
      ]),
    ).rejects.toMatchObject({ code: "restore_failed", message: expect.stringMatching(/^TABLE Lost /m) });
  });

  it("reaches the database as safely as the live connection does", () => {
    const live = process.env.DATABASE_URL;
    const base = "postgresql://thingport:secret@db:5432/thingport?schema=public";
    try {
      process.env.DATABASE_URL = `${base}&sslmode=require`;
      expect(sslEnv()).toMatchObject({ PGSSLMODE: "require" });
      // Prisma checks the certificate and the name only when strict, against its sslcert.
      process.env.DATABASE_URL = `${base}&sslmode=require&sslaccept=strict&sslcert=certs/ca.pem`;
      expect(sslEnv()).toMatchObject({
        PGSSLMODE: "verify-full",
        PGSSLROOTCERT: path.resolve("prisma", "certs/ca.pem"),
      });
      // Strict checks it at Prisma's default sslmode, prefer, too; only disable turns it off.
      for (const mode of ["", "&sslmode=prefer"]) {
        process.env.DATABASE_URL = `${base}${mode}&sslaccept=strict&sslcert=certs/ca.pem`;
        expect(sslEnv()).toMatchObject({ PGSSLMODE: "verify-full" });
      }
      process.env.DATABASE_URL = `${base}&sslmode=disable&sslaccept=strict`;
      expect(sslEnv().PGSSLMODE).toBe("disable");
      process.env.DATABASE_URL = base;
      expect(sslEnv().PGSSLMODE).toBeUndefined();
    } finally {
      process.env.DATABASE_URL = live;
    }
  });
});

describe("starting up", () => {
  it("holds migrations until what the last process left is settled, trying again when the database didn't answer", async () => {
    const leftover = await prisma.migrationRun.create({
      data: {
        source: "thingport",
        status: "running",
        plan: {},
        stagingDb: `tp_migrate_left${crypto.randomBytes(4).toString("hex")}`,
        startedAt: new Date(),
      },
    });
    const real = prisma.migrationRun.findMany.bind(prisma.migrationRun);
    // Only this run, as the last process's: the database is shared with the other files' runs.
    const findMany = vi
      .spyOn(prisma.migrationRun, "findMany")
      .mockRejectedValueOnce(new Error("the database isn't up yet"))
      .mockImplementation(((args: Prisma.MigrationRunFindManyArgs) =>
        real({ ...args, where: { ...args?.where, id: leftover.id } })) as unknown as typeof real);
    const retryMs = settleTuning.retryMs;
    settleTuning.retryMs = 50;
    const email = `settle-admin-${crypto.randomBytes(4).toString("hex")}@example.com`;
    const registered = await request(app)
      .post("/api/register")
      .send({ displayName: "Settling Admin", email, password: "password123" });
    await prisma.user.update({ where: { id: registered.body.user.id }, data: { role: "ADMIN" } });
    const token = (await request(app).post("/api/login").send({ email, password: "password123" })).body.token;
    try {
      holdMigrations();
      // Turned away before it's written: settling clears the folder uploads go to.
      const mkdir = vi.spyOn(fs, "mkdirSync");
      const upload = await request(app)
        .post("/api/admin/migrate/thingport")
        .set({ Authorization: `Bearer ${token}` })
        .field("folder", "/app/migrate/storage")
        .attach("dump", Buffer.from("PGDMP"), "old.dump");
      const made = mkdir.mock.calls.map(([dir]) => String(dir));
      mkdir.mockRestore();
      expect(upload.status).toBe(409);
      expect(upload.body.code).toBe("settling");
      expect(made).not.toContain(UPLOADS);
      await settleMigrations();
      // Still "running", as nothing runs it: it can't be removed, or taken for one under way.
      await expect(removeRun(leftover.id)).rejects.toMatchObject({ status: 409, code: "settling" });
      let removed = false;
      for (let tries = 0; tries < 100 && !removed; tries++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        removed = await removeRun(leftover.id).then(
          () => true,
          (err: { code?: string }) => {
            if (err.code !== "settling") throw err;
            return false;
          },
        );
      }
      expect(removed).toBe(true);
      expect(findMany).toHaveBeenCalledTimes(2);
    } finally {
      findMany.mockRestore();
      settleTuning.retryMs = retryMs;
      await prisma.migrationRun.deleteMany({ where: { id: leftover.id } });
      await prisma.user.deleteMany({ where: { id: registered.body.user.id } });
    }
  });
});

describe("the old instance's folder", () => {
  it("copies only plain files inside it", async () => {
    const root = inRoot();
    const outside = tmp();
    fs.mkdirSync(path.join(root, "u-1"), { recursive: true });
    fs.writeFileSync(path.join(root, "u-1", "part.stl"), "solid");
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "u-1", "link.stl"));
    const files = await folderSource(root);
    const to = tmp();
    expect(await files.copy("u-1/part.stl", path.join(to, "part.stl"))).toBe(true);
    expect(fs.readFileSync(path.join(to, "part.stl"), "utf8")).toBe("solid");
    // A link leading out of the folder, a path climbing out of it, and one from the root are all refused.
    expect(await files.copy("u-1/link.stl", path.join(to, "link.stl"))).toBe(false);
    expect(await files.copy("../" + path.basename(outside) + "/secret.txt", path.join(to, "up.txt"))).toBe(false);
    expect(await files.copy(path.join(outside, "secret.txt"), path.join(to, "abs.txt"))).toBe(false);
    expect(fs.existsSync(path.join(to, "link.stl"))).toBe(false);
  });

  it("doesn't look through a folder of its that leads out of it", async () => {
    const root = inRoot();
    const outside = tmp();
    fs.mkdirSync(path.join(outside, "inner"));
    fs.writeFileSync(path.join(outside, "inner", "secret.txt"), "secret");
    fs.mkdirSync(path.join(root, "studio", "u-1"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, "studio", "u-1", "design"));
    const files = await folderSource(root);
    const readdir = vi.spyOn(fsPromises, "readdir");
    try {
      expect(await files.copyFolder("studio/u-1/design", tmp())).toBe(0);
      const read = readdir.mock.calls.map(([dir]) => fs.realpathSync(String(dir)));
      expect(read.filter((dir) => !dir.startsWith(root + path.sep))).toEqual([]);
    } finally {
      readdir.mockRestore();
    }
  });

  it("fails on a folder it can't read, rather than copy none of it unsaid", async () => {
    const root = inRoot();
    fs.mkdirSync(path.join(root, "studio", "u-1", "design"), { recursive: true });
    fs.writeFileSync(path.join(root, "studio", "u-1", "design", "mesh.stl"), "solid");
    const files = await folderSource(root);
    // One that isn't there has nothing in it.
    expect(await files.copyFolder("studio/u-1/none", tmp())).toBe(0);
    const denied = Object.assign(new Error("EACCES: permission denied, scandir"), { code: "EACCES" });
    const readdir = vi.spyOn(fsPromises, "readdir").mockRejectedValueOnce(denied);
    try {
      await expect(files.copyFolder("studio/u-1/design", tmp())).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      readdir.mockRestore();
    }
    expect(await files.copyFolder("studio/u-1/design", tmp())).toBe(1);
  });

  it("reads only from the migrate folder, and never this instance's own storage", async () => {
    await expect(checkFolder(tmp())).rejects.toMatchObject({ code: "outside" });
    await expect(checkFolder("/")).rejects.toMatchObject({ code: "outside" });
    await expect(checkFolder("old/storage")).rejects.toMatchObject({ code: "folder_relative" });
    await expect(checkFolder(path.join(MIGRATE_ROOT, "nope"))).rejects.toMatchObject({ code: "folder_missing" });
    // A link inside it leading out is outside too.
    const linked = path.join(inRoot(), "elsewhere");
    fs.symlinkSync(tmp(), linked);
    await expect(checkFolder(linked)).rejects.toMatchObject({ code: "outside" });
    // A migrate folder holding the storage still can't be pointed at it.
    process.env.MIGRATE_DIR = path.dirname(STORAGE);
    try {
      await expect(checkFolder(STORAGE)).rejects.toMatchObject({ code: "folder_is_storage" });
    } finally {
      process.env.MIGRATE_DIR = MIGRATE_ROOT;
    }
  });
});

describe.skipIf(!hasPgTools)("migrating from an older Thingport instance", () => {
  const tag = crypto.randomBytes(4).toString("hex");
  const sourceDb = `thingport_migrate_source_${tag}`;
  const folder = inRoot();
  const dumpFile = path.join(inRoot(), "old.dump");
  let adminToken = "";
  let bobId = "";
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
    dump(sourceDb, dumpFile);
    const admin = await request(app)
      .post("/api/register")
      .send({ displayName: "Migrating Admin", email: `migrate-admin-${tag}@example.com`, password: "password123" });
    await prisma.user.update({ where: { id: admin.body.user.id }, data: { role: "ADMIN" } });
    created.push(admin.body.user.id);
    adminToken = (
      await request(app)
        .post("/api/login")
        .send({ email: `migrate-admin-${tag}@example.com`, password: "password123" })
    ).body.token;
    // Bob has an account here already, with the same Gear imported, a Bracket of his own and a Mechanical collection.
    const bob = await prisma.user.create({
      data: { email: `BOB-${tag}@example.com`, displayName: "Bob Here", passwordHash: "here" },
    });
    bobId = bob.id;
    created.push(bob.id);
    await prisma.print.create({
      data: {
        userId: bob.id,
        name: "Gear",
        nameNormalized: "gear",
        sourceProvider: "printables",
        sourceExternalId: `${tag}2`,
      },
    });
    await prisma.print.create({ data: { userId: bob.id, name: "Bracket", nameNormalized: "bracket" } });
    await prisma.collection.create({ data: { userId: bob.id, name: "Mechanical", nameNormalized: "mechanical" } });
  }, 180_000);

  afterAll(async () => {
    const people = await prisma.user.findMany({
      where: { email: { in: [`Alice-${tag}@example.com`, `carol-${tag}@example.com`] } },
      select: { id: true },
    });
    await prisma.user.deleteMany({ where: { id: { in: [...created, ...people.map((person) => person.id)] } } });
    await prisma.migrationRun.deleteMany({ where: { id: { in: runs } } });
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${sourceDb}"`);
  }, 60_000);

  it("is only for admins", async () => {
    const member = await request(app)
      .post("/api/register")
      .send({ displayName: "Member", email: `migrate-member-${tag}@example.com`, password: "password123" });
    created.push(member.body.user.id);
    const res = await request(app)
      .get("/api/admin/migrate")
      .set({ Authorization: `Bearer ${member.body.token}` });
    expect(res.status).toBe(403);
  });

  it("turns a plain SQL dump away", async () => {
    const plain = path.join(inRoot(), "plain.sql");
    fs.writeFileSync(plain, "--\n-- PostgreSQL database dump\n--\nSET statement_timeout = 0;\n");
    const res = await request(app).post("/api/admin/migrate/thingport").set(auth()).send({ dump_path: plain, folder });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("plain_dump");
  });

  it("reads a dump on the server only from the migrate folder", async () => {
    const elsewhere = path.join(tmp(), "old.dump");
    fs.copyFileSync(dumpFile, elsewhere);
    const res = await request(app)
      .post("/api/admin/migrate/thingport")
      .set(auth())
      .send({ dump_path: elsewhere, folder });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("outside");
    // With what the app's sentence for it needs.
    expect(res.body.values).toEqual({ root: MIGRATE_ROOT });
    const listed = await request(app).get("/api/admin/migrate").set(auth());
    expect(listed.body.root).toBe(MIGRATE_ROOT);
  });

  it("checks the dump, brings people and their libraries over, and brings nothing twice", async () => {
    const prepared = await request(app)
      .post("/api/admin/migrate/thingport")
      .set(auth())
      .send({ dump_path: dumpFile, folder });
    expect(prepared.status).toBe(202);
    runs.push(prepared.body.id);
    const ready = await until(prepared.body.id, (status) => status !== "preparing");
    expect(ready.error).toBeNull();
    expect(ready.status).toBe("ready");
    expect(ready.plan.changes.applied).toBe(RELEASE_1_0_0_MIGRATIONS);
    expect(ready.plan.changes.added).toBeGreaterThan(0);
    expect(ready.plan.missingFiles).toBe(1);
    const people: { id: string; email: string; merge: { id: string } | null }[] = ready.plan.people;
    expect(people).toHaveLength(3);
    expect(people.find((person) => person.email === `bob-${tag}@example.com`)?.merge?.id).toBe(bobId);

    const options = {
      people: people.map((person) => person.id),
      collections: true,
      studio: true,
      widgets: true,
      tools: true,
      syncs: true,
      signIns: true,
      // Instance-wide rows other test files rely on.
      settings: false,
      secrets: false,
    };
    await request(app).post(`/api/admin/migrate/${prepared.body.id}/start`).set(auth()).send(options).expect(202);
    const done = await until(prepared.body.id, (status) => status === "done" || status === "failed");
    expect(done.error).toBeNull();
    expect(done.status).toBe("done");
    expect(done.report.people).toEqual({ created: 2, merged: 1, earlier: 0 });
    expect(done.report.models).toMatchObject({ brought: 3, alreadyHere: 1, renamed: 1, noFiles: 1, failed: 0 });

    // Alice: a new account with her password, but no API token and not this instance's owner.
    const alice = await prisma.user.findFirstOrThrow({ where: { email: `Alice-${tag}@example.com` } });
    expect(alice.passwordHash).toBe("$2b$12$alicehash");
    expect(alice.isOwner).toBe(false);
    expect(alice.apiTokenHash).toBeNull();
    expect(alice.role).toBe("ADMIN");
    // Her MakerWorld cookie became a sign-in on the way up to this release, and came too.
    expect(await prisma.providerConnection.count({ where: { userId: alice.id, provider: "makerworld" } })).toBe(1);
    // Benchy, in her category tree, with its file and its picture filed where this instance puts them.
    const benchy = await prisma.print.findFirstOrThrow({
      where: { userId: alice.id, name: "Benchy" },
      include: { plates: true, previewImages: true, category: { include: { parent: true, siteIds: true } } },
    });
    expect(benchy.category?.name).toBe("Puzzles");
    expect(benchy.category?.parent?.name).toBe("Toys");
    expect(benchy.category?.siteIds.map((site) => site.siteId)).toContain("1002");
    expect(benchy.plates[0].storagePath.startsWith(`u-${alice.id}/`)).toBe(true);
    expect(fs.readFileSync(path.join(STORAGE, benchy.plates[0].storagePath), "utf8")).toBe("solid lbenchy");
    expect(benchy.assetsPath).toBeTruthy();
    expect(fs.existsSync(path.join(STORAGE, benchy.assetsPath!, `${benchy.previewImages[0].id}.jpg`))).toBe(true);
    // Gone had no file in the folder, so it stayed behind.
    expect(await prisma.print.count({ where: { userId: alice.id, name: "Gone" } })).toBe(0);

    // Bob's Gear was in his library already; his Bracket came beside his own; his collections were merged.
    const bobs = await prisma.print.findMany({ where: { userId: bobId }, orderBy: { name: "asc" } });
    expect(bobs.map((print) => print.name)).toEqual(["Bracket", "Bracket (2)", "Gear"]);
    const mechanical = await prisma.collection.findFirstOrThrow({
      where: { userId: bobId, nameNormalized: "mechanical" },
      include: { items: { include: { print: true }, orderBy: { position: "asc" } } },
    });
    expect(mechanical.items.map((item) => item.print.name)).toEqual(["Gear", "Bracket (2)"]);

    // The working copy and its role are gone, and so is the run's folder.
    const leftovers = await prisma.$queryRaw<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname = ${stagingName(prepared.body.id)}`;
    expect(leftovers).toHaveLength(0);
    expect(fs.existsSync(path.join(STORAGE, ".migrate", prepared.body.id))).toBe(false);

    // The same dump again: everyone and everything is here already.
    const again = await request(app)
      .post("/api/admin/migrate/thingport")
      .set(auth())
      .send({ dump_path: dumpFile, folder });
    runs.push(again.body.id);
    await until(again.body.id, (status) => status !== "preparing");
    await request(app).post(`/api/admin/migrate/${again.body.id}/start`).set(auth()).send(options).expect(202);
    const second = await until(again.body.id, (status) => status === "done" || status === "failed");
    expect(second.status).toBe("done");
    expect(second.report.people).toEqual({ created: 0, merged: 1, earlier: 2 });
    expect(second.report.models).toMatchObject({ brought: 0, earlier: 3, alreadyHere: 1 });
    expect(await prisma.print.count({ where: { userId: bobId } })).toBe(3);
    expect(await prisma.collectionItem.count({ where: { collectionId: mechanical.id } })).toBe(2);
  }, 240_000);

  it("starts a run once however often Start is pressed, and is free again as soon as it says it's done", async () => {
    const prepared = await request(app)
      .post("/api/admin/migrate/thingport")
      .set(auth())
      .send({ dump_path: dumpFile, folder });
    expect(prepared.status).toBe(202);
    runs.push(prepared.body.id);
    const ready = await until(prepared.body.id, (status) => status !== "preparing");
    expect(ready.status).toBe("ready");
    const options = {
      people: ready.plan.people.map((person: { id: string }) => person.id),
      collections: true,
      studio: true,
      widgets: true,
      tools: true,
      syncs: true,
      signIns: true,
      settings: false,
      secrets: false,
    };
    notices.delay = 3000;
    try {
      const start = () => request(app).post(`/api/admin/migrate/${prepared.body.id}/start`).set(auth()).send(options);
      const started = await Promise.all([start(), start()]);
      expect(started.map((res) => res.status).toSorted()).toEqual([202, 409]);
      const done = await until(prepared.body.id, (status) => status === "done" || status === "failed");
      expect(done.status).toBe("done");
      // Its notification is still on the way, and the next one can be prepared already.
      const next = await request(app)
        .post("/api/admin/migrate/thingport")
        .set(auth())
        .send({ dump_path: dumpFile, folder });
      expect(next.status).toBe(202);
      runs.push(next.body.id);
      await until(next.body.id, (status) => status !== "preparing");
      await request(app).delete(`/api/admin/migrate/${next.body.id}`).set(auth()).expect(204);
    } finally {
      notices.delay = 0;
    }
  }, 240_000);

  it("refuses an instance newer than this one", async () => {
    const newer = new PrismaClient({ datasources: { db: { url: urlFor(sourceDb) } } });
    try {
      await newer.$executeRawUnsafe(`
        INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
        VALUES ('${tag}', 'x', now(), '29991231000000_from_the_future', 1)`);
    } finally {
      await newer.$disconnect();
    }
    const newerDump = path.join(inRoot(), "newer.dump");
    dump(sourceDb, newerDump);
    const prepared = await request(app)
      .post("/api/admin/migrate/thingport")
      .set(auth())
      .send({ dump_path: newerDump, folder });
    runs.push(prepared.body.id);
    const failed = await until(prepared.body.id, (status) => status !== "preparing");
    expect(failed.status).toBe("failed");
    expect(failed.error.code).toBe("source_newer");
  }, 120_000);
});

describe("discarding a migration while it's being started or given another folder", () => {
  const options: MigrateOptions = {
    people: ["someone"],
    collections: false,
    studio: false,
    widgets: false,
    tools: false,
    syncs: false,
    signIns: false,
    settings: false,
    secrets: false,
  };
  const readyRun = () =>
    prisma.migrationRun.create({
      data: {
        source: "thingport",
        status: "ready",
        stagingDb: `thingport_migrate_missing_${crypto.randomBytes(4).toString("hex")}`,
        plan: { people: [{ id: "someone" }] },
      },
    });

  it("turns Discard away while Start is still claiming the run, so it can't start after it was discarded", async () => {
    const run = await readyRun();
    let letStart!: () => void;
    const held = new Promise<void>((resolve) => (letStart = resolve));
    const updateMany = prisma.migrationRun.updateMany.bind(prisma.migrationRun);
    // Start holds the slot, the run still "ready", until Discard has had its answer.
    const spy = vi.spyOn(prisma.migrationRun, "updateMany").mockImplementation((async (args: never) => {
      await held;
      return updateMany(args);
    }) as never);
    try {
      const starting = startRun(run.id, "nobody", options);
      await expect(removeRun(run.id)).rejects.toMatchObject({ status: 409, code: "busy" });
      letStart();
      await starting;
    } finally {
      spy.mockRestore();
    }
    for (let tries = 0; tries < 200; tries++) {
      const now = await prisma.migrationRun.findUniqueOrThrow({ where: { id: run.id } });
      if (now.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect((await prisma.migrationRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("failed");
    await prisma.migrationRun.delete({ where: { id: run.id } });
  });

  it("turns Discard away while another folder is being checked", async () => {
    const run = await readyRun();
    const changing = changeFolder(run.id, "/nowhere").catch(() => undefined);
    await expect(removeRun(run.id)).rejects.toMatchObject({ status: 409, code: "busy" });
    await changing;
    expect(await prisma.migrationRun.findUnique({ where: { id: run.id } })).not.toBeNull();
    await prisma.migrationRun.delete({ where: { id: run.id } });
  });
  it("turns Start away while Discard is cleaning up a run, so it can't merge from what's going", async () => {
    // Failed part-way with its working copy kept: Start would go on with it, and Discard files its models first.
    const run = await prisma.migrationRun.create({
      data: {
        source: "thingport",
        status: "failed",
        stagingDb: `thingport_migrate_missing_${crypto.randomBytes(4).toString("hex")}`,
        startedAt: new Date(),
        plan: { people: [{ id: "someone" }] },
      },
    });
    let letDiscard!: () => void;
    const held = new Promise<void>((resolve) => (letDiscard = resolve));
    let filing!: () => void;
    const reached = new Promise<void>((resolve) => (filing = resolve));
    const findMany = prisma.print.findMany.bind(prisma.print);
    // Discard waits while it files the run's models until Start has had its answer.
    const spy = vi.spyOn(prisma.print, "findMany").mockImplementation((async (args: never) => {
      filing();
      await held;
      return findMany(args);
    }) as never);
    try {
      const discarding = removeRun(run.id);
      await reached;
      await expect(startRun(run.id, "nobody", options)).rejects.toMatchObject({ status: 409, code: "busy" });
      letDiscard();
      await discarding;
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.migrationRun.findUnique({ where: { id: run.id } })).toBeNull();
  });
});
