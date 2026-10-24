import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkCrealitycloudAuth,
  crealitycloudMetaFromDetail,
  CrealitycloudAuthError,
  fetchCrealitycloudCollection,
  fetchCrealitycloudLikes,
  fetchCrealitycloudModelFiles,
  isCrealitycloudFileHost,
  parseCrealitycloudCollectionUrl,
  parseCrealitycloudLikesUrl,
  parseCrealitycloudModelUrl,
  resolveCrealitycloudModel,
  selectCrealitycloudProfiles,
} from "../src/providers/crealitycloud/api";
import { modelIdFromUrl, modelUrlFor, parseSyncSource } from "../src/services/collectionSyncService";
import { normalizeCrealitycloudSession } from "../src/providers/crealitycloud/session";
import { buildImportSourceUrl, identifySourceModel } from "../src/services/importService";

// The Creality Cloud client against the shapes its own site gets back, with fetch mocked. No database.

const TOKEN = "0123456789abcdef".repeat(4);
const USER_ID = "1000000001";
const AUTH = { token: TOKEN, userId: USER_ID };

function apiResponse(code: number, result: unknown = {}, msg = "ok"): Response {
  return new Response(JSON.stringify({ code, msg, reqId: "r", result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Answers each call by its path; records what was sent. */
function stubApi(answers: Record<string, (body: Record<string, unknown>) => Response>) {
  const calls: { path: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname.replace(/^\/api\/cxy/, "");
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ path, body, headers: init.headers as Record<string, string> });
      const answer = answers[path];
      if (!answer) throw new Error(`unexpected call ${path}`);
      return answer(body);
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Creality Cloud URLs", () => {
  it("recognizes model pages by alias or id, with a language prefix and a picked print profile", () => {
    expect(
      parseCrealitycloudModelUrl("https://www.crealitycloud.com/model-detail/snap-clip-fidget-small-size"),
    ).toEqual({ modelId: "snap-clip-fidget-small-size", requestedProfileId: null });
    expect(
      parseCrealitycloudModelUrl(
        "https://crealitycloud.com/de/model-detail/Ghost-Ship-Sliced#profileId-6AC6F004729F5BA4B35740A6",
      ),
    ).toEqual({ modelId: "ghost-ship-sliced", requestedProfileId: "6ac6f004729f5ba4b35740a6" });
    expect(parseCrealitycloudModelUrl("https://www.crealitycloud.com/model-detail/6ac6f004729f5ba4b3574093")).toEqual({
      modelId: "6ac6f004729f5ba4b3574093",
      requestedProfileId: null,
    });
    expect(parseCrealitycloudModelUrl("https://www.crealitycloud.com/models")).toBeNull();
    expect(parseCrealitycloudModelUrl("https://www.crealitycloud.co/model-detail/a")).toBeNull();
  });

  it("recognizes collections and the user's likes, and syncs both", () => {
    const collection =
      "https://www.crealitycloud.com/collection/3d-model-collection-gQVJSX?isUserUpload=true&from=favorites-folder";
    expect(parseCrealitycloudCollectionUrl(collection)).toEqual({ collectionId: "3d-model-collection-gQVJSX" });
    expect(parseSyncSource(collection)).toEqual({
      provider: "crealitycloud",
      externalId: "3d-model-collection-gQVJSX",
      url: "https://www.crealitycloud.com/collection/3d-model-collection-gQVJSX",
    });
    // The store's own collections aren't models.
    expect(parseCrealitycloudCollectionUrl("https://www.crealitycloud.com/collections/materials")).toBeNull();
    const likes = `https://www.crealitycloud.com/user/${USER_ID}/likes`;
    expect(parseCrealitycloudLikesUrl(likes)).toEqual({ userId: USER_ID });
    expect(parseSyncSource(likes)).toEqual({ provider: "crealitycloud", externalId: `likes-${USER_ID}`, url: likes });
  });

  it("identifies imported models and links back to them", () => {
    const source = identifySourceModel("https://www.crealitycloud.com/model-detail/ghost-ship-sliced");
    expect(source).toEqual({ provider: "crealitycloud", externalId: "ghost-ship-sliced" });
    expect(buildImportSourceUrl("crealitycloud", "ghost-ship-sliced")).toBe(
      "https://www.crealitycloud.com/model-detail/ghost-ship-sliced",
    );
    expect(modelIdFromUrl("crealitycloud", modelUrlFor("crealitycloud", "ghost-ship-sliced"))).toBe(
      "ghost-ship-sliced",
    );
  });

  it("only takes signed files from Creality Cloud's OSS buckets", () => {
    expect(isCrealitycloudFileHost("internal-creality-usa.oss-us-east-1.aliyuncs.com")).toBe(true);
    expect(isCrealitycloudFileHost("aliyuncs.com.evil.net")).toBe(false);
    expect(isCrealitycloudFileHost("evil.example.com")).toBe(false);
  });
});

describe("Creality Cloud sign-in", () => {
  it("takes the token and user id from a Cookie header, or from copied request headers", () => {
    expect(
      normalizeCrealitycloudSession(`Cookie: model_lang=0; model_token=${TOKEN}; model_user_id=${USER_ID}; x=1`),
    ).toEqual({ ...AUTH, expiresAt: null });
    expect(normalizeCrealitycloudSession(`__cxy_token_\n${TOKEN}\n__cxy_uid_\n${USER_ID}`)).toEqual({
      ...AUTH,
      expiresAt: null,
    });
    expect(normalizeCrealitycloudSession(`__cxy_token_: ${TOKEN}\n__cxy_uid_: ${USER_ID}`)).toMatchObject(AUTH);
  });

  it("refuses a token without its user id, or anything else", () => {
    expect(normalizeCrealitycloudSession(TOKEN)).toBeNull();
    expect(normalizeCrealitycloudSession(`model_token=${TOKEN}`)).toBeNull();
    expect(normalizeCrealitycloudSession("model_token=not-a-token; model_user_id=1")).toBeNull();
    expect(normalizeCrealitycloudSession("")).toBeNull();
  });

  it("sends the site's whole header set, the sign-in included, and tells a rejected sign-in apart", async () => {
    const calls = stubApi({
      "/v3/user/getInfo": () =>
        apiResponse(0, { profileUserInfo: { base: { userId: Number(USER_ID), nickName: "Maker" } } }),
    });
    expect(await checkCrealitycloudAuth(AUTH)).toEqual({ userId: USER_ID, name: "Maker" });
    expect(calls[0].headers).toMatchObject({
      __cxy_token_: TOKEN,
      __cxy_uid_: USER_ID,
      __cxy_app_id_: "cxy-gen2",
      __cxy_os_ver_: expect.any(String),
      __cxy_app_ch_: expect.any(String),
    });

    stubApi({ "/v3/user/getInfo": () => apiResponse(4, null, "Invalid Token") });
    expect(await checkCrealitycloudAuth(AUTH)).toBe("rejected");
  });
});

const GROUP_ITEM = {
  id: "6ac6f004729f5ba4b3574093",
  urlAlias: "snap-clip-fidget",
  groupName: "Snap-Clip Fidget",
  groupDesc: "<p>A <strong>fidget</strong> toy.</p>",
  categoryId: "6007",
  categories: [
    { id: "6007", name: "Other" },
    { id: "1809", name: "Toys & Games" },
  ],
  tags: [{ name: "clip" }, { name: "fidget" }, { name: "clip" }],
  covers: [
    { url: "https://pic2-cdn.creality.com/crealityCloud/common/cover.webp" },
    { url: "https://pic2-cdn.creality.com/pic/second.png" },
  ],
  userInfo: { userId: 4247093750, nickName: "Pablo Zebari", avatar: "https://pic2-cdn.creality.com/avatar/a" },
};

const PROFILES = [
  {
    id: "6ac6f004729f5ba4b35740a6",
    secondName: "0.2mm layer, 2 walls",
    printerName: "Ender-3 V3 Plus",
    isAuth: true,
    covers: [{ url: "https://pic2-cdn.creality.com/crealityCloud/upload/profile.webp" }],
    thumbnail: "https://pic2-cdn.creality.com/pic/plate.png",
    userInfo: { userId: 4247093750 },
  },
  {
    id: "6ad5fedd23030f2e2c08899b",
    secondName: "0.16mm layer",
    printerName: "SPARKX i7",
    isAuth: false,
    thumbnail: "https://pic2-cdn.creality.com/pic/other-plate.png",
    userInfo: { userId: 4055423748 },
  },
];

describe("Creality Cloud model details", () => {
  it("maps the details, the category most specific first and the designer", () => {
    const resolved = crealitycloudMetaFromDetail(GROUP_ITEM, PROFILES)!;
    expect(resolved.groupId).toBe("6ac6f004729f5ba4b3574093");
    expect(resolved.alias).toBe("snap-clip-fidget");
    expect(resolved.meta.title).toBe("Snap-Clip Fidget");
    expect(resolved.meta.description).toBe("A **fidget** toy.");
    expect(resolved.meta.tags).toEqual(["clip", "fidget"]);
    expect(resolved.meta.previewImageUrl).toBe("https://pic2-cdn.creality.com/crealityCloud/common/cover.webp");
    expect(resolved.galleryImages.map((image) => image.filename)).toEqual(["cover.webp", "second.png"]);
    expect(resolved.meta.siteCategoryIds).toEqual([6007, 1809]);
    expect(resolved.meta.categorySite).toBe("crealitycloud");
    expect(resolved.meta.author).toMatchObject({
      provider: "crealitycloud",
      externalId: "4247093750",
      name: "Pablo Zebari",
      links: ["https://www.crealitycloud.com/user/4247093750"],
    });
    expect(resolved.profiles.map((p) => [p.title, p.designers])).toEqual([
      ["0.2mm layer, 2 walls (Ender-3 V3 Plus)", true],
      ["0.16mm layer (SPARKX i7)", false],
    ]);
    // A profile's own picture, else its plate's render.
    expect(resolved.profiles.map((p) => p.coverUrl)).toEqual([
      "https://pic2-cdn.creality.com/crealityCloud/upload/profile.webp",
      "https://pic2-cdn.creality.com/pic/other-plate.png",
    ]);
  });

  it("picks profiles like MakerWorld", () => {
    const resolved = crealitycloudMetaFromDetail(GROUP_ITEM, PROFILES)!;
    expect(selectCrealitycloudProfiles(resolved, "url", null)).toEqual(["6ac6f004729f5ba4b35740a6"]);
    expect(selectCrealitycloudProfiles(resolved, "url", "6ad5fedd23030f2e2c08899b")).toEqual([
      "6ad5fedd23030f2e2c08899b",
    ]);
    expect(selectCrealitycloudProfiles(resolved, "designer", null)).toEqual(["6ac6f004729f5ba4b35740a6"]);
    expect(selectCrealitycloudProfiles(resolved, "all", null)).toHaveLength(2);
    expect(selectCrealitycloudProfiles(crealitycloudMetaFromDetail(GROUP_ITEM)!, "url", null)).toEqual([]);
  });

  it("reads a model and its profiles, and a deleted or private one as missing", async () => {
    const calls = stubApi({
      "/v3/model/modelGroupDetail": () => apiResponse(0, { groupItem: GROUP_ITEM, modelList: [] }),
      "/v3/model/3mfList": () => apiResponse(0, { list: PROFILES, count: 2 }),
    });
    const resolved = await resolveCrealitycloudModel("snap-clip-fidget");
    expect(resolved?.profiles).toHaveLength(2);
    expect(calls[1].body).toMatchObject({ modelGroupId: "6ac6f004729f5ba4b3574093", filterType: 11 });

    for (const code of [512, 513, 517]) {
      stubApi({ "/v3/model/modelGroupDetail": () => apiResponse(code, null, "The model has been deleted") });
      expect(await resolveCrealitycloudModel("gone")).toBeNull();
    }
    stubApi({ "/v3/model/modelGroupDetail": () => apiResponse(2, null, "System Error") });
    await expect(resolveCrealitycloudModel("broken")).rejects.toThrow("System Error");
  });

  it("names the model's files with the extension their signed link has", async () => {
    stubApi({
      "/v3/model/memberDownload": () =>
        apiResponse(0, {
          downloadUrls: [
            {
              fileName: "Snap-Clip Fidget - 6 Arms",
              url: "https://internal-creality-usa.oss-us-east-1.aliyuncs.com/model%2Fb528.stl?Expires=1&Signature=x",
            },
          ],
        }),
    });
    expect(await fetchCrealitycloudModelFiles("6ac6f004729f5ba4b3574093", AUTH)).toEqual([
      {
        name: "Snap-Clip Fidget - 6 Arms.stl",
        url: "https://internal-creality-usa.oss-us-east-1.aliyuncs.com/model%2Fb528.stl?Expires=1&Signature=x",
      },
    ]);

    stubApi({ "/v3/model/memberDownload": () => apiResponse(4, null, "Invalid Token") });
    await expect(fetchCrealitycloudModelFiles("6ac6f004729f5ba4b3574093", AUTH)).rejects.toBeInstanceOf(
      CrealitycloudAuthError,
    );
  });
});

describe("Creality Cloud lists", () => {
  it("pages through the user's likes, keeping models by alias", async () => {
    const item = (n: number) => ({
      id: `6ace88accc5a1c53dfe1e${String(n).padStart(3, "0")}`,
      urlAlias: `model-${n}`,
      groupName: `Model ${n}`,
      covers: [{ url: `https://pic2-cdn.creality.com/${n}.webp` }],
    });
    const calls = stubApi({
      "/v3/model/likeListPage": (body) =>
        apiResponse(0, {
          count: 30,
          list: Array.from({ length: body.page === 1 ? 24 : 6 }, (_, i) => item((Number(body.page) - 1) * 24 + i)),
        }),
    });
    const likes = await fetchCrealitycloudLikes(AUTH);
    expect(likes.total).toBe(30);
    expect(likes.entries).toHaveLength(30);
    expect(likes.entries[0]).toEqual({
      modelId: "model-0",
      title: "Model 0",
      cover: "https://pic2-cdn.creality.com/0.webp",
    });
    expect(calls.map((call) => call.body.page)).toEqual([1, 2]);
  });

  it("reads a collection by its alias, through its folder id", async () => {
    const calls = stubApi({
      "/v2/thematic/detail": () =>
        apiResponse(0, {
          id: "6ad5fb7d6418247fd75f3f3c",
          customizationUrl: "3d-model-collection-gQVJSX",
          thematicName: "Test",
          creator: Number(USER_ID),
          isPublic: true,
          modelQuantity: 1,
        }),
      "/v3/collection/listCollFolderModel": () =>
        apiResponse(0, { count: 1, list: [{ id: "6a60842144eb4483e2202bed", urlAlias: "original-benchy" }] }),
    });
    const collection = await fetchCrealitycloudCollection("3d-model-collection-gQVJSX");
    expect(collection?.info).toMatchObject({ name: "Test", folderId: "6ad5fb7d6418247fd75f3f3c", private: false });
    expect(collection?.entries.map((entry) => entry.modelId)).toEqual(["original-benchy"]);
    expect(calls[1].body).toMatchObject({ folderId: "6ad5fb7d6418247fd75f3f3c" });

    stubApi({ "/v2/thematic/detail": () => apiResponse(517, null, "The item does not exist") });
    expect(await fetchCrealitycloudCollection("gone")).toBeNull();
  });
});
