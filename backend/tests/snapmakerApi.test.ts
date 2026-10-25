import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchSnapmakerDownloads,
  fetchSnapmakerList,
  parseSnapmakerListUrl,
  parseSnapmakerModelUrl,
  selectSnapmakerProfiles,
  SnapmakerAuthError,
  snapmakerMetaFromDetail,
} from "../src/providers/snapmaker/api";
import { modelIdFromUrl, modelUrlFor, parseSyncSource } from "../src/services/collectionSyncService";
import { normalizeSnapmakerToken } from "../src/providers/snapmaker/session";
import { buildImportSourceUrl, identifySourceModel } from "../src/services/importService";

// The Snapmaker Space client against the shapes its own site gets back, with fetch mocked. No database.

function apiResponse(code: number, data: unknown = null, msg = "success"): Response {
  // Snapmaker answers every call with HTTP 200 and its own code.
  return new Response(JSON.stringify({ code, msg, data }), {
    status: 200,
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

describe("Snapmaker Space URLs", () => {
  it("recognizes model pages, with a slug, without one, and with a print profile picked", () => {
    expect(parseSnapmakerModelUrl("https://space.snapmaker.com/en/model/33595-sugar-skull-princess")).toEqual({
      modelId: "33595",
      requestedProfileId: null,
    });
    expect(parseSnapmakerModelUrl("https://space.snapmaker.com/model/33595")).toEqual({
      modelId: "33595",
      requestedProfileId: null,
    });
    expect(parseSnapmakerModelUrl("https://space.snapmaker.com/en/model/33595#profileId-37940")).toEqual({
      modelId: "33595",
      requestedProfileId: "37940",
    });
  });

  it("ignores other pages and other sites", () => {
    expect(parseSnapmakerModelUrl("https://space.snapmaker.com/en/models")).toBeNull();
    expect(parseSnapmakerModelUrl("https://www.snapmaker.com/en/model/33595")).toBeNull();
    expect(parseSnapmakerModelUrl("https://space.snapmaker.com/en/creator/119349")).toBeNull();
  });

  it("tells the likes and bookmarks lists apart on the shared interactions page", () => {
    expect(parseSnapmakerListUrl("https://space.snapmaker.com/en/creator/183998?tab=interactions")).toEqual({
      userId: "183998",
      list: null,
    });
    expect(
      parseSnapmakerListUrl("https://space.snapmaker.com/en/creator/183998?tab=interactions&list=bookmarks"),
    ).toEqual({ userId: "183998", list: "bookmarks" });
    expect(parseSnapmakerListUrl("https://space.snapmaker.com/en/creator/183998")).toBeNull();
  });

  it("identifies imported models and links back to them", () => {
    const source = identifySourceModel("https://space.snapmaker.com/en/model/33595-sugar-skull#profileId-37940");
    expect(source).toEqual({ provider: "snapmaker", externalId: "33595" });
    expect(buildImportSourceUrl("snapmaker", "33595")).toBe("https://space.snapmaker.com/en/model/33595");
    expect(modelIdFromUrl("snapmaker", modelUrlFor("snapmaker", "33595"))).toBe("33595");
  });

  it("syncs the user's likes and bookmarks as two sources, but not the page without a list", () => {
    expect(parseSyncSource("https://space.snapmaker.com/en/creator/183998?tab=interactions&list=likes")).toEqual({
      provider: "snapmaker",
      externalId: "likes-183998",
      url: "https://space.snapmaker.com/en/creator/183998?tab=interactions&list=likes",
    });
    expect(parseSyncSource("https://space.snapmaker.com/en/creator/183998?tab=interactions")).toBeNull();
  });
});

const DETAIL = {
  id: "33595",
  title: "ПринцессаВГриме",
  translatedTitle: "Sugar Skull Princess",
  description: "<p>Оригинал</p>",
  translatedDescription: "<p>This <strong>Sugar Skull Princess</strong> is a collectible.</p>",
  coverUrl: "https://cdn-model.snapmaker.com/snapmaker/model/20260918/119349/cover.jpg",
  images: [
    "https://cdn-model.snapmaker.com/snapmaker/model/20260918/119349/a.jpg",
    "https://cdn-model.snapmaker.com/snapmaker/model/20260918/119349/b.jpg",
  ],
  tags: ["готика"],
  translatedTags: ["gothic collectible", "halloween decor", "gothic collectible"],
  categoryId: 159,
  categoryTree: {
    id: 1,
    parentId: null,
    nameKey: "Categories",
    children: [
      {
        id: 110,
        parentId: 1,
        nameKey: "Miniatures",
        children: [{ id: 159, parentId: 110, nameKey: "Creatures", children: [] }],
      },
    ],
  },
  creatorId: "119349",
  creatorName: "Decorartor",
  creatorAvatar: "https://cdn-model.snapmaker.com/snapmaker/avatar/119349/avatar.jpg",
  printProfiles: [
    {
      id: "37940",
      title: "snapmaker_2plates",
      translatedTitle: "2 plates",
      creatorId: "119349",
      pictures: ["https://cdn-model.snapmaker.com/snapmaker/model/1/a.jpg", "https://cdn-model.snapmaker.com/b.jpg"],
    },
    { id: "40001", title: "remix", creatorId: "555" },
  ],
};

describe("Snapmaker model details", () => {
  it("maps the English translation, the category chain most specific first, the creator and the profiles", () => {
    const { meta, galleryImages, creatorId, profiles } = snapmakerMetaFromDetail(DETAIL);
    expect(meta.title).toBe("Sugar Skull Princess");
    expect(meta.description).toBe("This **Sugar Skull Princess** is a collectible.");
    expect(meta.tags).toEqual(["gothic collectible", "halloween decor"]);
    expect(meta.previewImageUrl).toBe(DETAIL.coverUrl);
    expect(meta.siteCategoryIds).toEqual([159, 110]);
    expect(meta.categorySite).toBe("snapmaker");
    expect(meta.author).toMatchObject({
      provider: "snapmaker",
      externalId: "119349",
      name: "Decorartor",
      links: ["https://space.snapmaker.com/en/creator/119349"],
    });
    expect(galleryImages.map((image) => image.filename)).toEqual(["a.jpg", "b.jpg"]);
    expect(creatorId).toBe("119349");
    expect(profiles).toEqual([
      // A profile's own picture is its first.
      {
        id: "37940",
        title: "2 plates",
        creatorId: "119349",
        coverUrl: "https://cdn-model.snapmaker.com/snapmaker/model/1/a.jpg",
      },
      { id: "40001", title: "remix", creatorId: "555", coverUrl: null },
    ]);
  });

  it("picks profiles like MakerWorld: the linked one, else the designer's; the designer's; or all", () => {
    const resolution = snapmakerMetaFromDetail(DETAIL);
    expect(selectSnapmakerProfiles(resolution, "url", null)).toEqual(["37940"]);
    expect(selectSnapmakerProfiles(resolution, "url", "40001")).toEqual(["40001"]);
    expect(selectSnapmakerProfiles(resolution, "url", "999")).toEqual(["37940"]);
    expect(selectSnapmakerProfiles(resolution, "designer", null)).toEqual(["37940"]);
    expect(selectSnapmakerProfiles(resolution, "all", null)).toEqual(["37940", "40001"]);
    expect(selectSnapmakerProfiles({ creatorId: "1", profiles: [] }, "url", null)).toEqual([]);
  });
});

describe("Snapmaker downloads", () => {
  it("returns signed links for the model files and each profile, with Snapmaker's + spaces undone", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      apiResponse(200, {
        modelFiles: [{ fileName: "Herald+of+the+Storm.stl", downloadUrl: "https://models.snapmaker.com/a.stl?sign=1" }],
        printProfiles: [
          { profileId: "40699", fileName: "Herald.3mf", downloadUrl: "https://models.snapmaker.com/b.3mf?sign=2" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const downloads = await fetchSnapmakerDownloads("36590", "token");
    expect(downloads).toEqual({
      modelFiles: [{ name: "Herald of the Storm.stl", url: "https://models.snapmaker.com/a.stl?sign=1" }],
      profiles: [{ profileId: "40699", name: "Herald.3mf", url: "https://models.snapmaker.com/b.3mf?sign=2" }],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api-models.snapmaker.com/api/model/download/36590");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer token" });
  });

  it("throws SnapmakerAuthError for a token Snapmaker turns down, and gives null for a missing model", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(apiResponse(110002, null, "Missing authorization")));
    await expect(fetchSnapmakerDownloads("36590", "expired")).rejects.toBeInstanceOf(SnapmakerAuthError);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(apiResponse(603000, null, "Model not found")));
    expect(await fetchSnapmakerDownloads("1", "token")).toBeNull();
  });
});

describe("Snapmaker likes and bookmarks", () => {
  it("reads every page of the list, leaving deleted models out", async () => {
    const item = (id: number, extra: Record<string, unknown> = {}) => ({
      id: String(id),
      title: `Model ${id}`,
      cover_url: `https://cdn-model.snapmaker.com/${id}.jpg`,
      is_deleted: false,
      ...extra,
    });
    const first = Array.from({ length: 30 }, (_, i) => item(i + 1));
    first[2] = item(3, { is_deleted: true });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(apiResponse(200, { list: first, total: 32, page: 1, pageSize: 30 }))
      .mockResolvedValueOnce(apiResponse(200, { list: [item(31), item(32)], total: 32, page: 2, pageSize: 30 }));
    vi.stubGlobal("fetch", fetchMock);
    const listing = await fetchSnapmakerList("bookmarks", "token");
    expect(listing.total).toBe(32);
    expect(listing.entries).toHaveLength(31);
    expect(listing.entries.some((entry) => entry.modelId === "3")).toBe(false);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api-models.snapmaker.com/api/model/collect/my?page=1&pageSize=30");
  });
});

describe("Snapmaker sign-in", () => {
  const token = jwt({ exp: 1_800_000_000, userId: 183998 });

  it("takes the access token bare, as a Bearer header or from the whole Cookie header", () => {
    const expected = { token, expiresAt: new Date(1_800_000_000 * 1000), userId: "183998" };
    expect(normalizeSnapmakerToken(token)).toEqual(expected);
    expect(normalizeSnapmakerToken(`Bearer ${token}`)).toEqual(expected);
    expect(
      normalizeSnapmakerToken(`login_refresh_token=abc; login_access_token=${encodeURIComponent(token)}; other=1`),
    ).toEqual(expected);
  });

  it("refuses anything that isn't a token", () => {
    expect(normalizeSnapmakerToken("")).toBeNull();
    expect(normalizeSnapmakerToken("not a token")).toBeNull();
    expect(normalizeSnapmakerToken("a.b.c")).toBeNull();
    expect(normalizeSnapmakerToken("login_access_token=%E0%A4%A")).toBeNull();
  });
});
