import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeThangsJwt,
  fetchThangsCollection,
  fetchThangsDownload,
  fetchThangsLikes,
  isThangsFileHost,
  isThangsLikesUrl,
  listThangsCollections,
  parseThangsCollectionUrl,
  parseThangsModelUrl,
  refreshThangsToken,
  resolveThangsModel,
  ThangsAuthError,
  ThangsBlockedError,
  ThangsDownloadLimitError,
  thangsMetaFromModel,
  ThangsPrivateCollectionError,
} from "../src/providers/thangs/api";
import { modelIdFromUrl, modelUrlFor, parseSyncSource } from "../src/services/collectionSyncService";
import { normalizeThangsSession } from "../src/providers/thangs/session";
import { buildImportSourceUrl, identifySourceModel } from "../src/services/importService";

// The Thangs client against the shapes its own site gets back, with fetch mocked. No database.

function jwt(payload: Record<string, unknown>): string {
  return `eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.c2ln`;
}

const EXP = 1792695884;
const ACCESS = jwt({ iss: "www.thangs.com", sub: "6509374", exp: EXP, username: "maker" });
const REFRESH = jwt({ iss: "www.thangs.com/api/auth/refresh-tokens", sub: "6509374", exp: 1804314692 });

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

type Call = { path: string; query: URLSearchParams; method: string; headers: Record<string, string> };

/** Answers each call by its path; records what was sent. */
function stubApi(answers: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init: RequestInit) => {
      const parsed = new URL(url);
      const call: Call = {
        path: parsed.pathname.replace(/^\/api/, ""),
        query: parsed.searchParams,
        method: init.method ?? "GET",
        headers: (init.headers ?? {}) as Record<string, string>,
      };
      calls.push(call);
      const answer = answers[call.path];
      if (!answer) throw new Error(`unexpected call ${call.path}`);
      return answer(call);
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Thangs URLs", () => {
  it("recognizes model pages, their subpages and short links", () => {
    expect(
      parseThangsModelUrl("https://thangs.com/designer/MultiBuild/3d-model/10x10%20MU%20Top%20Edge%20-%20Tile-1320962"),
    ).toEqual({ modelId: "1320962" });
    expect(
      parseThangsModelUrl(
        "https://thangs.com/prints/designer/Bathsheba/3d-model/Quintrino%20Pendant-1582292/3d-print/57288",
      ),
    ).toEqual({ modelId: "1582292" });
    expect(parseThangsModelUrl("https://thangs.com/designer/x/3d-model/1320962")).toEqual({ modelId: "1320962" });
    expect(parseThangsModelUrl("https://www.thangs.com/m/1137615")).toEqual({ modelId: "1137615" });
    expect(parseThangsModelUrl("https://thangs.com/designer/MultiBuild")).toBeNull();
    expect(parseThangsModelUrl("https://thangs.co/m/1137615")).toBeNull();
  });

  it("identifies imported models and links back to them by their short link", () => {
    const source = identifySourceModel("https://thangs.com/designer/a/3d-model/Dragon-1060509/image/7");
    expect(source).toEqual({ provider: "thangs", externalId: "1060509" });
    expect(buildImportSourceUrl("thangs", "1060509")).toBe("https://thangs.com/m/1060509");
    expect(modelIdFromUrl("thangs", modelUrlFor("thangs", "1060509"))).toBe("1060509");
  });

  it("recognizes collections and the user's likes, and syncs them", () => {
    const page = "https://thangs.com/designer/tautvydasuk/collection/Thangs%20collection-493183/sort/date?x=1";
    expect(parseThangsCollectionUrl(page)).toEqual({
      collectionId: "493183",
      url: "https://thangs.com/designer/tautvydasuk/collection/Thangs%20collection-493183",
    });
    expect(parseThangsCollectionUrl("https://thangs.com/mythangs/collections/493183")?.collectionId).toBe("493183");
    expect(parseSyncSource(page)).toEqual({
      provider: "thangs",
      externalId: "493183",
      url: "https://thangs.com/designer/tautvydasuk/collection/Thangs%20collection-493183",
    });
    expect(isThangsLikesUrl("https://thangs.com/mythangs/liked-models")).toBe(true);
    expect(parseSyncSource("https://thangs.com/mythangs/liked-models")).toEqual({
      provider: "thangs",
      externalId: "likes",
      url: "https://thangs.com/mythangs/liked-models",
    });
  });

  it("only takes files from Google Cloud Storage", () => {
    expect(isThangsFileHost("storage.googleapis.com")).toBe(true);
    expect(isThangsFileHost("storage.googleapis.com.evil.net")).toBe(false);
  });
});

describe("Thangs sign-in", () => {
  it("reads who a token is for and whether it renews others", () => {
    expect(decodeThangsJwt(ACCESS)).toEqual({
      userId: "6509374",
      username: "maker",
      expiresAt: new Date(EXP * 1000),
      refresh: false,
    });
    expect(decodeThangsJwt(REFRESH)?.refresh).toBe(true);
    expect(decodeThangsJwt(jwt({ iss: "example.com", sub: "1" }))).toBeNull();
    expect(decodeThangsJwt("not.a.token")).toBeNull();
  });

  it("takes the tokens from a Cookie header, an Authorization header or on their own", () => {
    expect(
      normalizeThangsSession(`Cookie: fp_val=x; refreshToken=${REFRESH}; ld_context=default; accessToken=${ACCESS}`),
    ).toEqual({
      token: ACCESS,
      refreshToken: REFRESH,
      userId: "6509374",
      expiresAt: new Date(EXP * 1000),
    });
    expect(normalizeThangsSession(`authorization\nBearer ${ACCESS}`)).toMatchObject({
      token: ACCESS,
      refreshToken: null,
    });
    expect(normalizeThangsSession(REFRESH)).toMatchObject({ token: null, refreshToken: REFRESH, expiresAt: null });
    // Two accounts' tokens can't be told apart from a mix-up.
    expect(normalizeThangsSession(`${ACCESS} ${jwt({ iss: "www.thangs.com", sub: "1", exp: EXP })}`)).toBeNull();
    expect(normalizeThangsSession("accessToken=undefined")).toBeNull();
  });

  it("renews the access token with the refresh token as a cookie", async () => {
    const calls = stubApi({
      "/auth/v2/refresh-tokens": () => json({ token: { expires: EXP * 1000, TOKEN: ACCESS, user: { id: "6509374" } } }),
    });
    expect(await refreshThangsToken(REFRESH)).toEqual({ token: ACCESS, expiresAt: new Date(EXP * 1000) });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers).toMatchObject({ Cookie: `refreshToken=${REFRESH}` });

    stubApi({ "/auth/v2/refresh-tokens": () => text("Unauthorized", 401) });
    await expect(refreshThangsToken(REFRESH)).rejects.toBeInstanceOf(ThangsAuthError);
  });
});

const MODEL = {
  id: "1060509",
  name: "Crystal Dragon",
  description: "**Print-in-place** dragon",
  tags: ["dragon", "articulated", "dragon"],
  category: "Toys & Games/Articulated",
  v3Categories: ["Art & Decor/Sculptures & Statues", "Toys & Games/Articulated"],
  secondaryCategory: "",
  visibility: "public",
  marketplaceInfo: null,
  owner: {
    id: 3457741,
    username: "Cinderwing3D",
    profile: {
      avatarUrl: "https://storage.googleapis.com/production-thangs-public/uploads/avatars/a",
      description: "",
    },
  },
  attachments: [
    {
      attachmentType: "image",
      isApproved: true,
      imageUrl: "https://storage.googleapis.com/p/uploads/attachments/1/Main%201.png",
    },
    { attachmentType: "video", imageUrl: "https://storage.googleapis.com/p/uploads/attachments/2/clip.mp4" },
    {
      attachmentType: "image",
      isNsfwFlagged: true,
      imageUrl: "https://storage.googleapis.com/p/uploads/attachments/3/x.png",
    },
  ],
  parts: [{ thumbnailUrl: "https://storage.googleapis.com/thangs-thumbnails/production/part.png" }],
};

describe("Thangs model details", () => {
  it("maps the details, its categories most specific first and the designer", () => {
    const resolved = thangsMetaFromModel(MODEL)!;
    expect(resolved.modelId).toBe("1060509");
    expect(resolved.access).toBe("free");
    expect(resolved.meta.title).toBe("Crystal Dragon");
    expect(resolved.meta.description).toBe("**Print-in-place** dragon");
    expect(resolved.meta.tags).toEqual(["dragon", "articulated"]);
    expect(resolved.galleryImages).toEqual([
      { url: "https://storage.googleapis.com/p/uploads/attachments/1/Main%201.png", filename: "Main 1.png" },
    ]);
    expect(resolved.meta.siteCategoryIds).toEqual([
      "Toys & Games/Articulated",
      "Art & Decor/Sculptures & Statues",
      "Toys & Games",
      "Art & Decor",
    ]);
    expect(resolved.meta.categorySite).toBe("thangs");
    expect(resolved.meta.author).toMatchObject({
      provider: "thangs",
      externalId: "3457741",
      name: "Cinderwing3D",
      links: ["https://thangs.com/designer/Cinderwing3D"],
    });
  });

  it("tells paid, membership and print-only models apart", () => {
    const paid = thangsMetaFromModel({
      ...MODEL,
      visibility: "market-paid",
      marketplaceInfo: { priceInUSD: 4, stripePriceId: "price_x" },
    })!;
    expect([paid.access, paid.price]).toEqual(["paid", 4]);
    expect(thangsMetaFromModel({ ...MODEL, visibility: "paid" })?.access).toBe("membership");
    expect(thangsMetaFromModel({ ...MODEL, visibility: "print-only" })?.access).toBe("printOnly");
    // Without photos, the parts' renders stand in.
    expect(thangsMetaFromModel({ ...MODEL, attachments: [] })?.meta.previewImageUrl).toBe(
      "https://storage.googleapis.com/thangs-thumbnails/production/part.png",
    );
  });

  it("reads a model by its id, and one that isn't there as missing", async () => {
    const calls = stubApi({ "/models/v2/1060509": () => json(MODEL) });
    expect((await resolveThangsModel("1060509"))?.meta.title).toBe("Crystal Dragon");
    expect(calls[0].headers.Authorization).toBeUndefined();

    // Thangs answers a missing or hidden model with a plain-text 403.
    stubApi({ "/models/v2/999": () => text("Forbidden", 403) });
    expect(await resolveThangsModel("999")).toBeNull();
  });
});

describe("Thangs downloads", () => {
  const SIGNED =
    "https://storage.googleapis.com/gcp-and-physna.appspot.com/uploads/models/a/b/Crystal%20Dragon.stl?X-Goog-Signature=s";

  it("gets the user's signed link, named with the file's extension", async () => {
    const calls = stubApi({
      "/v2/models/1060509/download-url": () =>
        json({ fileName: "Crystal Dragon", signedUrl: SIGNED, modelSource: 0, downloadId: 1 }),
    });
    expect(await fetchThangsDownload("1060509", ACCESS)).toEqual({ name: "Crystal Dragon.stl", url: SIGNED });
    expect(calls[0].headers).toMatchObject({ Authorization: `Bearer ${ACCESS}` });
  });

  it("tells a refused model, the daily limit, a rejected sign-in and a block apart", async () => {
    stubApi({ "/v2/models/1582292/download-url": () => text("Forbidden", 403) });
    expect(await fetchThangsDownload("1582292", ACCESS)).toBeNull();

    stubApi({ "/v2/models/1/download-url": () => json({ userDownloadData: { downloadLimitReached: true } }) });
    await expect(fetchThangsDownload("1", ACCESS)).rejects.toBeInstanceOf(ThangsDownloadLimitError);

    stubApi({ "/v2/models/1/download-url": () => text("Unauthorized", 401) });
    await expect(fetchThangsDownload("1", ACCESS)).rejects.toBeInstanceOf(ThangsAuthError);

    stubApi({
      "/v2/models/1/download-url": () =>
        new Response("<html>Just a moment...</html>", {
          status: 403,
          headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
        }),
    });
    await expect(fetchThangsDownload("1", ACCESS)).rejects.toBeInstanceOf(ThangsBlockedError);
  });
});

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Model ${id}`,
  visibility: "public",
  attachments: [{ attachmentType: "image", imageUrl: `https://storage.googleapis.com/p/${id}.png` }],
  ...extra,
});

describe("Thangs listings", () => {
  it("lists a user's likes, leaving out print-only and paid models they don't own", async () => {
    stubApi({
      "/users/v4/6509374/likes": () =>
        json({
          models: [
            item("1"),
            item("2", { visibility: "print-only" }),
            item("3", { visibility: "market-paid", marketplaceInfo: { priceInUSD: 4 } }),
            item("4", { visibility: "market-paid", marketplaceInfo: { priceInUSD: 2 } }),
            item("1"),
          ],
          folders: [],
        }),
    });
    const likes = await fetchThangsLikes("6509374", new Set(["4"]));
    expect(likes.entries.map((entry) => entry.modelId)).toEqual(["1", "4"]);
    expect(likes.entries[0]).toEqual({
      modelId: "1",
      title: "Model 1",
      cover: "https://storage.googleapis.com/p/1.png",
    });
  });

  it("pages through a collection, and tells a private one from a missing one", async () => {
    const calls = stubApi({
      "/collections/493183": (call) =>
        json({
          id: "493183",
          name: "Thangs collection",
          private: true,
          owner: { username: "tautvydasuk" },
          totalCount: 51,
          items:
            call.query.get("page") === "0" ? Array.from({ length: 50 }, (_, i) => item(String(i + 1))) : [item("51")],
        }),
    });
    const collection = await fetchThangsCollection("493183", ACCESS, new Set());
    expect(collection?.info).toEqual({
      id: "493183",
      name: "Thangs collection",
      owner: "tautvydasuk",
      private: true,
      modelCount: 51,
    });
    expect(collection?.entries).toHaveLength(51);
    expect(calls.map((call) => call.query.get("page"))).toEqual(["0", "1"]);
    expect(calls[0].query.get("isLoggedIn")).toBe("true");

    // Without a total, it pages on until a short page.
    const untold = stubApi({
      "/collections/493183": (call) =>
        json({
          id: "493183",
          name: "Thangs collection",
          items:
            call.query.get("page") === "0" ? Array.from({ length: 50 }, (_, i) => item(String(i + 1))) : [item("51")],
        }),
    });
    expect((await fetchThangsCollection("493183", ACCESS, new Set()))?.entries).toHaveLength(51);
    expect(untold).toHaveLength(2);

    stubApi({ "/collections/1": () => json({ message: "Collection is private" }, 403) });
    await expect(fetchThangsCollection("1", null, new Set())).rejects.toBeInstanceOf(ThangsPrivateCollectionError);

    stubApi({ "/collections/2": () => json({ message: "Invalid collectionId" }, 404) });
    expect(await fetchThangsCollection("2", null, new Set())).toBeNull();
  });

  it("lists the likes, then the user's own collections, on their owner's page", async () => {
    stubApi({
      "/users/v4/6509374/likes": () => json({ models: [item("1")], folders: [] }),
      "/collections": () =>
        json({
          items: [
            {
              id: "493186",
              name: "My Collection",
              private: true,
              default: true,
              owner: { username: "tautvydasuk" },
              image: "https://storage.googleapis.com/p/c.png",
              modelIds: ["973831"],
            },
          ],
        }),
    });
    const cards = await listThangsCollections("6509374", ACCESS, new Set());
    expect(cards.map((card) => [card.id, card.url, card.modelCount, card.private])).toEqual([
      ["likes", "https://thangs.com/mythangs/liked-models", 1, true],
      ["493186", "https://thangs.com/designer/tautvydasuk/collection/My%20Collection-493186", 1, true],
    ]);
  });
});
