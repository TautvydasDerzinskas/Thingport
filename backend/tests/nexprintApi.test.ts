import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkNexprintAuth,
  fetchNexprintCollection,
  fetchNexprintModelFiles,
  fetchNexprintProfileFile,
  isNexprintFileHost,
  listNexprintCollections,
  nexprintMetaFromDetail,
  NexprintAuthError,
  parseNexprintCollectionUrl,
  parseNexprintModelUrl,
  resolveNexprintModel,
  selectNexprintProfiles,
} from "../src/providers/nexprint/api";
import { modelIdFromUrl, modelUrlFor, parseSyncSource } from "../src/services/collectionSyncService";
import { normalizeNexprintSession } from "../src/providers/nexprint/session";
import { buildImportSourceUrl, identifySourceModel } from "../src/services/importService";

// The NexPrint client against the shapes its own site gets back, with fetch mocked. No database.

const TOKEN = "513a1971690b4f2985177303998a1a9f";

function apiResponse(code: number, data: unknown = null, msg = ""): Response {
  return new Response(JSON.stringify({ code, data, msg, traceId: "t" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

type Call = { path: string; query: URLSearchParams; method: string; body: unknown; headers: Record<string, string> };

/** Answers each call by its path; records what was sent. */
function stubApi(answers: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init: RequestInit) => {
      const parsed = new URL(url);
      const call: Call = {
        path: parsed.pathname.replace(/^\/gateway\/api\/v1/, ""),
        query: parsed.searchParams,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        headers: init.headers as Record<string, string>,
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

describe("NexPrint URLs", () => {
  it("recognizes model pages, with the print profile the site's own links name", () => {
    expect(parseNexprintModelUrl("https://www.nexprint.com/en/models/G1215164?printConfigId=G6354239")).toEqual({
      modelId: "G1215164",
      requestedProfileId: "G6354239",
    });
    expect(parseNexprintModelUrl("https://nexprint.com/models/g1215164")).toEqual({
      modelId: "G1215164",
      requestedProfileId: null,
    });
    // Thingport's own profile marker wins over the page's.
    expect(
      parseNexprintModelUrl("https://www.nexprint.com/de/models/G1215164?printConfigId=G1#profileId-G6354239"),
    ).toMatchObject({ requestedProfileId: "G6354239" });
    expect(parseNexprintModelUrl("https://www.nexprint.com/en/models")).toBeNull();
    expect(parseNexprintModelUrl("https://www.nexprint.co/en/models/G1")).toBeNull();
  });

  it("recognizes collections on their owner's page or on their own, and syncs them", () => {
    const home =
      "https://www.nexprint.com/en/U0092359913/home?component=UserCollect&subComp=UserCollectDetail&collectionId=G10199482";
    expect(parseNexprintCollectionUrl(home)).toEqual({ collectionId: "G10199482", ownerId: "U0092359913" });
    expect(parseSyncSource(home)).toEqual({ provider: "nexprint", externalId: "G10199482", url: home });
    expect(parseNexprintCollectionUrl("https://www.nexprint.com/en/collection/G10199482")).toEqual({
      collectionId: "G10199482",
      ownerId: null,
    });
    // The user's page without a collection open isn't one.
    expect(parseNexprintCollectionUrl("https://www.nexprint.com/en/U0092359913/home")).toBeNull();
  });

  it("identifies imported models and links back to them", () => {
    const source = identifySourceModel("https://www.nexprint.com/en/models/G1215164?printConfigId=G6354239");
    expect(source).toEqual({ provider: "nexprint", externalId: "G1215164" });
    expect(buildImportSourceUrl("nexprint", "G1215164")).toBe("https://www.nexprint.com/en/models/G1215164");
    expect(modelIdFromUrl("nexprint", modelUrlFor("nexprint", "G1215164"))).toBe("G1215164");
  });

  it("only takes signed files from NexPrint's OSS bucket", () => {
    expect(isNexprintFileHost("nexprint.oss-eu-central-1.aliyuncs.com")).toBe(true);
    expect(isNexprintFileHost("aliyuncs.com.evil.net")).toBe(false);
  });
});

describe("NexPrint sign-in", () => {
  it("takes the token from a Cookie header, an Authorization header or on its own", () => {
    expect(normalizeNexprintSession(`Cookie: i18n_redirected=en; auth_token=${TOKEN}; ORIGIN=Nexprint`)).toEqual({
      token: TOKEN,
      expiresAt: null,
    });
    expect(normalizeNexprintSession(`authorization: Bearer ${TOKEN}`)?.token).toBe(TOKEN);
    expect(normalizeNexprintSession(TOKEN)?.token).toBe(TOKEN);
    expect(normalizeNexprintSession("auth_token=undefined")).toBeNull();
    expect(normalizeNexprintSession("")).toBeNull();
  });

  it("sends it as a Bearer token, and tells a rejected one apart", async () => {
    const calls = stubApi({
      "/model-user-server/member/user_data": () =>
        apiResponse(0, { userData: { userId: "U0092359913", nickname: "Tautvydas" } }),
    });
    expect(await checkNexprintAuth(TOKEN)).toEqual({ userId: "U0092359913", name: "Tautvydas" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, "client-id": "Nexprint" });

    stubApi({ "/model-user-server/member/user_data": () => apiResponse(401, null, "账号未登录") });
    expect(await checkNexprintAuth(TOKEN)).toBe("rejected");

    // Its own trouble isn't the token's fault.
    stubApi({ "/model-user-server/member/user_data": () => apiResponse(500, null, "系统繁忙") });
    expect(await checkNexprintAuth(TOKEN)).toBe("unreachable");
  });
});

const PROFILE_FILE = { fileId: "2109986422412034048", fileName: "Dog.3mf", fileExt: null };

const DETAIL = {
  id: "2109988470143172608",
  modelId: "G1215164",
  modelName: "Dog",
  modelDetail: "<p>A <strong>crochet</strong> dog.</p>",
  coverImgUrl: "https://np.nexprint.com/images/1/cover.png",
  modelPicList: [
    { fileUrl: "https://np.nexprint.com/images/1/cover.png" },
    { fileUrl: "https://np.nexprint.com/images/1/side.jpg" },
  ],
  modelTagList: ["dog", "amigurumi", "dog"],
  classificationId: 1422473859006464,
  classificationInfos: [
    { id: 1422473858908160, classificationName: "Toys & Games", level: 1, pid: null },
    { id: 1422473859006464, classificationName: "Miniature Model", level: 2, pid: 1422473858908160 },
  ],
  authorId: "2109966715818881024",
  author: { userId: "U0030208991", nickname: "Cute Animals", avatarUrl: "https://np.nexprint.com/images/a.png" },
  // The profile's 3MF appears twice more among the model's own files.
  modelFileList: [
    { ...PROFILE_FILE, fileExt: "3mf" },
    PROFILE_FILE,
    { fileId: "2109986422412034999", fileName: "Dog.stl", fileExt: "stl" },
  ],
  settingInfoList: [
    {
      id: "2109988470411608064",
      settingOutId: "G6354239",
      settingName: "0.2mm layer, 2 walls, 15% infill",
      settingCoverImgUrl: "https://np.nexprint.com/images/1/profile.png",
      userId: "2109966715818881024",
      isCreator: true,
      open: true,
      settingFile: PROFILE_FILE,
    },
    {
      id: "2109988470411608999",
      settingOutId: "G6354240",
      settingName: "0.12mm fine",
      userId: "1",
      isCreator: false,
      open: true,
      settingFile: { fileId: "2109986422412035000", fileName: "Dog fine.3mf" },
    },
  ],
};

describe("NexPrint model details", () => {
  it("maps the details, the category most specific first and the designer", () => {
    const resolved = nexprintMetaFromDetail(DETAIL)!;
    expect(resolved.modelId).toBe("G1215164");
    expect(resolved.internalId).toBe("2109988470143172608");
    expect(resolved.meta.title).toBe("Dog");
    expect(resolved.meta.description).toBe("A **crochet** dog.");
    expect(resolved.meta.tags).toEqual(["dog", "amigurumi"]);
    expect(resolved.galleryImages.map((image) => image.filename)).toEqual(["cover.png", "side.jpg"]);
    expect(resolved.meta.siteCategoryIds).toEqual([1422473859006464, 1422473858908160]);
    expect(resolved.meta.categorySite).toBe("nexprint");
    expect(resolved.meta.author).toMatchObject({
      provider: "nexprint",
      externalId: "U0030208991",
      name: "Cute Animals",
      links: ["https://www.nexprint.com/en/U0030208991/home"],
    });
    expect(resolved.profiles.map((p) => [p.id, p.designers, p.coverUrl])).toEqual([
      ["G6354239", true, "https://np.nexprint.com/images/1/profile.png"],
      ["G6354240", false, null],
    ]);
    // The profile's 3MF isn't counted again as a model file.
    expect(resolved.files).toEqual([{ fileId: "2109986422412034999", name: "Dog.stl" }]);
  });

  it("picks profiles like MakerWorld", () => {
    const resolved = nexprintMetaFromDetail(DETAIL)!;
    expect(selectNexprintProfiles(resolved, "url", null)).toEqual(["G6354239"]);
    expect(selectNexprintProfiles(resolved, "url", "G6354240")).toEqual(["G6354240"]);
    expect(selectNexprintProfiles(resolved, "designer", null)).toEqual(["G6354239"]);
    expect(selectNexprintProfiles(resolved, "all", null)).toHaveLength(2);
  });

  it("reads a model by its id, and one that isn't there as missing", async () => {
    const calls = stubApi({ "/model-library-server/model-base-info/get": () => apiResponse(0, DETAIL) });
    expect((await resolveNexprintModel("G1215164"))?.profiles).toHaveLength(2);
    expect(calls[0].query.get("id")).toBe("G1215164");
    expect(calls[0].query.get("loadSupportPrintProfile")).toBe("true");

    // NexPrint answers a missing model with one whose every field is null.
    stubApi({ "/model-library-server/model-base-info/get": () => apiResponse(0, { id: null, modelId: null }) });
    expect(await resolveNexprintModel("G9999999")).toBeNull();
  });

  it("signs a profile's 3MF and the model's own files as the user", async () => {
    const resolved = nexprintMetaFromDetail(DETAIL)!;
    const calls = stubApi({
      "/model-library-server/common/presigned-download-url": (call) => {
        const [file] = (call.body as { fileInfoList: { fileId: string }[] }).fileInfoList;
        return apiResponse(0, {
          fileInfoList: [
            {
              fileId: file.fileId,
              resultUrl: `https://nexprint.oss-eu-central-1.aliyuncs.com/models/x.3mf?X-Amz-Signature=s`,
            },
          ],
        });
      },
    });
    expect(await fetchNexprintProfileFile(resolved.profiles[0], TOKEN)).toEqual({
      name: "0.2mm layer, 2 walls, 15% infill.3mf",
      url: "https://nexprint.oss-eu-central-1.aliyuncs.com/models/x.3mf?X-Amz-Signature=s",
    });
    expect(calls[0].body).toEqual({
      fileInfoList: [{ fileId: "2109986422412034048", type: "5", bizId: "2109988470411608064" }],
    });
    expect(calls[0].headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });

    await fetchNexprintModelFiles(resolved, TOKEN);
    expect(calls[1].body).toEqual({
      fileInfoList: [{ fileId: "2109986422412034999", type: "2", bizId: "2109988470143172608" }],
    });

    stubApi({ "/model-library-server/common/presigned-download-url": () => apiResponse(401, null, "账号未登录") });
    await expect(fetchNexprintProfileFile(resolved.profiles[0], TOKEN)).rejects.toBeInstanceOf(NexprintAuthError);
  });
});

const COLLECTION = {
  id: "2112058171795062784",
  collectOutId: "G10199482",
  collectionName: "Test collection",
  collectionOpenStatus: false,
  countNum: 2,
  author: { userId: "U0092359913", nickname: "Tautvydas" },
};

describe("NexPrint collections", () => {
  it("reads a collection by its id, leaving out models no longer shared", async () => {
    const calls = stubApi({
      "/model-library-server/model-collection/G10199482": () => apiResponse(0, COLLECTION),
      "/model-library-server/model-collection/G10199482/model/page": () =>
        apiResponse(0, {
          total: 2,
          list: [
            { modelId: "G6213245", modelName: "CC2 profiles", coverImgUrl: "https://np.nexprint.com/images/c.png" },
            { modelId: "G1215164", modelName: "Gone", isInvalid: true },
          ],
        }),
    });
    const collection = await fetchNexprintCollection("G10199482");
    expect(collection?.info).toEqual({
      id: "G10199482",
      name: "Test collection",
      ownerId: "U0092359913",
      private: true,
      modelCount: 2,
    });
    expect(collection?.entries).toEqual([
      { modelId: "G6213245", title: "CC2 profiles", cover: "https://np.nexprint.com/images/c.png" },
    ]);
    expect(calls[1].query.get("pageNo")).toBe("1");

    stubApi({ "/model-library-server/model-collection/G1": () => apiResponse(0, null) });
    expect(await fetchNexprintCollection("G1")).toBeNull();
  });

  it("lists the user's own collections, on their page, with their first models' covers", async () => {
    stubApi({
      "/model-library-server/model-collection/list": () =>
        apiResponse(0, [
          COLLECTION,
          { ...COLLECTION, collectOutId: "G10199480", collectionName: "Empty", countNum: 0 },
        ]),
      "/model-library-server/model-collection/G10199482/model/page": (call) => {
        expect(call.query.get("pageSize")).toBe("4");
        return apiResponse(0, { total: 1, list: [{ modelId: "G1", coverImgUrl: "https://np.nexprint.com/1.png" }] });
      },
    });
    const cards = await listNexprintCollections(TOKEN);
    expect(cards.map((card) => [card.id, card.thumbnails, card.private])).toEqual([
      ["G10199482", ["https://np.nexprint.com/1.png"], true],
      ["G10199480", [], true],
    ]);
    expect(cards[0].url).toBe(
      "https://www.nexprint.com/en/U0092359913/home?component=UserCollect&subComp=UserCollectDetail&collectionId=G10199482",
    );
  });
});
