import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../src/db";

// An older Thingport instance for the migrate tests: a database at release 1.0.0's 59 database changes, with people
// and models in 1.0.0's columns, and its storage folder.

export const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "thingport-migrate-"));

// The real thing needs pg_dump and pg_restore beside the test database, as the backend image has.
export const hasPgTools =
  spawnSync("pg_dump", ["--version"]).status === 0 && spawnSync("pg_restore", ["--version"]).status === 0;

export const RELEASE_1_0_0_MIGRATIONS = 59;

/** Where the test database is, as libpq's environment says it. */
export function pgEnv(database: string): NodeJS.ProcessEnv {
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

export function urlFor(database: string): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${database}`;
  return url.toString();
}

/** An instance at release 1.0.0: a database with its 59 database changes, and some people and models in it. */
export async function oldInstance(database: string, tag: string, folder: string) {
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

export function dump(database: string, file: string) {
  execFileSync("pg_dump", ["-Fc", "-f", file], { env: pgEnv(database), stdio: "pipe" });
}
