import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchMakeronlineLikes,
  isMakeronlineFileHost,
  isMakeronlineLikesUrl,
  makeronlineDownloadPlan,
  makeronlineMetaFromDetail,
  MakeronlineAuthError,
  parseMakeronlineCollectionUrl,
  parseMakeronlineModelUrl,
  resolveMakeronlineModel,
  selectMakeronlineProfiles,
} from "../src/providers/makeronline/api";
import { modelIdFromUrl, modelUrlFor, parseSyncSource } from "../src/services/collectionSyncService";
import { normalizeMakeronlineToken } from "../src/providers/makeronline/session";
import { buildImportSourceUrl, identifySourceModel } from "../src/services/importService";

// The MakerOnline client against the shapes its own site gets back, with fetch mocked. No database.

function apiResponse(code: number, data: unknown = {}, message = "Successful operation", status = 200): Response {
  return new Response(JSON.stringify({ code, message, data }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function jwt(payload: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(payload)}.signature_part-1`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MakerOnline URLs", () => {
  it("recognizes model pages, with the title segment or without, and a picked print profile", () => {
    expect(parseMakeronlineModelUrl("https://www.makeronline.com/en/model/Bone-Wagon/329173.html")).toEqual({
      modelId: "329173",
      requestedProfileId: null,
    });
    expect(parseMakeronlineModelUrl("https://makeronline.com/model/329173")).toEqual({
      modelId: "329173",
      requestedProfileId: null,
    });
    expect(parseMakeronlineModelUrl("https://www.makeronline.com/en/model/329173#profileId-225494")).toEqual({
      modelId: "329173",
      requestedProfileId: "225494",
    });
    expect(parseMakeronlineModelUrl("https://www.makeronline.com/en/allModel/all/all/0.html")).toBeNull();
    expect(parseMakeronlineModelUrl("https://www.makeronline.co/en/model/1.html")).toBeNull();
  });

  it("recognizes collections and the user's likes, and syncs both", () => {
    const collection =
      "https://www.makeronline.com/en/user/collectionDetail/34c8dda0-df3c-4377-8ba2-ef46c50cd915/599628.html";
    expect(parseMakeronlineCollectionUrl(collection)).toEqual({
      collectionId: "599628",
      ownerId: "34c8dda0-df3c-4377-8ba2-ef46c50cd915",
    });
    expect(parseSyncSource(collection)).toEqual({ provider: "makeronline", externalId: "599628", url: collection });
    expect(isMakeronlineLikesUrl("https://www.makeronline.com/en/user/likes/models.html")).toBe(true);
    expect(parseSyncSource("https://www.makeronline.com/en/user/likes/models.html")).toEqual({
      provider: "makeronline",
      externalId: "likes",
      url: "https://www.makeronline.com/en/user/likes/models.html",
    });
  });

  it("identifies imported models and links back to them", () => {
    const source = identifySourceModel("https://www.makeronline.com/en/model/Bone-Wagon/329173.html");
    expect(source).toEqual({ provider: "makeronline", externalId: "329173" });
    expect(buildImportSourceUrl("makeronline", "329173")).toBe("https://www.makeronline.com/en/model/329173");
    expect(modelIdFromUrl("makeronline", modelUrlFor("makeronline", "329173"))).toBe("329173");
  });

  it("only takes signed files from MakerOnline's own hosts", () => {
    expect(isMakeronlineFileHost("acop-prod-private.s3-accelerate.amazonaws.com")).toBe(true);
    expect(isMakeronlineFileHost("cdn-acop.makeronline.com")).toBe(true);
    expect(isMakeronlineFileHost("evil.amazonaws.com")).toBe(false);
    expect(isMakeronlineFileHost("makeronline.com.evil.net")).toBe(false);
  });
});

const DETAIL = {
  id: 281521,
  title: "Ergonomic Super Scraper",
  desc: "<p>A <strong>scraper</strong> for the Kobra.</p>",
  tags: ["scraper", "kobra", "scraper"],
  categories: [
    { id: 33, name: "3D Printer", level: 1 },
    { id: 35, name: "3D Printer Parts & Upgrades", level: 2 },
  ],
  images: [
    { url: "https://cdn-acop.makeronline.com/asop/a.png", is_main: 0 },
    { url: "https://cdn-acop.makeronline.com/asop/main.png", is_main: 1 },
  ],
  files: [
    { key: "839eef", file_name: "Left Hand Version.stl" },
    { key: "9f02de", file_name: "Right Hand Version.stl" },
  ],
  print_profiles: [
    {
      id: 176077,
      title: "Kobra X profile",
      user_id: "designer-uuid",
      main_image: "https://cdn-acop.makeronline.com/asop/profile.png",
      files: [
        { key: "13d314", file_name: "scraper.3mf", print_profile_id: 176077 },
        { key: "13d314", file_name: "scraper.3mf", print_profile_id: 176077 },
      ],
    },
    { id: 215390, title: "Remix", user_id: "someone-else", files: [{ key: "d1aee5", file_name: "remix.3mf" }] },
  ],
  user_id: "designer-uuid",
  user_display_name: "3DPrintOfficial",
  show_user_name: "@3DPrintOfficial_1",
  user_avatar: "https://cdn-acop.makeronline.com/asop/avatar.png",
};

describe("MakerOnline model details", () => {
  it("maps the details, the main image first, the category chain most specific first and the designer", () => {
    const { meta, galleryImages, profiles, modelFiles } = makeronlineMetaFromDetail(DETAIL);
    expect(meta.title).toBe("Ergonomic Super Scraper");
    expect(meta.description).toBe("A **scraper** for the Kobra.");
    expect(meta.tags).toEqual(["scraper", "kobra"]);
    expect(meta.previewImageUrl).toBe("https://cdn-acop.makeronline.com/asop/main.png");
    expect(galleryImages.map((image) => image.filename)).toEqual(["main.png", "a.png"]);
    expect(meta.siteCategoryIds).toEqual([35, 33]);
    expect(meta.categorySite).toBe("makeronline");
    expect(meta.author).toMatchObject({
      provider: "makeronline",
      externalId: "designer-uuid",
      name: "3DPrintOfficial",
      handle: "3DPrintOfficial_1",
      links: ["https://www.makeronline.com/en/user/personalInfo/designer-uuid.html"],
    });
    expect(profiles.map((p) => [p.id, p.fileKey, p.coverUrl])).toEqual([
      ["176077", "13d314", "https://cdn-acop.makeronline.com/asop/profile.png"],
      ["215390", "d1aee5", null],
    ]);
    expect(modelFiles).toHaveLength(2);
  });

  it("picks profiles like MakerWorld, and plans their 3MFs, or the model files when there are none", () => {
    const resolution = makeronlineMetaFromDetail(DETAIL);
    expect(selectMakeronlineProfiles(resolution, "url", null)).toEqual(["176077"]);
    expect(selectMakeronlineProfiles(resolution, "url", "215390")).toEqual(["215390"]);
    expect(selectMakeronlineProfiles(resolution, "all", null)).toEqual(["176077", "215390"]);
    expect(makeronlineDownloadPlan("281521", resolution, "url", null)).toEqual([
      {
        payload: { key: "13d314", file_type: 2, is_batch_down: 0, print_profile_id: 176077 },
        name: "scraper.3mf",
        profile_id: "176077",
      },
    ]);
    const bare = makeronlineMetaFromDetail({ ...DETAIL, print_profiles: [] });
    expect(makeronlineDownloadPlan("281521", bare, "all", null)).toEqual([
      {
        payload: { key: "839eef", file_type: 1, is_batch_down: 0, mold_id: 281521 },
        name: "Left Hand Version.stl",
        profile_id: null,
      },
      {
        payload: { key: "9f02de", file_type: 1, is_batch_down: 0, mold_id: 281521 },
        name: "Right Hand Version.stl",
        profile_id: null,
      },
    ]);
  });

  it("gives null for a model that's gone, and sends no sign-in for details", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(apiResponse(1, {}, "The model does not exist or has been deleted."));
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveMakeronlineModel("999999999")).toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.makeronline.com/api/mold/detail?id=999999999");
    expect((init as RequestInit).headers).not.toHaveProperty("Authorization");
  });
});

describe("MakerOnline likes", () => {
  it("reads every page with the bare token, leaving taken-down models out", async () => {
    const item = (id: number, status = 1) => ({ mold_id: id, title: `Model ${id}`, main_image: `${id}.png`, status });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        apiResponse(0, { data: [item(1), item(2, 0)], page: { current_page: 1, last_page: 2, total: 3 } }),
      )
      .mockResolvedValueOnce(apiResponse(0, { data: [item(3)], page: { current_page: 2, last_page: 2, total: 3 } }));
    vi.stubGlobal("fetch", fetchMock);
    const listing = await fetchMakeronlineLikes("token");
    expect(listing.entries.map((e) => e.modelId)).toEqual(["1", "3"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://www.makeronline.com/api/user/like/index?page=1&page_size=20");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "token" });
  });

  it("throws MakeronlineAuthError for a token MakerOnline turns down", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(apiResponse(-1, [], "Syntax error", 401)));
    await expect(fetchMakeronlineLikes("expired")).rejects.toBeInstanceOf(MakeronlineAuthError);
  });
});

describe("MakerOnline sign-in", () => {
  const token = jwt({ exp: 1_800_140_514, sub: "34c8dda0-df3c-4377-8ba2-ef46c50cd915" });

  it("takes the access token bare, as an Authorization value or from the whole Cookie header", () => {
    const expected = {
      token,
      expiresAt: new Date(1_800_140_514 * 1000),
      userId: "34c8dda0-df3c-4377-8ba2-ef46c50cd915",
    };
    expect(normalizeMakeronlineToken(token)).toEqual(expected);
    expect(normalizeMakeronlineToken(`Authorization: ${token}`)).toEqual(expected);
    expect(normalizeMakeronlineToken(`lang=en; mo_access_token=${token}; acceptCookie=true`)).toEqual(expected);
  });

  it("refuses anything that isn't a token", () => {
    expect(normalizeMakeronlineToken("")).toBeNull();
    expect(normalizeMakeronlineToken("a.b.c")).toBeNull();
    expect(normalizeMakeronlineToken("mo_access_token=%E0%A4%A")).toBeNull();
  });
});
