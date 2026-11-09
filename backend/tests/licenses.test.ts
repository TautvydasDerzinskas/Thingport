import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A licence read that never ends gives up quickly here. config.ts reads it on load, so it's hoisted.
vi.hoisted(() => {
  process.env.LICENSE_READ_TIMEOUT_MS = "2000";
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { createApp } from "../src/app";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { PROVIDERS } from "../src/providers/registry";
import {
  ccLicenseId,
  licenseById,
  licenseIdFromText,
  licenseIdFromUrl,
  PICKABLE_LICENSE_IDS,
} from "../src/services/licenseCatalog";
import { licenseData, licenseOut, licensePending, startLicenseFill } from "../src/services/licenseService";
import { syncLicenseFile } from "../src/services/licenseFile";
import { upsertAuthorFromImport } from "../src/services/authorService";
import { buildZipEntries } from "../src/services/downloadZip";
import { setProviderEnabled } from "../src/services/providerSettingsService";
import {
  getLicenseFiles,
  getSocialSettings,
  setLicenseFiles,
  setSocialSettings,
} from "../src/services/settingsService";
import { emptyImportedPageMetadata } from "../src/services/importResolvers";
import { readZipEntry } from "../src/utils/zipReader";

// A model's licence end to end: what's kept, LICENSE.txt beside its files, the filter, zips, the storage browser, and an
// older import's licence read when its owner opens it.

const app = createApp();
const stamp = Date.now();
let token: string;
let userId: string;
let adminToken: string;
const auth = () => ({ Authorization: `Bearer ${token}` });
const STL =
  "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n";

async function upload(name: string): Promise<string> {
  const res = await request(app).post("/api/upload").set(auth()).attach("files", Buffer.from(STL), `${name}.stl`);
  expect(res.status).toBe(200);
  return res.body.prints[0].id as string;
}

async function licenseFiles(printId: string) {
  return prisma.printFile.findMany({ where: { printId, role: "LICENSE" } });
}

const read = (storagePath: string) => fs.readFileSync(path.join(STORAGE, storagePath), "utf8");

/** Waits for what runs in the background after a request to get there. */
async function until(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** The licence state once a read has finished. */
async function settled(printId: string) {
  for (let i = 0; ; i++) {
    const state = (await request(app).get(`/api/print/${printId}/license`).set(auth())).body;
    if (!state.filling || i >= 100) return state;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

let previousLicenseFiles = true;

beforeAll(async () => {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Licences", email: `licenses-${stamp}@example.com`, password: "password123" });
  token = res.body.token;
  userId = res.body.user.id;
  // On an empty database the first account is the instance's admin; this one stands for any member.
  await prisma.user.update({ where: { id: userId }, data: { role: "MEMBER" } });
  const admin = await request(app)
    .post("/api/register")
    .send({ displayName: "Licence Admin", email: `licenses-admin-${stamp}@example.com`, password: "password123" });
  adminToken = admin.body.token;
  await prisma.user.update({ where: { id: admin.body.user.id }, data: { role: "ADMIN" } });
  previousLicenseFiles = await getLicenseFiles();
  await setLicenseFiles(true);
});

afterAll(async () => {
  // Files share one database; leave the setting as this file found it.
  await setLicenseFiles(previousLicenseFiles);
});

describe("the licence catalogue", () => {
  it("reads Creative Commons licences by their parts, links and names", () => {
    expect(ccLicenseId("BY-NC-SA")).toBe("CC-BY-NC-SA-4.0");
    expect(ccLicenseId("cc_by_nd")).toBe("CC-BY-ND-4.0");
    expect(ccLicenseId("cc-nc-sa")).toBe("CC-BY-NC-SA-4.0");
    expect(ccLicenseId("by", "3.0")).toBe("CC-BY-3.0");
    // "CC" alone names no licence.
    expect(ccLicenseId("")).toBeNull();
    expect(ccLicenseId("CC")).toBeNull();

    expect(licenseIdFromUrl("https://creativecommons.org/licenses/by-nc/4.0/")).toBe("CC-BY-NC-4.0");
    expect(licenseIdFromUrl("http://creativecommons.org/licenses/by/3.0/deed.en")).toBe("CC-BY-3.0");
    expect(licenseIdFromUrl("https://creativecommons.org/publicdomain/zero/1.0/")).toBe("CC0-1.0");
    expect(licenseIdFromUrl("https://creativecommons.org/licenses/publicdomain/")).toBe("public-domain");
    expect(licenseIdFromUrl("https://www.gnu.org/licenses/gpl-3.0.en.html")).toBe("GPL-3.0");
    expect(licenseIdFromUrl("https://example.com/terms")).toBeNull();

    expect(licenseIdFromText("Creative Commons - Attribution - Non-Commercial")).toBe("CC-BY-NC-4.0");
    expect(licenseIdFromText("CC BY-NC-ND 4.0 International.pdf")).toBe("CC-BY-NC-ND-4.0");
    expect(licenseIdFromText("Attribution-NoDerivs 3.0 Creative Commons")).toBe("CC-BY-ND-3.0");
    expect(licenseIdFromText("Standard_Digital_File_License.txt")).toBe("sdfl");
    expect(licenseIdFromText("MIT License.txt")).toBe("MIT");
    expect(licenseIdFromText("Creative Commons")).toBeNull();
    // At a version the catalogue doesn't have: none it knows, not the same one at 4.0.
    expect(licenseIdFromText("CC BY-SA 2.0")).toBeNull();
    expect(licenseIdFromText("Creative Commons Attribution 2.5 Generic")).toBeNull();
    // The version is the licence's own, the first it names.
    expect(licenseIdFromText("CC BY 4.0, adapted from a 2.0 original")).toBe("CC-BY-4.0");
    expect(licenseIdFromText("CC BY 2.0, adapted from a 4.0 original")).toBeNull();
    expect(licenseIdFromText("CC BY-NC 3.0, since 4.0 came out")).toBe("CC-BY-NC-3.0");
    expect(licenseIdFromText("Model release 2.0; licensed CC BY 4.0")).toBe("CC-BY-4.0");
    expect(licenseIdFromText("CC BY v2.0")).toBeNull();
    expect(licenseIdFromText("CC BY 2.1 JP")).toBeNull();
    // A number that isn't the licence's own version: a model's revision.
    expect(licenseIdFromText("CC BY-SA (Thing v2.1)")).toBe("CC-BY-SA-4.0");
    expect(licenseIdFromText("Creative Commons Legal Code\n\nAttribution-NonCommercial 3.0 Unported")).toBe(
      "CC-BY-NC-3.0",
    );
    expect(licenseIdFromText("CC BY-SA v3.0")).toBe("CC-BY-SA-3.0");
    expect(licenseIdFromText("My own terms")).toBeNull();
  });

  it("offers an owner every standard licence but Creative Commons' older versions and the sites' own", () => {
    expect(PICKABLE_LICENSE_IDS).toEqual(
      expect.arrayContaining(["CC-BY-4.0", "CC0-1.0", "GPL-3.0", "LGPL-3.0", "MIT"]),
    );
    expect(PICKABLE_LICENSE_IDS).toContain("all-rights-reserved");
    expect(PICKABLE_LICENSE_IDS).not.toContain("CC-BY-3.0");
    expect(PICKABLE_LICENSE_IDS).not.toContain("sdfl");
  });

  it("says what each licence allows, and a model's own terms win", () => {
    expect(licenseById("CC-BY-NC-SA-4.0")?.allows).toEqual(["share", "remix"]);
    expect(licenseById("sdfl")?.allows).toEqual([]);
    const toymakr = licenseData({ id: "CC-BY-NC-ND-4.0", raw: "CC BY-NC-ND", allows: [] }, "provider", "toymakr3d");
    expect(toymakr.licenseAllows).toEqual([]);
    const out = licenseOut({ license: toymakr.license as Prisma.JsonValue });
    expect(out).toMatchObject({ id: "CC-BY-NC-ND-4.0", short: "CC BY-NC-ND 4.0", allows: [], family: "cc" });

    const credited = licenseData(
      {
        id: "myminifactory",
        raw: "x",
        label: "MyMiniFactory - Credit - Remix",
        allows: ["remix"],
        requires: { credit: true },
      },
      "provider",
      "myminifactory",
    );
    expect(licenseOut({ license: credited.license as Prisma.JsonValue })).toMatchObject({
      short: "MyMiniFactory - Credit - Remix",
      allows: ["remix"],
      requires: { credit: true, same_license: false },
    });

    // One Thingport doesn't know: shown by its label and terms, allowing nothing as far as the filter can tell.
    const unknown = licenseData(
      { id: null, raw: "x/terms.pdf", label: "My terms", terms: "Be nice." },
      "provider",
      "thangs",
    );
    expect(unknown.licenseAllows).toEqual([]);
    expect(licenseOut({ license: unknown.license as Prisma.JsonValue })).toMatchObject({
      id: null,
      short: "My terms",
      family: null,
      terms: "Be nice.",
    });
  });
});

describe("a model's licence", () => {
  it("is picked in Edit model, written to LICENSE.txt beside its files, and rewritten with the model", async () => {
    const printId = await upload(`Dragon ${stamp}`);
    let res = await request(app).get(`/api/print/${printId}`).set(auth());
    expect(res.body.license).toBeNull();
    expect(res.body.license_pending).toBe(false);
    expect(await licenseFiles(printId)).toHaveLength(0);

    // An upload has no source to take one from.
    expect((await request(app).post(`/api/print/${printId}/meta`).set(auth()).send({ license: "source" })).status).toBe(
      400,
    );
    expect((await request(app).post(`/api/print/${printId}/meta`).set(auth()).send({ license: "nope" })).status).toBe(
      400,
    );
    // Not a site's own licence either: those come from the site.
    expect((await request(app).post(`/api/print/${printId}/meta`).set(auth()).send({ license: "sdfl" })).status).toBe(
      400,
    );

    res = await request(app).post(`/api/print/${printId}/meta`).set(auth()).send({ license: "CC-BY-SA-4.0" });
    expect(res.status).toBe(200);
    expect(res.body.print.license).toMatchObject({
      id: "CC-BY-SA-4.0",
      source: "user",
      allows: ["share", "remix", "commercial"],
      requires: { credit: true, same_license: true },
    });
    const [file] = await licenseFiles(printId);
    expect(file.filename).toBe("LICENSE.txt");
    const plate = await prisma.plate.findFirstOrThrow({ where: { printId } });
    expect(path.dirname(file.storagePath)).toBe(path.dirname(plate.storagePath));
    expect(read(file.storagePath)).toContain("Licence: Creative Commons Attribution-ShareAlike 4.0 International");
    expect(read(file.storagePath)).toContain("from the licence the model's owner chose");
    // Not one of the model's own files.
    expect(res.body.print.supporting_file_count).toBe(0);

    await request(app)
      .post(`/api/print/${printId}/meta`)
      .set(auth())
      .send({ name: `Big Dragon ${stamp}`, creator: "Mara" });
    const [renamed] = await licenseFiles(printId);
    expect(read(renamed.storagePath)).toMatch(new RegExp(`^Big Dragon ${stamp}\nby Mara\n`));

    // Back to none: the file goes.
    res = await request(app).post(`/api/print/${printId}/meta`).set(auth()).send({ license: null });
    expect(res.body.print.license).toBeNull();
    expect(await licenseFiles(printId)).toHaveLength(0);
    expect(fs.existsSync(path.join(STORAGE, renamed.storagePath))).toBe(false);
  });

  it("isn't counted in the model's size", async () => {
    const printId = await upload(`Sized ${stamp}`);
    await request(app).post(`/api/print/${printId}/meta`).set(auth()).send({ license: "MIT" });
    expect(await licenseFiles(printId)).toHaveLength(1);
    const res = await request(app).get(`/api/print/${printId}`).set(auth());
    expect(res.body.total_size).toBe(Buffer.byteLength(STL));
  });

  it("lets the grid filter by what the licence allows", async () => {
    const open = await upload(`Open ${stamp}`);
    const closed = await upload(`Closed ${stamp}`);
    const none = await upload(`None ${stamp}`);
    await request(app).post(`/api/print/${open}/meta`).set(auth()).send({ license: "CC-BY-4.0" });
    await request(app).post(`/api/print/${closed}/meta`).set(auth()).send({ license: "all-rights-reserved" });
    const ids = async (query: Record<string, string>) => {
      const res = await request(app).get("/api/prints").query(query).set(auth());
      expect(res.status).toBe(200);
      return (res.body as { id: string }[]).map((p) => p.id).filter((id) => [open, closed, none].includes(id));
    };
    expect((await ids({})).toSorted()).toEqual([open, closed, none].toSorted());
    expect(await ids({ license_allows: "share" })).toEqual([open]);
    expect(await ids({ license_allows: "share,commercial,remix" })).toEqual([open]);
    expect((await ids({ licensed: "1" })).toSorted()).toEqual([open, closed].toSorted());
    // Unknown actions are dropped rather than refusing the list.
    expect((await ids({ license_allows: "fly" })).length).toBe(3);
  });

  it("goes into zips, generated, and shows in the storage browser as a licence", async () => {
    const printId = await upload(`Zipped ${stamp}`);
    await request(app).post(`/api/print/${printId}/meta`).set(auth()).send({ license: "CC0-1.0" });
    const zip = await request(app)
      .post("/api/download/zip")
      .set(auth())
      .send({ print_ids: [printId] })
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(zip.status).toBe(200);
    const tmp = path.join(os.tmpdir(), `licenses-${stamp}.zip`);
    fs.writeFileSync(tmp, zip.body as Buffer);
    try {
      const print = await prisma.print.findUniqueOrThrow({ where: { id: printId }, include: { category: true } });
      const prefix = `${print.category?.name || "unassigned"}/${print.name}`;
      const entry = await readZipEntry(tmp, `${prefix}/LICENSE.txt`, 100_000);
      expect(entry?.toString("utf8")).toContain("Creative Commons Zero 1.0 Universal");
      // Not twice: the file beside the model's own isn't added as a supporting file too.
      expect(await readZipEntry(tmp, `${prefix}/supporting/LICENSE.txt`, 100_000)).toBeNull();
    } finally {
      fs.rmSync(tmp, { force: true });
    }

    const [file] = await licenseFiles(printId);
    const folder = path.dirname(file.storagePath).split(path.sep).join("/");
    const browse = await request(app)
      .get("/api/admin/storage/browse")
      .query({ path: folder })
      .set({ Authorization: `Bearer ${adminToken}` });
    expect(browse.status).toBe(200);
    const listed = (browse.body.files as { name: string; kind: string }[]).find((f) => f.name === "LICENSE.txt");
    expect(listed?.kind).toBe("license");
  });

  it("is written or removed for every model when the admin setting changes", async () => {
    const printId = await upload(`Setting ${stamp}`);
    await request(app).post(`/api/print/${printId}/meta`).set(auth()).send({ license: "MIT" });
    const [file] = await licenseFiles(printId);
    const admin = { Authorization: `Bearer ${adminToken}` };
    const save = (enabled: boolean) => request(app).post("/api/settings/license-files").set(admin).send({ enabled });
    const written = async () => (await licenseFiles(printId)).length === 1;

    expect((await save(false)).body).toEqual({ enabled: false });
    await until(async () => !(await written()));
    expect(fs.existsSync(path.join(STORAGE, file.storagePath))).toBe(false);
    // Zips still carry it.
    const print = await prisma.print.findUniqueOrThrow({
      where: { id: printId },
      include: { plates: true, category: true },
    });
    const entry = (await buildZipEntries([print])).find((e) => e.arcname.endsWith("/LICENSE.txt"));
    expect(entry && "content" in entry ? entry.content.toString("utf8") : "").toContain("MIT License");

    expect((await save(true)).body).toEqual({ enabled: true });
    await until(written);

    // Off, with the backend stopped before its sweep: saving it off again finishes the job.
    await setLicenseFiles(false);
    expect(await written()).toBe(true);
    await save(false);
    await until(async () => !(await written()));
    await save(true);
    await until(written);

    expect((await request(app).post("/api/settings/license-files").set(auth()).send({ enabled: false })).status).toBe(
      403,
    );
  });
});

describe("an older import's licence", () => {
  it("is read when its owner opens it, and never replaces one the owner picked", async () => {
    const printId = await upload(`Imported ${stamp}`);
    const externalId = `lic-${stamp}`;
    await prisma.print.update({
      where: { id: printId },
      data: { sourceProvider: "makerables", sourceExternalId: externalId, licenseReadAt: null, license: Prisma.DbNull },
    });
    // Makerables has no reader of its own: its details are read, as for most providers.
    const reader = vi.spyOn(PROVIDERS.makerables.details, "read").mockResolvedValue({
      ...emptyImportedPageMetadata(),
      license: { id: "CC-BY-SA-4.0", raw: "cc_by_sa" },
    });
    try {
      let res = await request(app).get(`/api/print/${printId}`).set(auth());
      expect(res.body.license_pending).toBe(true);
      res = await request(app).post(`/api/print/${printId}/license/fill`).set(auth());
      expect(res.status).toBe(200);
      let state = res.body;
      for (let i = 0; i < 50 && (state.pending || state.filling); i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        state = (await request(app).get(`/api/print/${printId}/license`).set(auth())).body;
      }
      expect(state.license).toMatchObject({ id: "CC-BY-SA-4.0", source: "provider", provider: "makerables" });
      expect(reader).toHaveBeenCalledWith(userId, externalId);
      expect(await licenseFiles(printId)).toHaveLength(1);
      const [file] = await licenseFiles(printId);
      expect(read(file.storagePath)).toContain("from what Makerables lists for this model");

      // The owner's pick stands, whatever the source lists.
      await request(app).post(`/api/print/${printId}/meta`).set(auth()).send({ license: "all-rights-reserved" });
      const print = await prisma.print.findUniqueOrThrow({ where: { id: printId } });
      expect(licensePending(print)).toBe(false);

      // "As the source lists it" reads it again.
      res = await request(app).post(`/api/print/${printId}/meta`).set(auth()).send({ license: "source" });
      expect(res.status).toBe(200);
      for (let i = 0; i < 50; i++) {
        const now = await prisma.print.findUniqueOrThrow({ where: { id: printId } });
        if (now.licenseReadAt) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const reread = await request(app).get(`/api/print/${printId}`).set(auth());
      expect(reread.body.license).toMatchObject({ id: "CC-BY-SA-4.0", source: "provider" });
    } finally {
      reader.mockRestore();
    }
  });

  it("is asked of the source again only after a day when it couldn't be read", async () => {
    const printId = await upload(`Unreadable ${stamp}`);
    await prisma.print.update({
      where: { id: printId },
      data: { sourceProvider: "makerables", sourceExternalId: `gone-${stamp}`, licenseReadAt: null },
    });
    const reader = vi.spyOn(PROVIDERS.makerables.details, "read").mockRejectedValue(new Error("site down"));
    try {
      await request(app).post(`/api/print/${printId}/license/fill`).set(auth());
      for (let i = 0; i < 50; i++) {
        const state = (await request(app).get(`/api/print/${printId}/license`).set(auth())).body;
        if (!state.filling) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const state = (await request(app).get(`/api/print/${printId}/license`).set(auth())).body;
      // Failed, not stated: its page says so and offers to try again.
      expect(state).toMatchObject({ license: null, pending: false, failed: true });
      expect((await request(app).get(`/api/print/${printId}`).set(auth())).body.license_failed).toBe(true);
      const print = await prisma.print.findUniqueOrThrow({ where: { id: printId } });
      expect(licensePending(print, Date.now() + 25 * 60 * 60 * 1000)).toBe(true);
    } finally {
      reader.mockRestore();
    }
  });

  it("isn't asked of a site an admin turned off, and is read on its owner's retry once it's back on", async () => {
    const printId = await upload(`Off ${stamp}`);
    await prisma.print.update({
      where: { id: printId },
      data: { sourceProvider: "makerables", sourceExternalId: `off-${stamp}`, licenseReadAt: null },
    });
    const reader = vi.spyOn(PROVIDERS.makerables.details, "read").mockResolvedValue({
      ...emptyImportedPageMetadata(),
      license: { id: "CC-BY-4.0", raw: "cc_by" },
    });
    await setProviderEnabled("makerables", false);
    try {
      await request(app).post(`/api/print/${printId}/license/fill`).set(auth());
      expect(await settled(printId)).toMatchObject({ license: null, pending: false, failed: true });
      expect(reader).not.toHaveBeenCalled();

      await setProviderEnabled("makerables", true);
      // Asked again without retry, it waits as after any failed read.
      await request(app).post(`/api/print/${printId}/license/fill`).set(auth());
      expect(await settled(printId)).toMatchObject({ license: null, failed: true });
      expect(reader).not.toHaveBeenCalled();

      const res = await request(app).post(`/api/print/${printId}/license/fill`).set(auth()).send({ retry: true });
      expect(res.status).toBe(200);
      expect(res.body.failed).toBe(false);
      expect(await settled(printId)).toMatchObject({ license: { id: "CC-BY-4.0" }, failed: false });
    } finally {
      await setProviderEnabled("makerables", true);
      reader.mockRestore();
    }
  });

  it("counts a read that broke before it could say anything as failed", async () => {
    const printId = await upload(`Broken ${stamp}`);
    await prisma.print.update({
      where: { id: printId },
      data: { sourceProvider: "makerables", sourceExternalId: `broken-${stamp}`, licenseReadAt: null },
    });
    // Breaks outside the read itself, as a database error would.
    const providers = await import("../src/services/providerSettingsService");
    const enabled = vi.spyOn(providers, "isProviderEnabled").mockRejectedValueOnce(new Error("database gone"));
    try {
      startLicenseFill(printId);
      expect(await settled(printId)).toMatchObject({ license: null, pending: false, failed: true });
    } finally {
      enabled.mockRestore();
    }
  });

  it("is shown on another user's shared model, but read only by its owner", async () => {
    const printId = await upload(`Theirs ${stamp}`);
    await prisma.print.update({
      where: { id: printId },
      data: { sourceProvider: "makerables", sourceExternalId: `theirs-${stamp}`, licenseReadAt: null },
    });
    const social = await getSocialSettings();
    await setSocialSettings({ enabled: true });
    try {
      const collection = await request(app)
        .post("/api/collections")
        .set(auth())
        .send({ name: `Shared licences ${stamp}`, is_public: true });
      await request(app).post(`/api/collection/${collection.body.id}/items/${printId}`).set(auth());
      const other = await request(app)
        .post("/api/register")
        .send({ displayName: "Other", email: `licenses-other-${stamp}@example.com`, password: "password123" });
      const theirs = { Authorization: `Bearer ${other.body.token}` };
      const reader = vi.spyOn(PROVIDERS.makerables.details, "read");
      const state = await request(app).get(`/api/print/${printId}/license`).set(theirs);
      expect(state.status).toBe(200);
      // Only shown: nothing is read for them.
      expect(state.body).toMatchObject({ license: null, pending: true, filling: false });
      expect(reader).not.toHaveBeenCalled();
      reader.mockRestore();
      expect((await request(app).post(`/api/print/${printId}/license/fill`).set(theirs)).status).toBe(404);
    } finally {
      await setSocialSettings(social);
    }
  });

  it("keeps the owner's pick made while the source was being read", async () => {
    const printId = await upload(`Picked meanwhile ${stamp}`);
    await prisma.print.update({
      where: { id: printId },
      data: { sourceProvider: "makerables", sourceExternalId: `meanwhile-${stamp}`, licenseReadAt: null },
    });
    let answer!: (value: Awaited<ReturnType<typeof PROVIDERS.makerables.details.read>>) => void;
    const reader = vi
      .spyOn(PROVIDERS.makerables.details, "read")
      .mockReturnValue(new Promise((resolve) => (answer = resolve)));
    try {
      await request(app).post(`/api/print/${printId}/license/fill`).set(auth());
      await until(async () => reader.mock.calls.length > 0);
      await request(app).post(`/api/print/${printId}/meta`).set(auth()).send({ license: "all-rights-reserved" });
      answer({ ...emptyImportedPageMetadata(), license: { id: "CC-BY-4.0", raw: "cc_by" } });
      expect((await settled(printId)).license).toMatchObject({ id: "all-rights-reserved", source: "user" });
    } finally {
      reader.mockRestore();
    }
  });

  it("gives up on a read that never ends, so the next model's isn't held up", async () => {
    const hung = await upload(`Hung ${stamp}`);
    const next = await upload(`After hung ${stamp}`);
    for (const [id, externalId] of [
      [hung, `hung-${stamp}`],
      [next, `after-hung-${stamp}`],
    ]) {
      await prisma.print.update({
        where: { id },
        data: { sourceProvider: "makerables", sourceExternalId: externalId, licenseReadAt: null },
      });
    }
    let answerLate!: (value: Awaited<ReturnType<typeof PROVIDERS.makerables.details.read>>) => void;
    const reader = vi
      .spyOn(PROVIDERS.makerables.details, "read")
      .mockReturnValueOnce(new Promise((resolve) => (answerLate = resolve)))
      .mockResolvedValue({ ...emptyImportedPageMetadata(), license: { id: "CC-BY-4.0", raw: "cc_by" } });
    try {
      await request(app).post(`/api/print/${hung}/license/fill`).set(auth());
      await request(app).post(`/api/print/${next}/license/fill`).set(auth());
      expect(await settled(next)).toMatchObject({ license: { id: "CC-BY-4.0" } });
      // Failed, so its page offers to try again.
      expect(await settled(hung)).toMatchObject({ license: null, failed: true });

      // Its answer, when it comes after all, is dropped: it stays failed, not "not stated".
      answerLate({ ...emptyImportedPageMetadata(), license: null });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect((await prisma.print.findUniqueOrThrow({ where: { id: hung } })).licenseReadAt).toBeNull();
      expect(await settled(hung)).toMatchObject({ license: null, failed: true });
    } finally {
      reader.mockRestore();
    }
  });

  it("is read again after a read that was running when its owner asked to retry", async () => {
    const printId = await upload(`Retried meanwhile ${stamp}`);
    await prisma.print.update({
      where: { id: printId },
      data: { sourceProvider: "makerables", sourceExternalId: `retried-${stamp}`, licenseReadAt: null },
    });
    let fail!: (err: Error) => void;
    const reader = vi
      .spyOn(PROVIDERS.makerables.details, "read")
      .mockReturnValueOnce(new Promise((_, reject) => (fail = reject)))
      .mockResolvedValue({ ...emptyImportedPageMetadata(), license: { id: "CC-BY-4.0", raw: "cc_by" } });
    try {
      await request(app).post(`/api/print/${printId}/license/fill`).set(auth());
      await until(async () => reader.mock.calls.length > 0);
      const retry = await request(app).post(`/api/print/${printId}/license/fill`).set(auth()).send({ retry: true });
      expect(retry.body.filling).toBe(true);
      fail(new Error("site down"));
      expect(await settled(printId)).toMatchObject({ license: { id: "CC-BY-4.0" }, failed: false });
      expect(reader).toHaveBeenCalledTimes(2);
    } finally {
      reader.mockRestore();
    }
  });
});

describe("LICENSE.txt", () => {
  it("names the model, its source and what the licence allows, and keeps one per model", async () => {
    const printId = await upload(`Text ${stamp}`);
    await prisma.print.update({
      where: { id: printId },
      data: {
        title: "Articulated Dragon",
        creator: "Mara Voss",
        sourceProvider: "makerworld",
        sourceExternalId: "123456",
        ...licenseData(
          { id: "CC-BY-NC-SA-4.0", raw: "BY-NC-SA", terms: "Please don't sell prints." },
          "provider",
          "makerworld",
        ),
      },
    });
    await syncLicenseFile(printId);
    // A second sync of the same licence changes nothing and adds no second file.
    await syncLicenseFile(printId);
    const files = await licenseFiles(printId);
    expect(files).toHaveLength(1);
    const text = read(files[0].storagePath);
    expect(text).toContain("Articulated Dragon\nby Mara Voss\nSource: https://makerworld.com/");
    expect(text).toContain("https://creativecommons.org/licenses/by-nc-sa/4.0/");
    expect(text).toContain("You may: share the files as they are and change it.");
    expect(text).toContain("You must: credit the creator and link the source and share what you make from it");
    expect(text).toContain("You may not: use it commercially, selling prints included.");
    expect(text).toContain("MakerWorld adds:\nPlease don't sell prints.");
    expect(text).toContain('Credit line:\n"Articulated Dragon" by Mara Voss (https://makerworld.com/');
  });

  it("names the model's author when it has no creator, as its page does, in the folder and in zips", async () => {
    const printId = await upload(`Authored ${stamp}`);
    const author = await prisma.author.create({
      data: { id: `lic-author-${stamp}`, provider: "makerworld", externalId: `a-${stamp}`, name: "Mara Voss" },
    });
    await prisma.print.update({
      where: { id: printId },
      data: { authorId: author.id, creator: null, ...licenseData({ id: "CC-BY-4.0", raw: "BY" }, "user", null) },
    });
    await syncLicenseFile(printId);
    const [file] = await licenseFiles(printId);
    expect(read(file.storagePath)).toContain("\nby Mara Voss\n");
    expect(read(file.storagePath)).toContain(`" by Mara Voss`);
    const print = await prisma.print.findUniqueOrThrow({
      where: { id: printId },
      include: { plates: true, category: true },
    });
    const entry = (await buildZipEntries([print])).find((e) => e.arcname.endsWith("/LICENSE.txt"));
    expect(entry && "content" in entry ? entry.content.toString("utf8") : "").toContain("\nby Mara Voss\n");
  });

  it("forgets the creator and source when its owner resets the author", async () => {
    const printId = await upload(`Reset ${stamp}`);
    await prisma.print.update({
      where: { id: printId },
      data: {
        creator: "Mara Voss",
        sourceProvider: "makerworld",
        sourceExternalId: `reset-${stamp}`,
        ...licenseData({ id: "CC-BY-4.0", raw: "BY" }, "provider", "makerworld"),
      },
    });
    await syncLicenseFile(printId);
    expect(read((await licenseFiles(printId))[0].storagePath)).toContain("Mara Voss");
    expect((await request(app).post(`/api/print/${printId}/author-reset`).set(auth())).status).toBe(200);
    const text = read((await licenseFiles(printId))[0].storagePath);
    expect(text).not.toContain("Mara Voss");
    expect(text).not.toContain("Source:");
  });

  it("brings its row back in line when the file already says the right thing", async () => {
    const printId = await upload(`Repaired ${stamp}`);
    await request(app).post(`/api/print/${printId}/meta`).set(auth()).send({ license: "MIT" });
    const [file] = await licenseFiles(printId);
    // As a write whose row update failed leaves it.
    await prisma.printFile.update({ where: { id: file.id }, data: { size: 1, contentSha256: "0".repeat(64) } });
    await syncLicenseFile(printId);
    const [row] = await licenseFiles(printId);
    expect(row.size).toBe(fs.statSync(path.join(STORAGE, row.storagePath)).size);
    expect(row.contentSha256).toBeNull();
  });

  it("keeps the row of a file it couldn't remove, for the next sync", async () => {
    const printId = await upload(`Stuck ${stamp}`);
    await request(app).post(`/api/print/${printId}/meta`).set(auth()).send({ license: "MIT" });
    await prisma.print.update({ where: { id: printId }, data: { license: Prisma.DbNull, licenseAllows: [] } });
    const fsp = (await import("node:fs/promises")).default;
    const realRm = fsp.rm.bind(fsp);
    // Only LICENSE.txt's removal fails, whatever else runs meanwhile.
    const rm = vi
      .spyOn(fsp, "rm")
      .mockImplementation((target, options) =>
        String(target).endsWith("LICENSE.txt")
          ? Promise.reject(Object.assign(new Error("busy"), { code: "EBUSY" }))
          : realRm(target, options),
      );
    try {
      await expect(syncLicenseFile(printId)).rejects.toThrow("busy");
    } finally {
      rm.mockRestore();
    }
    expect(await licenseFiles(printId)).toHaveLength(1);
    await syncLicenseFile(printId);
    expect(await licenseFiles(printId)).toHaveLength(0);
  });

  it("says when its row couldn't be removed, and removes it on the next sync", async () => {
    const printId = await upload(`Row stuck ${stamp}`);
    await request(app).post(`/api/print/${printId}/meta`).set(auth()).send({ license: "MIT" });
    await prisma.print.update({ where: { id: printId }, data: { license: Prisma.DbNull, licenseAllows: [] } });
    const remove = vi.spyOn(prisma.printFile, "deleteMany").mockRejectedValueOnce(new Error("database gone"));
    try {
      await expect(syncLicenseFile(printId)).rejects.toThrow("database gone");
    } finally {
      remove.mockRestore();
    }
    expect(await licenseFiles(printId)).toHaveLength(1);
    await syncLicenseFile(printId);
    expect(await licenseFiles(printId)).toHaveLength(0);
  });

  it("keeps the one at LICENSE.txt when a merge brings another along beside it", async () => {
    const printId = await upload(`Merged ${stamp}`);
    await request(app).post(`/api/print/${printId}/meta`).set(auth()).send({ license: "MIT" });
    const [canonical] = await licenseFiles(printId);
    const renamed = path.join(path.dirname(canonical.storagePath), "LICENSE (2).txt");
    fs.writeFileSync(path.join(STORAGE, renamed), "another model's licence");
    // Older than the model's own, as a merged model's from before it can be.
    await prisma.printFile.create({
      data: {
        printId,
        role: "LICENSE",
        filename: "LICENSE.txt",
        mime: "text/plain",
        size: 24,
        storagePath: renamed,
        createdAt: new Date(0),
      },
    });
    await syncLicenseFile(printId);
    const files = await licenseFiles(printId);
    expect(files.map((f) => f.id)).toEqual([canonical.id]);
    expect(fs.existsSync(path.join(STORAGE, renamed))).toBe(false);
  });

  it("goes back to LICENSE.txt once another file there is gone", async () => {
    const printId = await upload(`Aside ${stamp}`);
    const plate = await prisma.plate.findFirstOrThrow({ where: { printId } });
    const canonical = path.join(path.dirname(plate.storagePath), "LICENSE.txt");
    // Someone's own LICENSE.txt, saved as a supporting file first.
    fs.mkdirSync(path.dirname(path.join(STORAGE, canonical)), { recursive: true });
    fs.writeFileSync(path.join(STORAGE, canonical), "their own");
    const theirs = await prisma.printFile.create({
      data: {
        printId,
        role: "SUPPORTING",
        filename: "LICENSE.txt",
        mime: "text/plain",
        size: 9,
        storagePath: canonical,
      },
    });
    await request(app).post(`/api/print/${printId}/meta`).set(auth()).send({ license: "MIT" });
    const [aside] = await licenseFiles(printId);
    expect(path.basename(aside.storagePath)).toBe("LICENSE (2).txt");

    await prisma.printFile.delete({ where: { id: theirs.id } });
    fs.rmSync(path.join(STORAGE, canonical));
    await syncLicenseFile(printId);
    const [back] = await licenseFiles(printId);
    expect(back.id).toBe(aside.id);
    expect(back.storagePath).toBe(canonical);
    expect(read(canonical)).toContain("MIT License");
    expect(fs.existsSync(path.join(STORAGE, aside.storagePath))).toBe(false);
  });

  it("follows its author's new name, on everyone's models", async () => {
    const printId = await upload(`Renamed author ${stamp}`);
    const externalId = `renamed-${stamp}`;
    const info = {
      provider: "makerworld",
      externalId,
      name: "Mara",
      handle: null,
      bio: null,
      bioTranslated: null,
      links: [],
      avatarUrl: null,
      backgroundUrl: null,
    };
    const author = (await upsertAuthorFromImport(info))!;
    await prisma.print.update({
      where: { id: printId },
      data: { authorId: author.id, ...licenseData({ id: "CC-BY-4.0", raw: "BY" }, "user", null) },
    });
    await syncLicenseFile(printId);
    expect(read((await licenseFiles(printId))[0].storagePath)).toContain("\nby Mara\n");

    // Rewritten by the time the import goes on.
    await upsertAuthorFromImport({ ...info, name: "Mara Voss" });
    expect(read((await licenseFiles(printId))[0].storagePath)).toContain("\nby Mara Voss\n");
  });
});
