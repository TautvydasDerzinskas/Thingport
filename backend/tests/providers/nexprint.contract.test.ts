import { describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db";
import { getNexprintConnection, setUserNexprintSession } from "../../src/providers/nexprint/session";
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

// NexPrint end to end: details and collections need no sign-in; files are signed for the user's bearer token, 401 in the
// body when it's turned down. Answers are the recorded shapes in fixtures/providers/nexprint.

const TOKEN = "513a1971690b4f2985177303998a1a9f";
const GATEWAY = "/gateway/api/v1";
const MODEL_URL = "https://www.nexprint.com/en/models/G1215164";
const COLLECTION_URL =
  "https://www.nexprint.com/en/U0092359913/home?component=UserCollect&subComp=UserCollectDetail&collectionId=G10199482";

/** The model the stub serves: the one with profiles, or the bare one. */
function handlerFor(scenario: string, model = "model-detail"): FetchHandler {
  return async ({ url, json: body, headers }) => {
    const path = url.pathname.startsWith(GATEWAY) ? url.pathname.slice(GATEWAY.length) : null;
    if (url.hostname.endsWith(".aliyuncs.com")) {
      const fileId = url.pathname.split("/").pop()!.split(".")[0];
      return binary(url.pathname.endsWith(".stl") ? stl(fileId) : await threeMf(fileId));
    }
    switch (path) {
      case "/model-library-server/model-base-info/get":
        return json(loadFixture("nexprint", scenario === "missing" ? "model-missing" : model));
      case "/model-library-server/common/presigned-download-url": {
        // The token is the user's, and sent as a bearer one.
        assertThat(headers.authorization === `Bearer ${TOKEN}`, "the token is the user's, sent as a bearer one");
        if (scenario === "rejected") return json(loadFixture("nexprint", "unauthorized"));
        const template = JSON.stringify(loadFixture("nexprint", "presigned-download-url"));
        const files = (body as { fileInfoList: { fileId: string; type: string }[] }).fileInfoList;
        const signed = files.map(
          (file) =>
            JSON.parse(
              template.replaceAll("{fileId}", file.fileId).replaceAll("{ext}", file.type === "5" ? "3mf" : "stl"),
            ).data.fileInfoList[0],
        );
        return json({ code: 0, msg: "", data: { fileInfoList: signed } });
      }
      case "/model-library-server/model-collection/G10199482":
        return json(loadFixture("nexprint", scenario === "gone" ? "collection-missing" : "collection-info"));
      case "/model-library-server/model-collection/G10199482/model/page":
        return json(loadFixture("nexprint", "collection-models"));
      default:
        return undefined;
    }
  };
}

const spec: ProviderContractSpec = {
  id: "nexprint",
  name: "NexPrint",
  modelUrl: MODEL_URL,
  expected: {
    externalId: "G1215164",
    title: "Dog",
    notesIncludes: "A **crochet** dog.",
    author: "Cute Animals",
    tags: ["Amigurumi", "Dog"],
    category: { name: "3D Printer Accessories", parent: "3D Printer" },
    galleryImages: 2,
    // The designer's profile, the one a plain link brings.
    plateInstanceIds: ["G6354239"],
  },
  connect: async (userId) => {
    await setUserNexprintSession(userId, { token: TOKEN, expiresAt: null });
  },
  disconnect: async (userId) => {
    await setUserNexprintSession(userId, null);
  },
  createHandler: (scenario) => handlerFor(scenario),
  credentials: { sessionCode: "nexprint_session", connection: getNexprintConnection },
  reimport: {
    profile: {
      url: `${MODEL_URL}#profileId-G6354240`,
      plateInstanceIds: ["G6354239", "G6354240"],
    },
  },
  list: {
    endpoint: "/api/import/nexprint-collection/entries",
    url: COLLECTION_URL,
    title: "Test collection",
    importedId: "G1215164",
    freshId: "G6213245",
  },
  // Collections, private ones too, read without a sign-in; all pages, not the import dialog's first 600.
  listing: {
    sync: { externalId: "G10199482", sourceUrl: COLLECTION_URL },
    ids: ["G1215164", "G6213245"],
    needsSignIn: false,
  },
};

const ctx = describeProviderContract(spec);

describe("NexPrint specifics", () => {
  it("brings a model's own files, signed as such, when it has no print profiles", async () => {
    await spec.connect(ctx.userId);
    const bare = ctx.install(handlerFor("ok", "model-without-profiles"));
    {
      const res = await ctx.importUrl("https://www.nexprint.com/en/models/G1215999");
      expectStatus(res, 200);
      const [print] = await prisma.print.findMany({ where: { userId: ctx.userId, sourceExternalId: "G1215999" } });
      const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
      expect(plates.map((plate) => [plate.sourceInstanceId, plate.filename])).toEqual([
        [null, "Bare Dog.stl"],
        [null, "Bare Dog Base.stl"],
      ]);
      // Signed as the model's own files (type 2), not a profile's (type 5).
      const signing = bare.calls.find((call) => call.url.pathname.endsWith("/presigned-download-url"));
      expect(signing?.json.fileInfoList.map((file: { type: string }) => file.type)).toEqual(["2", "2"]);
    }
  });

  it("reads a link's ids in upper case, as NexPrint's own are", async () => {
    await spec.connect(ctx.userId);
    ctx.stub("ok");
    const res = await ctx.importUrl("https://nexprint.com/models/g1215164?printConfigId=g6354240");
    expectStatus(res, 200);
    const [print] = await ctx.prints();
    expect(print.sourceExternalId).toBe("G1215164");
    // The profile the link names, not the designer's.
    const plates = await prisma.plate.findMany({ where: { printId: print.id } });
    expect(plates.map((plate) => plate.sourceInstanceId)).toEqual(["G6354240"]);
  });

  it("answers a model NexPrint doesn't have with 404, and a sign-in refused on a re-import's profile with the session code", async () => {
    await spec.connect(ctx.userId);
    ctx.install(handlerFor("ok", "model-missing"));
    expect((await ctx.importUrl("https://www.nexprint.com/en/models/G9999999")).status).toBe(404);

    ctx.stub("ok");
    expect((await ctx.importUrl()).status).toBe(200);
    // The token is turned down while the second profile's file is signed.
    ctx.stub("rejected");
    const res = await ctx.importUrl(`${MODEL_URL}#profileId-G6354240`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("nexprint_session");
    expect(await getNexprintConnection(ctx.userId)).toBe("expired");
  });

  it("lists a collection without a sign-in", async () => {
    // No token needed for a collection, even a private one.
    await spec.disconnect(ctx.userId);
    ctx.stub("list");
    const res = await ctx.post("/api/import/nexprint-collection/entries", { url: COLLECTION_URL });
    expectStatus(res, 200);
    // The model NexPrint no longer shares is left out.
    expect(res.body.entries.map((entry: { design_id: string }) => entry.design_id)).toEqual(["G1215164", "G6213245"]);
  });
});
