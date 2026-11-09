import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
import { licenseData, licenseOut, licensePending } from "../src/services/licenseService";
import { licenseFileText, syncAllLicenseFiles, syncLicenseFile } from "../src/services/licenseFile";
import { getLicenseFiles, setLicenseFiles } from "../src/services/settingsService";
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
    expect(await licenseFiles(printId)).toHaveLength(1);

    await setLicenseFiles(false);
    await syncAllLicenseFiles();
    expect(await licenseFiles(printId)).toHaveLength(0);
    // Zips still carry it.
    const print = await prisma.print.findUniqueOrThrow({ where: { id: printId } });
    expect(licenseFileText(print)).toContain("MIT License");

    await setLicenseFiles(true);
    await syncAllLicenseFiles();
    expect(await licenseFiles(printId)).toHaveLength(1);

    const off = await request(app)
      .post("/api/settings/license-files")
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ enabled: true });
    expect(off.body).toEqual({ enabled: true });
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
      expect(state).toMatchObject({ license: null, pending: false });
      const print = await prisma.print.findUniqueOrThrow({ where: { id: printId } });
      expect(licensePending(print, Date.now() + 25 * 60 * 60 * 1000)).toBe(true);
    } finally {
      reader.mockRestore();
    }
  });

  it("isn't read for another user's shared model", async () => {
    const printId = await upload(`Theirs ${stamp}`);
    const other = await request(app)
      .post("/api/register")
      .send({ displayName: "Other", email: `licenses-other-${stamp}@example.com`, password: "password123" });
    const res = await request(app)
      .post(`/api/print/${printId}/license/fill`)
      .set({ Authorization: `Bearer ${other.body.token}` });
    expect(res.status).toBe(404);
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
});
