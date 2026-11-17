import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app";
import { importPrintFromUrl } from "../src/services/importService";
import { prisma } from "../src/db";
import {
  getSnapmakerConnection,
  getUserSnapmakerToken,
  setUserSnapmakerToken,
} from "../src/providers/snapmaker/session";
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

const DOC_PDF = "https://cdn-model.snapmaker.com/snapmaker/model-doc/20261115/213183/fcca56f131d317b7.pdf";
const DOC_JPG = "https://cdn-model.snapmaker.com/snapmaker/model-doc/20261109/161185/c20959b32c403d2b.jpg";

function detail(profiles = PROFILES, documents: { name: string; url: string }[] = []) {
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
    // As its page lists them: a guide, and a picture.
    documents,
  };
}

function apiResponse(code: number, data: unknown = null): Response {
  return new Response(JSON.stringify({ code, msg: code === 200 ? "success" : "error", data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** `sameName`: every profile's file comes named alike, as Snapmaker often does. */
const GUIDE_PDF = "https://models.snapmaker.com/models/download/snapmaker/model-file/guide.pdf?sign=d";

function mockSnapmaker(
  opts: { profiles?: Profile[]; downloadCode?: number; sameName?: boolean; guide?: boolean; documents?: boolean } = {},
) {
  return vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
    const url = String(input);
    if (url === `${API}/model/detail/${MODEL_ID}`) {
      const documents = opts.documents
        ? [
            { name: "MazeEgg05_Assembly_Guide.pdf", url: DOC_PDF },
            { name: "08.jpg", url: DOC_JPG },
          ]
        : [];
      return apiResponse(200, detail(opts.profiles, documents));
    }
    if (url === DOC_PDF)
      return new Response("%PDF-1.4 guide", { status: 200, headers: { "content-type": "application/pdf" } });
    if (url === `${API}/model/download/${MODEL_ID}`) {
      if (opts.downloadCode) return apiResponse(opts.downloadCode);
      return apiResponse(200, {
        modelFiles: [
          { fileName: "princess.stl", downloadUrl: MODEL_STL },
          ...(opts.guide ? [{ fileName: "Painting guide.pdf", downloadUrl: GUIDE_PDF }] : []),
        ],
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
    if (url === GUIDE_PDF)
      return new Response("%PDF-1.4 guide", { status: 200, headers: { "content-type": "text/html" } });
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
    await setUserSnapmakerToken(userId, null, "cn");
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

  it("keeps the model's documents beside the profile, from the one answer that signs them both", async () => {
    await setUserSnapmakerToken(userId, token());
    const fetchMock = mockSnapmaker({ guide: true });
    global.fetch = fetchMock;
    const result = await importPrintFromUrl(userId, MODEL_URL, { url: MODEL_URL, tags: [] });
    expect(result.plates.map((plate) => plate.sourceInstanceId)).toEqual(["501"]);
    const files = await prisma.printFile.findMany({ where: { printId: result.print.id, role: "SUPPORTING" } });
    expect(files.map((file) => file.filename)).toEqual(["Painting guide.pdf"]);
    // Neither the model file the profile stands for, nor the answer twice.
    const asked = vi.mocked(fetchMock).mock.calls.map(([input]) => String(input));
    expect(asked).not.toContain(MODEL_STL);
    expect(asked.filter((url) => url === `${API}/model/download/${MODEL_ID}`)).toHaveLength(1);
  });

  it("keeps the guides its page lists under Documents, not its pictures, whatever the import brings", async () => {
    await setUserSnapmakerToken(userId, token());
    for (const profiles of [PROFILES, []]) {
      const fetchMock = mockSnapmaker({ profiles, documents: true });
      global.fetch = fetchMock;
      const result = await importPrintFromUrl(userId, MODEL_URL, { url: MODEL_URL, tags: [] });
      const files = await prisma.printFile.findMany({ where: { printId: result.print.id, role: "SUPPORTING" } });
      expect(files.map((file) => file.filename)).toEqual(["MazeEgg05_Assembly_Guide.pdf"]);
      expect(vi.mocked(fetchMock).mock.calls.map(([input]) => String(input))).not.toContain(DOC_JPG);
      await prisma.print.deleteMany({ where: { userId, sourceProvider: "snapmaker" } });
    }
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
    expect(await getUserSnapmakerToken(userId)).toBeNull();
    await setUserSnapmakerToken(userId, token());
    expect(await getUserSnapmakerToken(userId)).not.toBeNull();
  });

  it("keeps a sign-in Grab sent while an import with the one before was being turned down", async () => {
    await setUserSnapmakerToken(userId, token());
    const renewed = { ...token(), token: token().token.replace(/sig$/, "renewed") };
    const site = mockSnapmaker({ downloadCode: 110002 });
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      if (String(input) === `${API}/model/download/${MODEL_ID}`) await setUserSnapmakerToken(userId, renewed);
      return site(input);
    }) as unknown as typeof fetch;
    await expect(importPrintFromUrl(userId, MODEL_URL, { url: MODEL_URL, tags: [] })).rejects.toThrow(/Snapmaker/);
    expect(await getSnapmakerConnection(userId)).toBe("connected");
    expect(await getUserSnapmakerToken(userId)).toBe(renewed.token);
  });

  describe("its China site", () => {
    const CN_API = "https://api-models.snapmaker.cn/api";
    const CN_URL = `https://space.snapmaker.cn/zh/model/${MODEL_ID}`;
    const CN_3MF = "https://cdn-model-private.snapmaker.cn/snapmaker/model-file/cn.3mf?Expires=1&Signature=x";

    /** The China site, whose model of the same id is another one, beside the main site's. */
    function mockBothSites(): typeof fetch {
      const main = mockSnapmaker();
      return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
        const url = String(input);
        if (url === `${CN_API}/model/detail/${MODEL_ID}`) {
          return apiResponse(200, { ...detail([{ id: "601", title: "U1", creatorId: "777" }]), title: "小火车" });
        }
        if (url === `${CN_API}/model/download/${MODEL_ID}`) {
          const auth = new Headers(init?.headers).get("Authorization");
          if (auth !== "Bearer cn-token") return apiResponse(110002);
          return apiResponse(200, {
            modelFiles: [],
            printProfiles: [{ profileId: "601", fileName: "train.3mf", downloadUrl: CN_3MF }],
          });
        }
        if (url === CN_3MF) return new Response("cn 3mf", { status: 200 });
        return main(input, init);
      }) as unknown as typeof fetch;
    }

    const chinaToken = () => ({ ...token(), token: token().token.replace(/sig$/, "cn"), userId: "9990001" });

    it("needs the China site's own sign-in: the main site's doesn't open it", async () => {
      await setUserSnapmakerToken(userId, token());
      global.fetch = mockBothSites();
      await expect(importPrintFromUrl(userId, CN_URL, { url: CN_URL, tags: [] })).rejects.toThrow(
        /space\.snapmaker\.cn/,
      );
    });

    it("imports a China model under its cn- id, with the China sign-in, apart from the main site's of that id", async () => {
      await setUserSnapmakerToken(userId, { ...chinaToken(), token: "cn-token" }, "cn");
      await setUserSnapmakerToken(userId, token());
      global.fetch = mockBothSites();
      const china = await importPrintFromUrl(userId, CN_URL, { url: CN_URL, tags: [] });
      expect(china.print.sourceExternalId).toBe(`cn-${MODEL_ID}`);
      expect(china.print.title).toBe("小火车");
      expect(china.plates.map((plate) => plate.sourceInstanceId)).toEqual(["601"]);
      const main = await importPrintFromUrl(userId, MODEL_URL, { url: MODEL_URL, tags: [] });
      expect(main.alreadyImported).toBe(false);
      expect(main.print.id).not.toBe(china.print.id);
    });

    it("remembers a China sign-in the China site turns down, and leaves the main one be", async () => {
      await setUserSnapmakerToken(userId, { ...chinaToken(), token: "stale-cn-token" }, "cn");
      await setUserSnapmakerToken(userId, token());
      global.fetch = mockBothSites();
      await expect(importPrintFromUrl(userId, CN_URL, { url: CN_URL, tags: [] })).rejects.toThrow(
        /didn't accept your sign-in.*space\.snapmaker\.cn/,
      );
      expect(await getSnapmakerConnection(userId, "cn")).toBe("expired");
      expect(await getSnapmakerConnection(userId)).toBe("connected");
    });
  });
});
