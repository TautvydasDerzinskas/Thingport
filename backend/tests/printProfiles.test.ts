import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { PROVIDERS } from "../src/providers/registry";
import { createPrint } from "../src/services/printCreation";
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

async function profileModel(label: string, sliced: "none" | "first" | "all") {
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

/** Starts a fill and waits for it to finish. */
async function fill(printId: string) {
  const started = await request(app).post(`/api/print/${printId}/profiles/fill`).set(auth(owner.token));
  expect(started.status).toBe(200);
  for (let i = 0; i < 50; i++) {
    const res = await request(app).get(`/api/print/${printId}/profiles`).set(auth(owner.token));
    if (!res.body.filling) return res.body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the fill never finished");
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
