import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { Merge, MIGRATE_FOLDER, type MigrateOptions } from "../src/services/migrate/merge";
import type { SourceFiles } from "../src/services/migrate/sourceFiles";

// The merge on its own, from a working copy already at this release: what it does with rows the old instance's
// database could hold that its own app wouldn't have made.

const tag = crypto.randomBytes(4).toString("hex");
const sourceDb = `thingport_merge_source_${tag}`;
let source: PrismaClient;
const people: string[] = [];

function urlFor(database: string): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${database}`;
  return url.toString();
}

/** A storage folder with nothing in it, its copies counted; `failFolders` fails that many folder copies first. */
function noFiles(failFolders = 0) {
  const folders: string[] = [];
  const files: SourceFiles = {
    exists: async () => false,
    missing: async (paths) => paths,
    copy: async () => false,
    copyFolder: async (relative) => {
      folders.push(relative);
      if (failFolders > 0) {
        failFolders -= 1;
        throw new Error("the disk went away");
      }
      return 0;
    },
  };
  return { files, folders };
}

const options = (ids: string[]): MigrateOptions => ({
  people: ids,
  collections: false,
  studio: true,
  widgets: false,
  tools: false,
  syncs: false,
  signIns: false,
  settings: false,
  secrets: true,
});

async function merge(ids: string[], files: SourceFiles = noFiles().files, more: Partial<MigrateOptions> = {}) {
  const runId = `merge${crypto.randomBytes(6).toString("hex")}`;
  const report = await new Merge(source, files, runId, { ...options(ids), ...more }, () => undefined).run();
  return report;
}

/** Someone there, and the account they have here already when `here` is given. */
async function person(name: string, here = false) {
  const email = `${name}-${tag}@example.com`;
  const sourceId = `src${name}${tag}`;
  await source.user.create({ data: { id: sourceId, email, displayName: name, passwordHash: "there" } });
  let hereId: string | null = null;
  if (here) {
    hereId = (await prisma.user.create({ data: { email, displayName: name, passwordHash: "here" } })).id;
    people.push(hereId);
  }
  return { sourceId, email, hereId };
}

async function hereIdOf(email: string) {
  const found = await prisma.user.findFirstOrThrow({ where: { email } });
  if (!people.includes(found.id)) people.push(found.id);
  return found.id;
}

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`CREATE DATABASE "${sourceDb}"`);
  execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: urlFor(sourceDb) },
    stdio: "pipe",
  });
  source = new PrismaClient({ datasources: { db: { url: urlFor(sourceDb) } } });
}, 180_000);

afterAll(async () => {
  await source?.$disconnect();
  await prisma.user.deleteMany({ where: { id: { in: people } } });
  await prisma.oidcProvider.deleteMany({ where: { slug: { endsWith: tag } } });
  await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${sourceDb}"`);
}, 60_000);

describe("merging a working copy", () => {
  it("tells a category named with a / from a category inside another", async () => {
    const dana = await person("dana", true);
    const parent = await prisma.category.create({ data: { userId: dana.hereId!, name: "Tools", kind: "category" } });
    const child = await prisma.category.create({
      data: { userId: dana.hereId!, name: "Bits", kind: "category", parentId: parent.id },
    });
    const slashed = await source.category.create({
      data: { id: `cslash${tag}`, userId: dana.sourceId, name: "Tools/Bits", kind: "category" },
    });
    await merge([dana.sourceId]);
    const brought = await prisma.category.findUnique({ where: { id: slashed.id } });
    expect(brought).toMatchObject({ userId: dana.hereId, name: "Tools/Bits", parentId: null });
    expect(brought!.id).not.toBe(child.id);
  });

  it("brings no model whose id would name a folder outside the run's", async () => {
    const erin = await person("erin");
    const escape = path.join(STORAGE, MIGRATE_FOLDER, `escape${tag}`);
    fs.mkdirSync(escape, { recursive: true });
    fs.writeFileSync(path.join(escape, "keep"), "keep");
    const id = `../escape${tag}`;
    await source.print.create({ data: { id, userId: erin.sourceId, name: "Escape", nameNormalized: "escape" } });
    await source.plate.create({
      data: { printId: id, position: 0, filename: "e.stl", mime: "model/stl", size: 1, storagePath: "e.stl" },
    });
    const report = await merge([erin.sourceId]);
    expect(fs.existsSync(path.join(escape, "keep"))).toBe(true);
    expect(report.models.failed).toBe(1);
    expect(await prisma.print.count({ where: { id } })).toBe(0);
    fs.rmSync(escape, { recursive: true, force: true });
    await hereIdOf(erin.email);
  });

  it("brings no model whose file's id would name a file outside the run's folder", async () => {
    const hana = await person("hana");
    const escape = path.join(STORAGE, `escape${tag}.stl`);
    fs.writeFileSync(escape, "keep");
    const id = `pescape${tag}`;
    await source.print.create({ data: { id, userId: hana.sourceId, name: "Escape", nameNormalized: "escape" } });
    await source.plate.create({
      data: {
        id: `../../../escape${tag}`,
        printId: id,
        position: 0,
        filename: "e.stl",
        mime: "model/stl",
        size: 1,
        storagePath: `h${tag}.stl`,
      },
    });
    const copied: string[] = [];
    const files: SourceFiles = {
      ...noFiles().files,
      copy: async (_from, to) => {
        copied.push(to);
        return true;
      },
    };
    const report = await merge([hana.sourceId], files);
    expect(copied.filter((to) => !path.resolve(to).startsWith(path.join(STORAGE, MIGRATE_FOLDER) + path.sep))).toEqual(
      [],
    );
    expect(fs.readFileSync(escape, "utf8")).toBe("keep");
    expect(report.models.failed).toBe(1);
    expect(await prisma.print.count({ where: { id } })).toBe(0);
    fs.rmSync(escape, { force: true });
    await hereIdOf(hana.email);
  });

  it("signs nobody in through a provider here that only shares the old one's name", async () => {
    const frank = await person("frank", true);
    const gina = await person("gina", true);
    const here = await prisma.oidcProvider.create({
      data: { slug: `corp${tag}`, name: "Corp", issuerUrl: "https://auth.here.example/", clientId: "here" },
    });
    const same = await prisma.oidcProvider.create({
      data: { slug: `same${tag}`, name: "Same", issuerUrl: "https://auth.same.example/", clientId: "here" },
    });
    const elsewhere = await source.oidcProvider.create({
      data: { slug: `corp${tag}`, name: "Corp", issuerUrl: "https://auth.there.example/", clientId: "there" },
    });
    const sameThere = await source.oidcProvider.create({
      data: { slug: `same${tag}`, name: "Same", issuerUrl: "https://auth.same.example", clientId: "there" },
    });
    await source.userIdentity.create({ data: { userId: frank.sourceId, providerId: elsewhere.id, subject: "f1" } });
    await source.userIdentity.create({ data: { userId: gina.sourceId, providerId: sameThere.id, subject: "g1" } });
    await merge([frank.sourceId, gina.sourceId]);
    expect(await prisma.userIdentity.count({ where: { providerId: here.id } })).toBe(0);
    expect(await prisma.oidcProvider.findUniqueOrThrow({ where: { id: here.id } })).toMatchObject({
      issuerUrl: "https://auth.here.example/",
      clientId: "here",
    });
    expect(await prisma.userIdentity.findMany({ where: { providerId: same.id } })).toMatchObject([
      { userId: gina.hereId, subject: "g1" },
    ]);
  });

  it("finishes a Studio design an earlier try left part-way", async () => {
    const hal = await person("hal");
    const design = await source.studioDesign.create({
      data: { id: `design${tag}`, userId: hal.sourceId, name: "Bracket", document: { shapes: [] } },
    });
    const first = noFiles(1);
    const report = await merge([hal.sourceId], first.files);
    expect(report.failures.map((failure) => failure.kind)).toContain("design");
    expect(await prisma.studioDesign.count({ where: { id: design.id } })).toBe(1);
    // Its revision is added there since, as it might have been one the earlier try didn't get to.
    await source.studioRevision.create({
      data: { designId: design.id, position: 0, document: { shapes: [] }, actor: "person" },
    });
    const again = noFiles();
    const second = await merge([hal.sourceId], again.files);
    expect(second.failures).toEqual([]);
    expect(second.designs).toBe(0);
    expect(again.folders).toEqual([path.join("studio", `u-${hal.sourceId}`, design.id)]);
    expect(await prisma.studioRevision.count({ where: { designId: design.id } })).toBe(1);
    await hereIdOf(hal.email);
  });

  it("brings badges as they were seen there, never lowering one someone has here, and the days they came", async () => {
    const ivy = await person("ivy", true);
    const seen = new Date("2026-11-01T10:00:00Z");
    await prisma.userAchievement.createMany({
      data: [
        { userId: ivy.hereId!, badge: "downloads", tier: 1 },
        { userId: ivy.hereId!, badge: "imports", tier: 3 },
      ],
    });
    await source.userAchievement.createMany({
      data: [
        { userId: ivy.sourceId, badge: "downloads", tier: 2, earnedAt: seen, seenAt: seen },
        { userId: ivy.sourceId, badge: "imports", tier: 1, seenAt: seen },
        { userId: ivy.sourceId, badge: "studio", tier: 0, earnedAt: seen, seenAt: null },
      ],
    });
    const day = new Date("2026-11-10T00:00:00Z");
    await prisma.userActiveDay.create({ data: { userId: ivy.hereId!, day } });
    await source.userActiveDay.createMany({
      data: [
        { userId: ivy.sourceId, day },
        { userId: ivy.sourceId, day: new Date("2026-11-11T00:00:00Z") },
      ],
    });
    const badges = async () =>
      (await prisma.userAchievement.findMany({ where: { userId: ivy.hereId! }, orderBy: { badge: "asc" } })).map(
        ({ badge, tier, earnedAt, seenAt }) => ({ badge, tier, earnedAt, seenAt }),
      );
    await merge([ivy.sourceId]);
    const after = await badges();
    expect(after).toMatchObject([
      { badge: "downloads", tier: 2, earnedAt: seen, seenAt: seen },
      { badge: "imports", tier: 3 },
      { badge: "studio", tier: 0, earnedAt: seen, seenAt: null },
    ]);
    expect(await prisma.userActiveDay.count({ where: { userId: ivy.hereId! } })).toBe(2);
    await merge([ivy.sourceId]);
    expect(await badges()).toEqual(after);
  });

  it("links a copy an earlier try brought to its original, once that comes too", async () => {
    const jo = await person("jo");
    const original = `orig${tag}`;
    const copy = `copy${tag}`;
    await source.print.create({ data: { id: original, userId: jo.sourceId, name: "Hook", nameNormalized: "hook" } });
    await source.print.create({
      data: { id: copy, userId: jo.sourceId, name: "Hook copy", nameNormalized: "hook copy", copiedFromId: original },
    });
    // The first try brings the copy, but not its original.
    const findUnique = prisma.print.findUnique.bind(prisma.print);
    let failed = false;
    const spy = vi.spyOn(prisma.print, "findUnique").mockImplementation(((args: { where: { id?: string } }) => {
      if (args.where.id !== original || failed) return findUnique(args as never);
      failed = true;
      return Promise.reject(new Error("The database went away"));
    }) as never);
    try {
      expect((await merge([jo.sourceId])).models).toMatchObject({ brought: 1, failed: 1 });
    } finally {
      spy.mockRestore();
    }
    expect((await prisma.print.findUniqueOrThrow({ where: { id: copy } })).copiedFromId).toBeNull();
    expect((await merge([jo.sourceId])).models).toMatchObject({ brought: 1, earlier: 1 });
    expect((await prisma.print.findUniqueOrThrow({ where: { id: copy } })).copiedFromId).toBe(original);
    await hereIdOf(jo.email);
  });

  it("has whom someone's tool entries reach in place before the entries come", async () => {
    const kit = await person("kit");
    const toolId = `tool${tag}`;
    await source.tool.create({
      data: {
        id: toolId,
        source: "own",
        scope: kit.sourceId,
        slug: `queue-${tag}`,
        userId: kit.sourceId,
        manifest: { name: "Queue" },
        script: "export default () => {}",
        sha: "x",
      },
    });
    await source.toolSharedData.create({
      data: { toolId, userId: kit.sourceId, key: "job:1", value: { n: 1 }, size: 7 },
    });
    // Kept to nobody but themselves.
    await source.toolAudience.create({ data: { toolId, userId: kit.sourceId, userIds: [] } });
    const createMany = prisma.toolSharedData.createMany.bind(prisma.toolSharedData);
    let audienceThen: number | null = null;
    const spy = vi.spyOn(prisma.toolSharedData, "createMany").mockImplementation((async (args: never) => {
      audienceThen = await prisma.toolAudience.count({ where: { toolId } });
      return createMany(args);
    }) as never);
    try {
      expect((await merge([kit.sourceId], noFiles().files, { tools: true })).failures).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    expect(audienceThen).toBe(1);
    const here = await hereIdOf(kit.email);
    expect(await prisma.toolSharedData.count({ where: { toolId, userId: here } })).toBe(1);
    expect(await prisma.toolAudience.findUnique({ where: { toolId_userId: { toolId, userId: here } } })).toMatchObject({
      userIds: [],
    });
  });

  it("knows a copy, and what's shared about its original, by the model that original is here", async () => {
    const mo = await person("mo", true);
    const pat = await person("pat");
    const page = { sourceProvider: "printables", sourceExternalId: `77${tag}` };
    // Mo has the model here already, imported from the same page as the one they bring.
    const here = await prisma.print.create({
      data: { userId: mo.hereId!, name: "Hinge", nameNormalized: "hinge", ...page },
    });
    const original = `hinge${tag}`;
    const copy = `hingecopy${tag}`;
    await source.print.create({
      data: { id: original, userId: mo.sourceId, name: "Hinge", nameNormalized: "hinge", ...page },
    });
    await source.print.create({
      data: {
        id: copy,
        userId: pat.sourceId,
        name: "Hinge",
        nameNormalized: "hinge",
        originalId: original,
        copiedFromId: original,
      },
    });
    const toolId = `tool3${tag}`;
    await source.tool.create({
      data: {
        id: toolId,
        source: "own",
        scope: mo.sourceId,
        slug: `queue3-${tag}`,
        userId: mo.sourceId,
        manifest: { name: "Queue" },
        script: "export default () => {}",
        sha: "x",
      },
    });
    await source.toolSharedData.create({
      data: {
        toolId,
        userId: mo.sourceId,
        key: "about:1",
        value: { jobs: 1 },
        size: 10,
        printId: original,
        originKey: `orig:${original}`,
      },
    });

    expect((await merge([mo.sourceId, pat.sourceId], noFiles().files, { tools: true })).failures).toEqual([]);
    await hereIdOf(pat.email);
    const brought = await prisma.print.findUniqueOrThrow({ where: { id: copy } });
    expect(brought).toMatchObject({ originalId: here.id, copiedFromId: here.id });
    const entry = await prisma.toolSharedData.findFirstOrThrow({ where: { toolId, userId: mo.hereId! } });
    // The key the copy's page reads by.
    expect(entry).toMatchObject({ printId: here.id, originKey: `orig:${brought.originalId}` });
  });

  it("takes the copy someone has here already for theirs of an original that's another model here", async () => {
    const kim = await person("kim", true);
    const joe = await person("joe", true);
    const page = { sourceProvider: "printables", sourceExternalId: `78${tag}` };
    const here = await prisma.print.create({
      data: { userId: kim.hereId!, name: "Clip", nameNormalized: "clip", ...page },
    });
    // Joe copied Kim's model here; there, his copy is of the one Kim brings, which is that model.
    await prisma.print.create({
      data: { userId: joe.hereId!, name: "Clip", nameNormalized: "clip", originalId: here.id, copiedFromId: here.id },
    });
    const original = `clip${tag}`;
    const copy = `clipcopy${tag}`;
    await source.print.create({
      data: { id: original, userId: kim.sourceId, name: "Clip", nameNormalized: "clip", ...page },
    });
    await source.print.create({
      data: {
        id: copy,
        userId: joe.sourceId,
        name: "Clip",
        nameNormalized: "clip",
        originalId: original,
        copiedFromId: original,
      },
    });

    // Joe first, so his copy would be reached before the original if they went by person alone.
    const report = await merge([joe.sourceId, kim.sourceId]);
    expect(report.failures).toEqual([]);
    expect(await prisma.print.findUnique({ where: { id: copy } })).toBeNull();
    expect(await prisma.print.count({ where: { userId: joe.hereId! } })).toBe(1);
  });

  it("keeps someone's tool entries from whoever either account kept them from", async () => {
    const lee = await person("lee", true);
    const both = await prisma.user.create({ data: { email: `both-${tag}@example.com`, displayName: "Both" } });
    const hereOnly = await prisma.user.create({ data: { email: `hereonly-${tag}@example.com`, displayName: "Here" } });
    people.push(both.id, hereOnly.id);
    // Comes along, so the source's audience can name them.
    await source.user.create({ data: { id: `srcboth${tag}`, email: both.email, displayName: "Both" } });
    const slug = `queue2-${tag}`;
    const sourceTool = `tool2${tag}`;
    await source.tool.create({
      data: {
        id: sourceTool,
        source: "own",
        scope: lee.sourceId,
        slug,
        userId: lee.sourceId,
        manifest: { name: "Queue" },
        script: "export default () => {}",
        sha: "x",
      },
    });
    await source.toolSharedData.create({
      data: { toolId: sourceTool, userId: lee.sourceId, key: "job:1", value: { n: 1 }, size: 7 },
    });
    await source.toolAudience.create({
      data: { toolId: sourceTool, userId: lee.sourceId, userIds: [`srcboth${tag}`] },
    });
    // The same tool here, its entries kept to two people, one of whom the source kept them from.
    const hereTool = await prisma.tool.create({
      data: {
        source: "own",
        scope: lee.hereId!,
        slug,
        userId: lee.hereId!,
        manifest: { name: "Queue" },
        script: "export default () => {}",
        sha: "x",
      },
    });
    await prisma.toolAudience.create({
      data: { toolId: hereTool.id, userId: lee.hereId!, userIds: [both.id, hereOnly.id] },
    });

    expect((await merge([lee.sourceId, `srcboth${tag}`], noFiles().files, { tools: true })).failures).toEqual([]);
    expect(await prisma.toolSharedData.count({ where: { toolId: hereTool.id, userId: lee.hereId! } })).toBe(1);
    const audience = await prisma.toolAudience.findUniqueOrThrow({
      where: { toolId_userId: { toolId: hereTool.id, userId: lee.hereId! } },
    });
    expect(audience.userIds).toEqual([both.id]);
  });
});
