import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { MigrateError } from "../src/services/migrate/errors";
import {
  createExportToken,
  exportTokenOf,
  FolderTooLargeError,
  markExportRead,
  revokeExportToken,
  storageFolder,
} from "../src/services/migrate/export";
import { Merge } from "../src/services/migrate/merge";
import { httpSource } from "../src/services/migrate/remote";
import { tmp } from "./migrateFixture";

const bearer = (token: string) => `Bearer ${token}`;

describe("the migration exporter", () => {
  let adminId = "";
  let server: http.Server;
  let address = "";

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: { email: `export-review-${Date.now()}@example.com`, displayName: "Export Admin", role: "ADMIN" },
    });
    adminId = admin.id;
    server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await revokeExportToken(adminId);
    await new Promise((resolve) => server.close(resolve));
    await prisma.user.deleteMany({ where: { id: adminId } });
  });

  it("doesn't bring back a replaced token when a read of it is noted late", async () => {
    const first = await createExportToken(adminId);
    const record = await exportTokenOf(bearer(first.token));
    expect(record).not.toBeNull();
    // Another token is made while a dump request with the first one is on its way.
    const second = await createExportToken(adminId);
    await markExportRead(record!);
    expect(await exportTokenOf(bearer(first.token))).toBeNull();
    expect(await exportTokenOf(bearer(second.token))).not.toBeNull();
    // Its own reads are still noted.
    await markExportRead((await exportTokenOf(bearer(second.token)))!);
    expect((await exportTokenOf(bearer(second.token)))?.usedAt).toBeTruthy();
  });

  it("lists nothing through a folder that links out of storage", async () => {
    const outside = tmp();
    fs.writeFileSync(path.join(outside, "secret.stl"), "solid secret");
    const link = `alias-${Date.now()}`;
    fs.mkdirSync(STORAGE, { recursive: true });
    fs.symlinkSync(outside, path.join(STORAGE, link));
    try {
      expect(await storageFolder(link)).toEqual([]);
      expect(await storageFolder(`${link}/`)).toEqual([]);
    } finally {
      fs.unlinkSync(path.join(STORAGE, link));
    }
  });

  it("refuses a folder with more files than it lists, rather than leave some out", async () => {
    const name = `big-${Date.now()}`;
    const folder = path.join(STORAGE, name);
    fs.mkdirSync(folder, { recursive: true });
    for (let i = 0; i < 4; i += 1) fs.writeFileSync(path.join(folder, `${i}.stl`), "solid");
    try {
      expect(await storageFolder(name, 4)).toHaveLength(4);
      await expect(storageFolder(name, 3)).rejects.toBeInstanceOf(FolderTooLargeError);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  it("makes the other side stop on a folder too big to list, instead of copying part of it", async () => {
    const name = `huge-${Date.now()}`;
    const folder = path.join(STORAGE, name);
    fs.mkdirSync(folder, { recursive: true });
    for (let i = 0; i <= 10_000; i += 1) fs.writeFileSync(path.join(folder, `${i}.png`), "");
    const { token } = await createExportToken(adminId);
    const to = tmp();
    try {
      const failure = await httpSource({ address, token })
        .copyFolder(name, to)
        .catch((err: unknown) => err);
      expect(failure).toBeInstanceOf(MigrateError);
      expect((failure as MigrateError).code).toBe("online_folder");
      expect((failure as MigrateError).values).toEqual({ limit: 10_000 });
      expect(fs.readdirSync(to)).toEqual([]);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  }, 60_000);

  it("sends no more requests once the run is discarded", async () => {
    let requests = 0;
    const stub = http.createServer((_req, res) => {
      requests += 1;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ missing: [] }));
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    const at = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    try {
      const abort = new AbortController();
      abort.abort();
      const files = httpSource({ address: at, token: "tpm_x" }, abort.signal);
      const paths = Array.from({ length: 1500 }, (_, i) => `u-1/${i}.stl`);
      await expect(files.missing(paths)).rejects.toMatchObject({ name: "AbortError" });
      await expect(files.exists("u-1/a.stl")).rejects.toMatchObject({ name: "AbortError" });
      await expect(files.copy("u-1/a.stl", path.join(tmp(), "a.stl"))).rejects.toMatchObject({ name: "AbortError" });
      await expect(files.copyFolder("studio/x", tmp())).rejects.toMatchObject({ name: "AbortError" });
      expect(requests).toBe(0);
    } finally {
      await new Promise((resolve) => stub.close(resolve));
    }
  });
});

describe("a merge whose old instance goes away", () => {
  type Failing = { report: { failures: unknown[] }; fail(kind: string, name: string, err: unknown): void };
  const merge = () => {
    const self = { report: { failures: [] as unknown[] } } as Failing;
    self.fail = (Merge.prototype as unknown as Failing).fail.bind(self);
    return self;
  };

  it("stops on the old instance being unreachable, so the run fails and can be started again", () => {
    for (const code of ["online_unreachable", "online_lost", "online_token", "online_old"]) {
      const run = merge();
      expect(() => run.fail("model", "Benchy", new MigrateError(code, "gone"))).toThrow(MigrateError);
      expect(run.report.failures).toEqual([]);
    }
  });

  it("notes one thing that can't come and goes on", () => {
    const run = merge();
    run.fail("model", "Benchy", new Error("A file is missing"));
    run.fail("design", "Bracket", new MigrateError("online_folder", "too many"));
    expect(run.report.failures).toHaveLength(2);
  });
});
