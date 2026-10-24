import { describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db";
import {
  getCrealitycloudConnection,
  setUserCrealitycloudSession,
} from "../../src/services/crealitycloudSessionService";
import { fetchListing } from "../../src/services/collectionSyncRunner";
import { checkImportStatus } from "../../src/services/importService";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import { binary, json, loadFixture, stl, threeMf, type FetchHandler, expectStatus, assertThat } from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// Creality Cloud end to end: every call a POST to /api/cxy/... answered `{code, msg, result}`; details, profiles and
// collections need no sign-in, downloads and likes need the model_token + model_user_id pair, code 4 when it's turned
// down. Answers are the recorded shapes in fixtures/providers/crealitycloud.

const TOKEN = "0123456789abcdef".repeat(4);
const USER_ID = "4247093750";
const HEX_ID = "6ac6f004729f5ba4b3574093";
const ALIAS = "snap-clip-fidget";
const MODEL_URL = `https://www.crealitycloud.com/model-detail/${ALIAS}`;
const DESIGNER_PROFILE = "6ac6f004729f5ba4b35740a6";
const OTHER_PROFILE = "6ad5fedd23030f2e2c08899b";
const API = "/api/cxy";

type Variant = { profiles?: "none"; model?: "missing"; files?: "missing" };

function handlerFor(scenario: string, variant: Variant = {}): FetchHandler {
  return async ({ url, json: body, headers }) => {
    if (url.hostname.endsWith(".aliyuncs.com")) {
      const name = url.pathname.split("/").pop()!;
      return binary(name.endsWith(".stl") ? stl(name) : await threeMf(name));
    }
    if (!url.pathname.startsWith(API)) return undefined;
    const signedIn = headers["__cxy_token_"] === TOKEN && headers["__cxy_uid_"] === USER_ID;
    switch (url.pathname.slice(API.length)) {
      case "/v3/model/modelGroupDetail":
        // By alias or by its 24-hex id alike.
        return json(
          loadFixture(
            "crealitycloud",
            variant.model === "missing" || scenario === "missing" ? "model-missing" : "model-detail",
          ),
        );
      case "/v3/model/3mfList":
        return json(loadFixture("crealitycloud", variant.profiles === "none" ? "no-profiles" : "profiles"));
      case "/v3/model/3mfDownload": {
        assertThat(signedIn, "a profile's file is signed for the signed-in user");
        if (scenario === "rejected") return json(loadFixture("crealitycloud", "invalid-token"));
        return json(
          JSON.parse(JSON.stringify(loadFixture("crealitycloud", "profile-download")).replace("{id}", body.id)),
        );
      }
      case "/v3/model/memberDownload":
        assertThat(signedIn, "the model's files are signed for the signed-in user");
        if (scenario === "rejected") return json(loadFixture("crealitycloud", "invalid-token"));
        return json(loadFixture("crealitycloud", variant.files === "missing" ? "model-missing" : "model-files"));
      case "/v2/thematic/detail":
        return json(loadFixture("crealitycloud", scenario === "gone" ? "model-missing" : "collection-info"));
      case "/v3/collection/listCollFolderModel":
      case "/v3/model/likeListPage":
        return json(loadFixture("crealitycloud", "collection-models"));
      default:
        return undefined;
    }
  };
}

const spec: ProviderContractSpec = {
  id: "crealitycloud",
  name: "Creality Cloud",
  modelUrl: MODEL_URL,
  expected: {
    externalId: ALIAS,
    title: "Snap-Clip Fidget",
    notesIncludes: "A **fidget** toy.",
    author: "Pablo Zebari",
    tags: ["Clip", "Fidget"],
    category: { name: "3D Printer Accessories", parent: "3D Printer" },
    galleryImages: 2,
    // The designer's profile, the one a plain link brings.
    plateInstanceIds: [DESIGNER_PROFILE],
  },
  connect: async (userId) => {
    await setUserCrealitycloudSession(userId, { token: TOKEN, userId: USER_ID, expiresAt: null });
  },
  disconnect: async (userId) => {
    await setUserCrealitycloudSession(userId, null);
  },
  createHandler: (scenario) => handlerFor(scenario),
  credentials: { sessionCode: "crealitycloud_session", connection: getCrealitycloudConnection },
  reimport: {
    profile: {
      url: `${MODEL_URL}#profileId-${OTHER_PROFILE}`,
      plateInstanceIds: [DESIGNER_PROFILE, OTHER_PROFILE],
    },
  },
  list: {
    endpoint: "/api/import/crealitycloud-list/entries",
    url: "https://www.crealitycloud.com/collection/3d-model-collection-gQVJSX?isUserUpload=true",
    title: "Fidgets",
    importedId: ALIAS,
    freshId: "ghost-ship-sliced",
  },
  // Collections list without a sign-in; only the user's likes ("likes-<id>") need one.
  listing: {
    sync: {
      externalId: "3d-model-collection-gQVJSX",
      sourceUrl: "https://www.crealitycloud.com/collection/3d-model-collection-gQVJSX",
    },
    ids: [ALIAS, "ghost-ship-sliced"],
    needsSignIn: false,
  },
};

const ctx = describeProviderContract(spec);

describe("Creality Cloud specifics", () => {
  // importService.ts importCrealitycloudModel: "A link by id is kept under the model's alias, the id the site's own links
  // have."
  describe("alias re-key", () => {
    it("keeps a model linked by its 24-hex id under its alias", async () => {
      await spec.connect(ctx.userId);
      const stub = ctx.stub("ok");
      const res = await ctx.importUrl(`https://www.crealitycloud.com/model-detail/${HEX_ID}`);
      expectStatus(res, 200);
      expect(res.body.import_outcome).toBe("created");
      const prints = await ctx.prints();
      expect(prints.map((print) => print.sourceExternalId)).toEqual([ALIAS]);
      // The details were asked for by the id the link carried.
      const detail = stub.calls.find((call) => call.url.pathname.endsWith("/modelGroupDetail"));
      expect(detail?.json).toEqual({ id: HEX_ID });
    });

    it("finds the print again by id: a second import of that link asks for the details only, never the files", async () => {
      await spec.connect(ctx.userId);
      ctx.stub("ok");
      await ctx.importUrl(`https://www.crealitycloud.com/model-detail/${HEX_ID}`);

      const again = ctx.stub("ok");
      const res = await ctx.importUrl(`https://www.crealitycloud.com/model-detail/${HEX_ID}`);
      expectStatus(res, 200);
      expect(res.body.import_outcome).toBe("already_imported");
      expect(await ctx.prints()).toHaveLength(1);
      // Unlike a link by alias (nothing asked), the id has to be resolved to the alias first.
      expect(again.calls.map((call) => call.url.pathname.replace(API, ""))).toEqual([
        "/v3/model/modelGroupDetail",
        "/v3/model/3mfList",
      ]);
    });

    it("adds a profile through the id link, and a link by alias afterwards is already imported", async () => {
      await spec.connect(ctx.userId);
      ctx.stub("ok");
      await ctx.importUrl(`https://www.crealitycloud.com/model-detail/${HEX_ID}`);
      ctx.stub("ok");
      const added = await ctx.importUrl(
        `https://www.crealitycloud.com/model-detail/${HEX_ID}#profileId-${OTHER_PROFILE}`,
      );
      expect(added.body.import_outcome).toBe("profile_added");
      const plates = await prisma.plate.findMany({ where: { printId: (await ctx.prints())[0].id } });
      expect(plates.map((plate) => plate.sourceInstanceId).toSorted()).toEqual([DESIGNER_PROFILE, OTHER_PROFILE]);

      const none = ctx.stub("ok");
      const again = await ctx.importUrl(MODEL_URL);
      expect(again.body.import_outcome).toBe("already_imported");
      expect(none.calls).toHaveLength(0);
    });

    it("finds the print kept under the alias by the import status of its id link", async () => {
      await spec.connect(ctx.userId);
      ctx.stub("ok");
      await ctx.importUrl(`https://www.crealitycloud.com/model-detail/${HEX_ID}`);
      const byAlias = await checkImportStatus(ctx.userId, MODEL_URL);
      expect(byAlias).toMatchObject({ recognized: true, already_imported: true });
      const byId = await checkImportStatus(ctx.userId, `https://www.crealitycloud.com/model-detail/${HEX_ID}`);
      expect(byId).toMatchObject({ recognized: true, already_imported: true });
    });
  });

  it("brings the model's own files, untagged, when it has no print profiles", async () => {
    await spec.connect(ctx.userId);
    const stub = ctx.install(handlerFor("ok", { profiles: "none" }));
    const res = await ctx.importUrl();
    expectStatus(res, 200);
    const [print] = await ctx.prints();
    const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
    // Creality Cloud names files without an extension; the signed link's gives it.
    expect(plates.map((plate) => [plate.sourceInstanceId, plate.filename])).toEqual([
      [null, "fidget.stl"],
      [null, "fidget base.stl"],
    ]);
    expect(stub.calls.some((call) => call.url.pathname.endsWith("/3mfDownload"))).toBe(false);
  });

  it("answers a model it can't find with 404, and files that are gone too", async () => {
    await spec.connect(ctx.userId);
    ctx.install(handlerFor("ok", { model: "missing" }));
    expect((await ctx.importUrl()).status).toBe(404);
    ctx.install(handlerFor("ok", { profiles: "none", files: "missing" }));
    const res = await ctx.importUrl();
    expect(res.status).toBe(404);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("refuses without a sign-in before asking Creality Cloud anything", async () => {
    await spec.disconnect(ctx.userId);
    const stub = ctx.stub("ok");
    const res = await ctx.importUrl();
    expect(res.status).toBe(400);
    expect(stub.calls).toHaveLength(0);
  });

  describe("lists", () => {
    it("reads a collection without a sign-in, leaving out models no longer shared", async () => {
      await spec.disconnect(ctx.userId);
      ctx.stub("list");
      const res = await ctx.post(spec.list!.endpoint, { url: spec.list!.url });
      expectStatus(res, 200);
      expect(res.body.entries.map((entry: { design_id: string }) => entry.design_id)).toEqual([
        ALIAS,
        "ghost-ship-sliced",
      ]);
    });

    it("reads the user's own likes with their sign-in, and nobody else's", async () => {
      const likes = `https://www.crealitycloud.com/user/${USER_ID}/likes`;
      await spec.disconnect(ctx.userId);
      ctx.stub("list");
      const signedOut = await ctx.post(spec.list!.endpoint, { url: likes });
      expect(signedOut.status).toBe(400);
      expect(signedOut.body.code).toBe("crealitycloud_session");

      await spec.connect(ctx.userId);
      const mine = await ctx.post(spec.list!.endpoint, { url: likes });
      expectStatus(mine, 200);
      expect(mine.body.title).toBe("Creality Cloud likes");

      const theirs = await ctx.post(spec.list!.endpoint, { url: "https://www.crealitycloud.com/user/999/likes" });
      expect(theirs.status).toBe(400);
      expect(theirs.body.detail).toMatch(/only your own/);
    });
  });

  describe("collection sync of the user's likes", () => {
    const likes = (id = USER_ID) => ({
      userId: ctx.userId,
      provider: "crealitycloud",
      externalId: `likes-${id}`,
      sourceUrl: `https://www.crealitycloud.com/user/${id}/likes`,
    });

    it("reads them with the user's sign-in", async () => {
      await spec.connect(ctx.userId);
      ctx.stub("list");
      expect(await fetchListing(likes())).toEqual([ALIAS, "ghost-ship-sliced"]);
    });

    it("waits (throws) without a sign-in, and when the sign-in is another account's", async () => {
      await spec.disconnect(ctx.userId);
      ctx.stub("list");
      await expect(fetchListing(likes())).rejects.toThrow(/Creality Cloud/);
      await spec.connect(ctx.userId);
      await expect(fetchListing(likes("999"))).rejects.toThrow(/Creality Cloud/);
    });
  });
});
