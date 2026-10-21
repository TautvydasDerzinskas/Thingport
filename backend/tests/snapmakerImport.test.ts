import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app";
import { importPrintFromUrl } from "../src/services/importService";
import { prisma } from "../src/db";
import { getSnapmakerConnection, setUserSnapmakerToken } from "../src/services/snapmakerSessionService";
import { plateThumbPath } from "../src/services/printService";
import { plateAssetHome } from "../src/services/modelAssets";

// Snapmaker Space import end to end: details and signed downloads in the shapes its site gets, fetch mocked.

const MODEL_ID = "9990033";
const MODEL_URL = `https://space.snapmaker.com/en/model/${MODEL_ID}-test-princess`;
const API = "https://api-models.snapmaker.com/api";
const DESIGNER_3MF = "https://models.snapmaker.com/models/download/snapmaker/model-file/designer.3mf?sign=a";
const REMIX_3MF = "https://models.snapmaker.com/models/download/snapmaker/model-file/remix.3mf?sign=b";
const MODEL_STL = "https://models.snapmaker.com/models/download/snapmaker/model-file/princess.stl?sign=c";
const IMAGE_URL = "https://cdn-model.snapmaker.com/snapmaker/model/test/cover.png";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

type Profile = { id: string; title: string; creatorId: string; pictures?: string[] };
const PROFILES: Profile[] = [
  { id: "501", title: "Designer's", creatorId: "777" },
  { id: "502", title: "Community remix", creatorId: "888" },
];

const RED_URL = "https://cdn-model.snapmaker.com/snapmaker/model/test/501-red.png";
const BLUE_URL = "https://cdn-model.snapmaker.com/snapmaker/model/test/502-blue.png";
const solid = (r: number, g: number, b: number) =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
/** The thumbnail's average colour, which survives the JPEG re-encode. */
async function thumbColour(plateId: string): Promise<number[]> {
  const { channels } = await sharp(plateThumbPath(plateId, await plateAssetHome(plateId))).stats();
  return channels.slice(0, 3).map((c) => Math.round(c.mean));
}

function detail(profiles = PROFILES) {
  return {
    id: MODEL_ID,
    title: "Test Princess",
    description: "<p>A <strong>princess</strong>.</p>",
    coverUrl: IMAGE_URL,
    images: [IMAGE_URL],
    tags: ["princess"],
    categoryId: 159,
    categoryTree: {
      id: 1,
      parentId: null,
      children: [{ id: 110, parentId: 1, children: [{ id: 159, parentId: 110, children: [] }] }],
    },
    creatorId: "777",
    creatorName: "Test Designer",
    printProfiles: profiles,
  };
}

function apiResponse(code: number, data: unknown = null): Response {
  return new Response(JSON.stringify({ code, msg: code === 200 ? "success" : "error", data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** `sameName`: every profile's file comes named alike, as Snapmaker often does. */
function mockSnapmaker(opts: { profiles?: Profile[]; downloadCode?: number; sameName?: boolean } = {}) {
  return vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
    const url = String(input);
    if (url === `${API}/model/detail/${MODEL_ID}`) return apiResponse(200, detail(opts.profiles));
    if (url === `${API}/model/download/${MODEL_ID}`) {
      if (opts.downloadCode) return apiResponse(opts.downloadCode);
      return apiResponse(200, {
        modelFiles: [{ fileName: "princess.stl", downloadUrl: MODEL_STL }],
        printProfiles: (opts.profiles ?? PROFILES).map((profile) => ({
          profileId: profile.id,
          fileName: opts.sameName ? "princess.3mf" : `${profile.id}.3mf`,
          downloadUrl: profile.id === "501" ? DESIGNER_3MF : REMIX_3MF,
        })),
      });
    }
    // Snapmaker serves files as text/html whatever they are.
    if (url === DESIGNER_3MF)
      return new Response("designer 3mf", { status: 200, headers: { "content-type": "text/html" } });
    if (url === REMIX_3MF) return new Response("remix 3mf", { status: 200, headers: { "content-type": "text/html" } });
    if (url === MODEL_STL) return new Response("solid princess\nendsolid princess\n", { status: 200 });
    if (url === RED_URL) return new Response(await solid(255, 0, 0), { headers: { "content-type": "image/png" } });
    if (url === BLUE_URL) return new Response(await solid(0, 0, 255), { headers: { "content-type": "image/png" } });
    if (url === IMAGE_URL)
      return new Response(ONE_PIXEL_PNG, { status: 200, headers: { "content-type": "image/png" } });
    throw new Error(`Unexpected fetch to ${url}`);
  }) as unknown as typeof fetch;
}

function token(): { token: string; expiresAt: Date; userId: string } {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    token: `${part({ alg: "RS256" })}.${part({ exp, userId: 183998 })}.sig`,
    expiresAt: new Date(exp * 1000),
    userId: "183998",
  };
}

describe("importPrintFromUrl -- Snapmaker Space", () => {
  const app = createApp();
  let userId: string;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    const email = `snapmaker-import-test-${Date.now()}@example.com`;
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Snapmaker Import Test", email, password: "password123" });
    if (res.status !== 200) throw new Error(`Failed to register: ${res.status} ${JSON.stringify(res.body)}`);
    userId = res.body.user.id;
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    await setUserSnapmakerToken(userId, null);
    await prisma.print.deleteMany({ where: { userId, sourceProvider: "snapmaker" } });
  });

  it("asks to connect Snapmaker when there's no sign-in, before calling Snapmaker", async () => {
    const fetchMock = mockSnapmaker();
    global.fetch = fetchMock;
    await expect(importPrintFromUrl(userId, MODEL_URL, { url: MODEL_URL, tags: [] })).rejects.toThrow(
      /Snapmaker.*Configuration > Providers/,
    );
    expect(vi.mocked(fetchMock)).not.toHaveBeenCalled();
  });

  it("imports the designer's print profile as one plate, tagged, and files it by its category", async () => {
    await setUserSnapmakerToken(userId, token());
    const creatures = await prisma.category.findFirst({
      where: { userId, name: "Creatures", parent: { name: "Miniatures" } },
    });
    global.fetch = mockSnapmaker();
    const result = await importPrintFromUrl(userId, MODEL_URL, { url: MODEL_URL, tags: [] });
    expect(result.alreadyImported).toBe(false);
    expect(result.print.title).toBe("Test Princess");
    expect(result.print.notes).toBe("A **princess**.");
    expect(result.print.sourceProvider).toBe("snapmaker");
    expect(result.print.sourceExternalId).toBe(MODEL_ID);
    expect(creatures).not.toBeNull();
    expect(result.print.categoryId).toBe(creatures!.id);
    expect(result.plates.map((plate) => plate.sourceInstanceId)).toEqual(["501"]);
    expect(result.author?.name).toBe("Test Designer");
  });

  it("adds another profile on a re-import naming it, and makes no request when nothing new is named", async () => {
    await setUserSnapmakerToken(userId, token());
    global.fetch = mockSnapmaker();
    await importPrintFromUrl(userId, MODEL_URL, { url: MODEL_URL, tags: [] });

    const fetchMock = mockSnapmaker();
    global.fetch = fetchMock;
    const again = await importPrintFromUrl(userId, MODEL_URL, { url: MODEL_URL, tags: [] });
    expect(again.alreadyImported).toBe(true);
    expect(vi.mocked(fetchMock)).not.toHaveBeenCalled();

    const remixUrl = `${MODEL_URL}#profileId-502`;
    const added = await importPrintFromUrl(userId, remixUrl, { url: remixUrl, tags: [] });
    expect(added.profileAdded).toBe(true);
    expect(added.plates.map((plate) => plate.sourceInstanceId).toSorted()).toEqual(["501", "502"]);
  });

  it("tells profiles apart by their own names and pictures when their files come named alike", async () => {
    await setUserSnapmakerToken(userId, token());
    const profiles = [
      { ...PROFILES[0], pictures: [RED_URL] },
      { ...PROFILES[1], pictures: [BLUE_URL] },
    ];
    global.fetch = mockSnapmaker({ profiles, sameName: true });
    const first = await importPrintFromUrl(userId, MODEL_URL, { url: MODEL_URL, tags: [] });
    // Alone, it keeps the site's name.
    expect(first.plates.map((plate) => plate.filename)).toEqual(["princess.3mf"]);

    const remixUrl = `${MODEL_URL}#profileId-502`;
    const added = await importPrintFromUrl(userId, remixUrl, { url: remixUrl, tags: [] });
    expect(added.plates.map((plate) => [plate.sourceInstanceId, plate.filename])).toEqual([
      ["501", "princess - Designer's.3mf"],
      ["502", "princess - Community remix.3mf"],
    ]);
    const [red, blue] = await Promise.all(added.plates.map((plate) => thumbColour(plate.id)));
    expect(red[0]).toBeGreaterThan(200);
    expect(red[2]).toBeLessThan(60);
    expect(blue[2]).toBeGreaterThan(200);
    expect(blue[0]).toBeLessThan(60);
  });

  // As on model 33211: titles that already hold the file's name are names enough on their own.
  it("names a profile by its title alone when the title holds the file's name", async () => {
    await setUserSnapmakerToken(userId, token());
    const profiles = [
      { ...PROFILES[0], title: "princess_1plates" },
      { ...PROFILES[1], title: "princess" },
    ];
    global.fetch = mockSnapmaker({ profiles, sameName: true });
    await importPrintFromUrl(userId, MODEL_URL, { url: MODEL_URL, tags: [] });
    const remixUrl = `${MODEL_URL}#profileId-502`;
    const added = await importPrintFromUrl(userId, remixUrl, { url: remixUrl, tags: [] });
    expect(added.plates.map((plate) => plate.filename)).toEqual(["princess_1plates.3mf", "princess.3mf"]);
  });

  // As on model 185: profiles named alike can't be told apart by name, so the site's name stays, suffixed.
  it("leaves the names be when the profiles' titles are alike too", async () => {
    await setUserSnapmakerToken(userId, token());
    const profiles = [
      { ...PROFILES[0], title: "Princess" },
      { ...PROFILES[1], title: "Princess" },
    ];
    global.fetch = mockSnapmaker({ profiles, sameName: true });
    await importPrintFromUrl(userId, MODEL_URL, { url: MODEL_URL, tags: [] });
    const remixUrl = `${MODEL_URL}#profileId-502`;
    const added = await importPrintFromUrl(userId, remixUrl, { url: remixUrl, tags: [] });
    expect(added.plates.map((plate) => plate.filename)).toEqual(["princess.3mf", "princess (2).3mf"]);
  });

  it("brings the model files when the model has no print profiles", async () => {
    await setUserSnapmakerToken(userId, token());
    global.fetch = mockSnapmaker({ profiles: [] });
    const result = await importPrintFromUrl(userId, MODEL_URL, { url: MODEL_URL, tags: [] });
    expect(result.plates).toHaveLength(1);
    expect(result.plates[0].sourceInstanceId).toBeNull();
    expect(result.plates[0].filename).toMatch(/princess\.stl$/);
  });

  it("remembers a sign-in Snapmaker turns down, so the app can say it ran out", async () => {
    await setUserSnapmakerToken(userId, token());
    global.fetch = mockSnapmaker({ downloadCode: 110002 });
    await expect(importPrintFromUrl(userId, MODEL_URL, { url: MODEL_URL, tags: [] })).rejects.toThrow(/Snapmaker/);
    expect(await getSnapmakerConnection(userId)).toBe("expired");
  });
});
