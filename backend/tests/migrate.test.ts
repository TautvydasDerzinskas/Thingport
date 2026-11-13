import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { MERGED_TABLES, tablesThatCome } from "../src/services/migrate/merge";
import { dumpFormat, stagingName } from "../src/services/migrate/postgres";
import { MERGE_RULES } from "../src/services/migrate/rules";
import { checkFolder, folderSource } from "../src/services/migrate/sourceFiles";

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
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "thingport-migrate-"));
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

// The real thing needs pg_dump and pg_restore beside the test database, as the backend image has.
const hasPgTools =
  spawnSync("pg_dump", ["--version"]).status === 0 && spawnSync("pg_restore", ["--version"]).status === 0;

const RELEASE_1_0_0_MIGRATIONS = 59;

/** Where the test database is, as libpq's environment says it. */
function pgEnv(database: string): NodeJS.ProcessEnv {
  const url = new URL(process.env.DATABASE_URL!);
  return {
    PATH: process.env.PATH,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
  };
}

function urlFor(database: string): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${database}`;
  return url.toString();
}

/** An instance at release 1.0.0: a database with its 59 database changes, and some people and models in it. */
async function oldInstance(database: string, tag: string, folder: string) {
  await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}"`);
  await prisma.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
  const prismaDir = tmp();
  fs.copyFileSync(path.resolve("prisma/schema.prisma"), path.join(prismaDir, "schema.prisma"));
  fs.mkdirSync(path.join(prismaDir, "migrations"));
  fs.copyFileSync(
    path.resolve("prisma/migrations/migration_lock.toml"),
    path.join(prismaDir, "migrations/migration_lock.toml"),
  );
  const released = fs
    .readdirSync(path.resolve("prisma/migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted()
    .slice(0, RELEASE_1_0_0_MIGRATIONS);
  for (const name of released) {
    fs.cpSync(path.resolve("prisma/migrations", name), path.join(prismaDir, "migrations", name), { recursive: true });
  }
  execFileSync(
    process.execPath,
    [
      path.resolve("node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
      "--schema",
      path.join(prismaDir, "schema.prisma"),
    ],
    { env: { ...process.env, DATABASE_URL: urlFor(database) }, stdio: "pipe" },
  );
  const old = new PrismaClient({ datasources: { db: { url: urlFor(database) } } });
  const id = (name: string) => `${name}${tag}`;
  try {
    // As release 1.0.0's tables were: MakerWorld's cookie on the user, category ids in arrays.
    await old.$executeRawUnsafe(`
      INSERT INTO "User" (id, email, "passwordHash", "displayName", role, "isOwner", "updatedAt", "makerworldCookie", "apiTokenHash") VALUES
        ('${id("ualice")}', 'Alice-${tag}@example.com', '$2b$12$alicehash', 'Alice', 'ADMIN', true, now(), 'mw-cookie', 'tokenhash-${tag}'),
        ('${id("ubob")}', 'bob-${tag}@example.com', '$2b$12$bobhash', 'Bob', 'MEMBER', false, now(), NULL, NULL),
        ('${id("ucarol")}', 'carol-${tag}@example.com', '$2b$12$carolhash', 'Carol', 'MEMBER', false, now(), NULL, NULL)`);
    await old.$executeRawUnsafe(`
      INSERT INTO "Category" (id, "userId", name, kind, "parentId", position, "makerworldCatIds", "updatedAt") VALUES
        ('${id("ctoys")}', '${id("ualice")}', 'Toys', 'category', NULL, 0, '{1001}', now()),
        ('${id("cpuzz")}', '${id("ualice")}', 'Puzzles', 'category', '${id("ctoys")}', 0, '{1002}', now())`);
    await old.$executeRawUnsafe(`
      INSERT INTO "Print" (id, "userId", name, "nameNormalized", tags, "sourceProvider", "sourceExternalId", "categoryId", "updatedAt") VALUES
        ('${id("pbenchy")}', '${id("ualice")}', 'Benchy', 'benchy', '{pla}', 'makerworld', '${tag}1', '${id("cpuzz")}', now()),
        ('${id("pgone")}', '${id("ualice")}', 'Gone', 'gone', '{}', NULL, NULL, NULL, now()),
        ('${id("pgear")}', '${id("ubob")}', 'Gear', 'gear', '{}', 'printables', '${tag}2', NULL, now()),
        ('${id("pbracket")}', '${id("ubob")}', 'Bracket', 'bracket', '{}', NULL, NULL, NULL, now()),
        ('${id("pcube")}', '${id("ucarol")}', 'Cube', 'cube', '{}', NULL, NULL, NULL, now())`);
    const plates = [
      ["lbenchy", "pbenchy", "ualice", "Toys/Puzzles/Benchy/benchy.stl"],
      ["lgone", "pgone", "ualice", "Gone/gone.stl"],
      ["lgear", "pgear", "ubob", "Gear/gear.stl"],
      ["lbracket", "pbracket", "ubob", "Bracket/bracket.stl"],
      ["lcube", "pcube", "ucarol", "Cube/cube.stl"],
    ];
    for (const [plate, print, user, rest] of plates) {
      const storagePath = `u-${id(user)}/${rest}`;
      await old.$executeRawUnsafe(`
        INSERT INTO "Plate" (id, "printId", position, filename, mime, size, "storagePath", "updatedAt") VALUES
          ('${id(plate)}', '${id(print)}', 0, '${path.basename(rest)}', 'model/stl', 5, '${storagePath}', now())`);
      // Gone's file isn't in the folder.
      if (plate !== "lgone") {
        fs.mkdirSync(path.join(folder, path.dirname(storagePath)), { recursive: true });
        fs.writeFileSync(path.join(folder, storagePath), `solid ${plate}`);
      }
    }
    // A picture where 1.0.0 kept them, in a shared folder by id.
    await old.$executeRawUnsafe(
      `INSERT INTO "PreviewImage" (id, "printId", position) VALUES ('${id("ibenchy")}', '${id("pbenchy")}', 0)`,
    );
    fs.mkdirSync(path.join(folder, "previews"), { recursive: true });
    fs.writeFileSync(path.join(folder, "previews", `${id("ibenchy")}.jpg`), "jpeg");
    await old.$executeRawUnsafe(`
      INSERT INTO "Collection" (id, "userId", name, "nameNormalized", "updatedAt") VALUES
        ('${id("kmech")}', '${id("ubob")}', 'Mechanical', 'mechanical', now())`);
    await old.$executeRawUnsafe(`
      INSERT INTO "CollectionItem" (id, "collectionId", "printId", position) VALUES
        ('${id("imech1")}', '${id("kmech")}', '${id("pgear")}', 0),
        ('${id("imech2")}', '${id("kmech")}', '${id("pbracket")}', 1)`);
  } finally {
    await old.$disconnect();
  }
}

function dump(database: string, file: string) {
  execFileSync("pg_dump", ["-Fc", "-f", file], { env: pgEnv(database), stdio: "pipe" });
}

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
