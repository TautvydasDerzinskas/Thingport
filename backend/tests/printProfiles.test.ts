import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { PROVIDERS } from "../src/providers/registry";
import { addPlatesToPrint, createPrint, resolvePlateFilePath } from "../src/services/printCreation";
import { profileFillRunning, startProfileFill } from "../src/services/printProfileService";
import { setSocialSettings } from "../src/services/settingsService";
import type { ProviderProfileFactsById } from "../src/services/printProfileFacts";
import { register, tempFile } from "./helpers/fileReuse";
import { PLATE_PNG, profileProject } from "./helpers/profileProject";

const app = createApp();
const stamp = Date.now();
let dir: string;
let owner: { id: string; token: string };
let stranger: { id: string; token: string };

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// What MakerWorld would say of the profile: its name and maker, its own slice's totals, both plates.
const SITE_FACTS: ProviderProfileFactsById = {
  "111": {
    title: "0.16mm, multi-colour",
    origin: "designer",
    creator: "Maker",
    seconds: 9000,
    grams: 40,
    filaments: [{ type: "PLA", color: "#FFFFFF", grams: 40 }],
    plates: [
      { index: 1, name: "Body", seconds: 3700, grams: 13 },
      { index: 2, name: "Base", seconds: 5300, grams: 27, filaments: [{ type: "PLA", color: "#FF0000", grams: 27 }] },
    ],
    printer: "Bambu Lab A1 mini",
    layerMm: 0.2,
  },
};

async function profileModel(label: string, sliced: "none" | "first" | "all" | "times" | "incomplete") {
  const project = await profileProject(dir, `${label}.3mf`, sliced);
  const stl = tempFile(dir, "solid raw\nendsolid\n");
  const { print, plates } = await createPrint(
    owner.id,
    { title: `${label} ${stamp}`, sourceProvider: "makerworld", sourceExternalId: `${label}-${stamp}` },
    `${label} ${stamp}`,
    [
      { filename: `${label}.3mf`, tempFilePath: project, sourceInstanceId: "111" },
      { filename: "raw.stl", tempFilePath: stl },
    ],
    { describe: false, classify: false },
  );
  return {
    print,
    profilePlate: plates.find((plate) => plate.sourceInstanceId)!,
    rawPlate: plates.find((p) => !p.sourceInstanceId)!,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for the model's fills to finish, and answers its profiles. */
async function settled(printId: string) {
  for (let i = 0; i < 50; i++) {
    const res = await request(app).get(`/api/print/${printId}/profiles`).set(auth(owner.token));
    if (!res.body.filling) return res.body;
    await sleep(100);
  }
  throw new Error("the fill never finished");
}

/** Starts a fill and waits for it to finish. */
async function fill(printId: string) {
  const started = await request(app).post(`/api/print/${printId}/profiles/fill`).set(auth(owner.token));
  expect(started.status).toBe(200);
  return settled(printId);
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "print-profiles-"));
  owner = await register(app, "profiles", "Owner");
  stranger = await register(app, "profiles", "Stranger");
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("a model imported with print profiles", () => {
  it("marks which files are profiles, and that an older import's still need reading", async () => {
    const { print, profilePlate, rawPlate } = await profileModel("older", "none");
    const res = await request(app).get(`/api/print/${print.id}`).set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.profiles_pending).toBe(true);
    const plates = Object.fromEntries(res.body.plates.map((plate: { id: string }) => [plate.id, plate]));
    expect(plates[profilePlate.id]).toMatchObject({ profile_id: "111", profile: { title: null, seconds: null } });
    // A file that isn't a profile says so, and has no profile to show.
    expect(plates[rawPlate.id]).toMatchObject({ profile_id: null, profile: null });
  });

  it("reads the 3MF and the provider, the 3MF winning on what it knows exactly", async () => {
    const read = vi.spyOn(PROVIDERS.makerworld, "profileFacts").mockResolvedValue(SITE_FACTS);
    const { print, profilePlate } = await profileModel("merged", "first");
    const body = await fill(print.id);
    expect(read).toHaveBeenCalledWith(owner.id, `merged-${stamp}`, ["111"]);
    expect(body.pending).toBe(false);
    const profile = body.profiles[profilePlate.id];
    expect(profile).toMatchObject({
      title: "0.16mm, multi-colour",
      origin: "designer",
      creator: "Maker",
      // The file names its printer and settings exactly.
      printer: "Bambu Lab X1 Carbon",
      nozzle_mm: 0.4,
      layer_mm: 0.16,
      infill: "20%",
      walls: 3,
      supports: true,
      // Sliced in part, it leaves the totals to the site's own slice.
      seconds: 9000,
      grams: 40,
    });
    expect(profile.plates).toEqual([
      {
        index: 1,
        name: "Body & lid",
        seconds: 3600,
        grams: 12.5,
        filaments: [
          { type: "PLA", color: "#FFFFFF", grams: 10.25 },
          { type: "PETG", color: "#000000", grams: 2.25 },
        ],
        objects: 2,
        thumb_url: expect.stringMatching(new RegExp(`^/plate/${profilePlate.id}/profile-plate/1\\.png\\?v=\\d+$`)),
      },
      {
        index: 2,
        name: "Base",
        seconds: 5300,
        grams: 27,
        filaments: [{ type: "PLA", color: "#FF0000", grams: 27 }],
        objects: 1,
        thumb_url: expect.stringMatching(/\/profile-plate\/2\.png\?v=\d+$/),
      },
    ]);
    // Read once: opening it again asks nobody.
    expect((await request(app).get(`/api/print/${print.id}`).set(auth(owner.token))).body.profiles_pending).toBe(false);
  });

  it("takes a project sliced whole at its word for the totals", async () => {
    vi.spyOn(PROVIDERS.makerworld, "profileFacts").mockResolvedValue(SITE_FACTS);
    const { print, profilePlate } = await profileModel("whole", "all");
    const profile = (await fill(print.id)).profiles[profilePlate.id];
    expect(profile).toMatchObject({ seconds: 5400, grams: 17.5 });
    expect(profile.filaments).toEqual([
      { type: "PLA", color: "#FFFFFF", grams: 15.25 },
      { type: "PETG", color: "#000000", grams: 2.25 },
    ]);
  });

  it("remembers a provider that had no answer, rather than asking on every visit", async () => {
    const read = vi.spyOn(PROVIDERS.makerworld, "profileFacts").mockRejectedValue(new Error("offline"));
    const { print, profilePlate } = await profileModel("offline", "none");
    const body = await fill(print.id);
    expect(read).toHaveBeenCalledTimes(1);
    expect(body.pending).toBe(false);
    // The file's facts are kept all the same.
    expect(body.profiles[profilePlate.id]).toMatchObject({ title: null, printer: "Bambu Lab X1 Carbon" });
    await request(app).post(`/api/print/${print.id}/profiles/fill`).set(auth(owner.token));
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("is read only by its owner, and not shown to anyone else", async () => {
    const { print } = await profileModel("private", "none");
    expect((await request(app).post(`/api/print/${print.id}/profiles/fill`).set(auth(stranger.token))).status).toBe(
      404,
    );
    expect((await request(app).get(`/api/print/${print.id}/profiles`).set(auth(stranger.token))).status).toBe(404);
  });

  it("serves each plate's picture out of the 3MF", async () => {
    const { profilePlate, rawPlate } = await profileModel("pictures", "none");
    const res = await request(app)
      .get(`/api/plate/${profilePlate.id}/profile-plate/1.png?v=1`)
      .set(auth(owner.token))
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(res.body as Buffer, PLATE_PNG)).toBe(0);
    expect(
      (await request(app).get(`/api/plate/${profilePlate.id}/profile-plate/3.png`).set(auth(owner.token))).status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/plate/${rawPlate.id}/profile-plate/1.png`).set(auth(owner.token))).status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/plate/${profilePlate.id}/profile-plate/1.png`).set(auth(stranger.token))).status,
    ).toBe(404);
  });

  it("falls back to the provider for each total the 3MF hasn't got", async () => {
    vi.spyOn(PROVIDERS.makerworld, "profileFacts").mockResolvedValue(SITE_FACTS);
    const { print, profilePlate } = await profileModel("times", "times");
    const profile = (await fill(print.id)).profiles[profilePlate.id];
    // Every plate has its time in the file, but no weight or filament: those are the site's.
    expect(profile).toMatchObject({ seconds: 5400, grams: 40 });
    expect(profile.filaments).toEqual([{ type: "PLA", color: "#FFFFFF", grams: 40 }]);
  });

  it("reads the file again once it has changed on disk", async () => {
    vi.spyOn(PROVIDERS.makerworld, "profileFacts").mockResolvedValue(SITE_FACTS);
    const { print, profilePlate } = await profileModel("edited", "none");
    expect((await fill(print.id)).profiles[profilePlate.id].printer).toBe("Bambu Lab X1 Carbon");
    // Edited outside Thingport: another printer, and a newer modification time.
    const edited = await profileProject(dir, "edited-again.3mf", "none", { printer: "Bambu Lab H2D" });
    const target = resolvePlateFilePath(profilePlate)!;
    await fs.copyFile(edited, target);
    const later = new Date(Date.now() + 60_000);
    await fs.utimes(target, later, later);
    expect((await request(app).get(`/api/print/${print.id}`).set(auth(owner.token))).body.profiles_pending).toBe(true);
    expect((await fill(print.id)).profiles[profilePlate.id].printer).toBe("Bambu Lab H2D");
  });

  it("tries a file again that the disk failed to read", async () => {
    vi.spyOn(PROVIDERS.makerworld, "profileFacts").mockResolvedValue(SITE_FACTS);
    const { print, profilePlate } = await profileModel("unreadable", "none");
    const target = resolvePlateFilePath(profilePlate)!;
    // The first time the profile's file is opened, the disk fails it.
    const realOpen = fsSync.open;
    let failed = false;
    vi.spyOn(fsSync, "open").mockImplementation(((file: fsSync.PathLike, ...rest: unknown[]) => {
      if (!failed && String(file) === target) {
        failed = true;
        const done = rest.at(-1) as (err: NodeJS.ErrnoException) => void;
        done(Object.assign(new Error(`EIO: i/o error, open '${target}'`), { code: "EIO" }));
        return;
      }
      return (realOpen as (...args: unknown[]) => void)(file, ...rest);
    }) as typeof fsSync.open);
    const body = await fill(print.id);
    expect(failed).toBe(true);
    expect(body.profiles[profilePlate.id].printer).toBe("Bambu Lab A1 mini");
    expect(body.pending).toBe(true);
    expect((await fill(print.id)).profiles[profilePlate.id].printer).toBe("Bambu Lab X1 Carbon");
  });

  it("uses the provider's filaments when the file's list has one without a weight", async () => {
    vi.spyOn(PROVIDERS.makerworld, "profileFacts").mockResolvedValue(SITE_FACTS);
    const { print, profilePlate } = await profileModel("incomplete", "incomplete");
    const profile = (await fill(print.id)).profiles[profilePlate.id];
    // The file's times and weights are whole, so they stand; its filament list isn't.
    expect(profile).toMatchObject({ seconds: 5400, grams: 17.5 });
    expect(profile.filaments).toEqual([{ type: "PLA", color: "#FFFFFF", grams: 40 }]);
    // Per plate, a whole list stands; the other keeps what it has, as the site gives that plate none.
    expect(profile.plates[0].filaments).toEqual([{ type: "PLA", color: "#FFFFFF", grams: 10.25 }]);
    expect(profile.plates[1].filaments).toEqual([{ type: "PLA", color: "#FFFFFF", grams: 5 }]);
  });

  it("keeps what a provider could read in part, and asks it again later", async () => {
    const read = vi
      .spyOn(PROVIDERS.makerworld, "profileFacts")
      .mockResolvedValue({ "111": { title: "Half read", seconds: 600, partial: true } });
    const { print, profilePlate } = await profileModel("partial", "none");
    const body = await fill(print.id);
    expect(body.profiles[profilePlate.id]).toMatchObject({ title: "Half read", seconds: 600 });
    // Not again straight away: a day later.
    expect(body.pending).toBe(false);
    const row = await prisma.plate.findUniqueOrThrow({ where: { id: profilePlate.id } });
    expect(row.profile).toMatchObject({ provider: { title: "Half read" }, providerTriedAt: expect.any(String) });
    expect(row.profile).not.toHaveProperty("providerVersion");
    expect(read).toHaveBeenCalledTimes(1);

    // A day later it's asked again, and a whole answer is kept for good.
    const stored = row.profile as Record<string, unknown>;
    const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await prisma.plate.update({
      where: { id: profilePlate.id },
      data: { profile: { ...stored, providerTriedAt: dayAgo } },
    });
    read.mockResolvedValue({ "111": { title: "Whole", seconds: 900 } });
    const later = await fill(print.id);
    expect(read).toHaveBeenCalledTimes(2);
    expect(later.profiles[profilePlate.id]).toMatchObject({ title: "Whole", seconds: 900 });
    const after = await prisma.plate.findUniqueOrThrow({ where: { id: profilePlate.id } });
    expect(after.profile).toMatchObject({ providerVersion: 1, providerTriedAt: null });
  });

  it("reads a profile added while a fill was running, in another pass", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const read = vi.spyOn(PROVIDERS.makerworld, "profileFacts").mockImplementation(async (_user, _model, ids) => {
      await gate;
      return Object.fromEntries(ids.map((id) => [id, { title: `Profile ${id}` }]));
    });
    const { print, profilePlate } = await profileModel("during", "none");
    startProfileFill(print.id);
    while (!read.mock.calls.length) await sleep(10);
    // The fill has read the model and waits on the provider; another profile arrives meanwhile.
    const project = await profileProject(dir, "during-second.3mf", "none");
    await addPlatesToPrint(owner.id, print.id, [
      { filename: "second.3mf", tempFilePath: project, sourceInstanceId: "222" },
    ]);
    startProfileFill(print.id);
    release();
    const body = await settled(print.id);
    const second = (await prisma.plate.findFirstOrThrow({ where: { printId: print.id, sourceInstanceId: "222" } })).id;
    expect(body.profiles[profilePlate.id].title).toBe("Profile 111");
    expect(body.profiles[second].title).toBe("Profile 222");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("never says a fill is done with what it read before the fill finished", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(PROVIDERS.makerworld, "profileFacts").mockImplementation(async () => {
      await gate;
      return SITE_FACTS;
    });
    const { print, profilePlate } = await profileModel("racing", "first");
    const started = await request(app).post(`/api/print/${print.id}/profiles/fill`).set(auth(owner.token));
    expect(started.body.filling).toBe(true);
    // The model page asks how it's going while the fill waits on the site: its plates are read, and only then does the
    // fill finish, before the answer is made from them. Its file was read by then, but nothing is stored yet.
    const findMany = prisma.plate.findMany.bind(prisma.plate);
    vi.spyOn(prisma.plate, "findMany").mockImplementation((async (args: Parameters<typeof findMany>[0]) => {
      const rows = await findMany(args);
      if (args?.where?.printId === print.id) {
        release();
        while (profileFillRunning(print.id)) await sleep(10);
      }
      return rows;
    }) as unknown as typeof prisma.plate.findMany);
    const res = await request(app).get(`/api/print/${print.id}/profiles`).set(auth(owner.token));
    // What it read is from before the fill finished: it says the fill is still going, so the page asks again.
    expect(res.body.profiles[profilePlate.id].title).toBeNull();
    expect(res.body.filling).toBe(true);
    vi.mocked(prisma.plate.findMany).mockRestore();
    expect((await settled(print.id)).profiles[profilePlate.id].title).toBe("0.16mm, multi-colour");
  });

  it("shows a shared model's profiles and pictures to its viewers, who can't start reading them", async () => {
    const { print, profilePlate } = await profileModel("shared", "none");
    await setSocialSettings({ enabled: true });
    try {
      await prisma.collection.create({
        data: {
          userId: owner.id,
          name: `Shared ${stamp}`,
          nameNormalized: `shared ${stamp}`,
          visibility: "PUBLIC",
          items: { create: { printId: print.id } },
        },
      });
      const viewer = auth(stranger.token);
      const profiles = await request(app).get(`/api/print/${print.id}/profiles`).set(viewer);
      expect(profiles.status).toBe(200);
      expect(profiles.body.profiles[profilePlate.id]).toBeDefined();
      expect((await request(app).get(`/api/plate/${profilePlate.id}/profile-plate/1.png`).set(viewer)).status).toBe(
        200,
      );
      expect((await request(app).post(`/api/print/${print.id}/profiles/fill`).set(viewer)).status).toBe(404);
    } finally {
      await setSocialSettings({ enabled: false });
    }
  });

  it("keeps what was read when a file's row is made again from it", async () => {
    const project = await profileProject(dir, "copied.3mf", "none");
    const stored = { provider: { title: "Kept" }, providerVersion: 1 };
    const { plates } = await createPrint(
      owner.id,
      { title: `copied ${stamp}` },
      `copied ${stamp}`,
      [{ filename: "copied.3mf", tempFilePath: project, sourceInstanceId: "222", profile: stored }],
      { describe: false, classify: false },
    );
    const row = await prisma.plate.findUniqueOrThrow({ where: { id: plates[0].id } });
    expect(row.profile).toEqual(stored);
  });
});

describe("how profiles are shown", () => {
  const get = async () =>
    (await request(app).get("/api/settings/print-profiles-view").set(auth(owner.token))).body.view;
  const patch = (view: unknown) =>
    request(app).patch("/api/settings/print-profiles-view").set(auth(owner.token)).send({ view });

  it("starts as the picker and keeps a change", async () => {
    expect(await get()).toBe("picker");
    expect((await patch("tiles")).body.view).toBe("tiles");
    expect(await get()).toBe("tiles");
    expect((await patch("off")).body.view).toBe("off");
  });

  it("rejects a way it doesn't know", async () => {
    expect((await patch("grid")).status).toBe(400);
  });
});
