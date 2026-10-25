import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db";
import { fetchListing } from "../../src/services/collectionSyncRunner";
import { setUserMakeronlineToken } from "../../src/providers/makeronline/session";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import { binary, json, loadFixture, stl, threeMf, type FetchHandler, expectStatus } from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// MakerOnline end to end: the details come from its public API (`{code, message, data}`, code 0 on success), the files
// only as links Thingport Grab got signed on makeronline.com and sends with the import as `resolved_files`. Nothing
// is fetched with the user's token for an import. Answers are the recorded shapes in fixtures/providers/makeronline.

const MODEL_ID = "281521";
const MODEL_URL = `https://www.makeronline.com/en/model/Bone-Wagon/${MODEL_ID}.html`;
const SIGNED = "https://cdn-acop.makeronline.com/signed";
const COLLECTION_URL = "https://www.makeronline.com/en/user/collectionDetail/owner-uuid/599628.html";

const profileFile = (profileId: string, name: string) => ({
  url: `${SIGNED}/${profileId}/${name}?sig=1`,
  name,
  profile_id: profileId,
});
const DESIGNER_FILE = profileFile("176077", "scraper.3mf");
const REMIX_FILE = profileFile("215390", "remix.3mf");

/** Scenarios beyond "ok" and "list": "without-profiles" (a model with none), "missing" (not there). */
function handlerFor(scenario: string): FetchHandler {
  return async ({ url }) => {
    if (url.hostname === "cdn-acop.makeronline.com" && url.pathname.startsWith("/signed/")) {
      const name = url.pathname.split("/").pop()!;
      return binary(name.endsWith(".stl") ? stl(name) : await threeMf(url.pathname));
    }
    if (url.hostname !== "www.makeronline.com" || !url.pathname.startsWith("/api/")) return undefined;
    switch (url.pathname.slice("/api".length)) {
      case "/mold/detail":
        expect(url.searchParams.get("id")).toBe(MODEL_ID);
        return json(
          loadFixture(
            "makeronline",
            scenario === "missing"
              ? "model-missing"
              : scenario === "without-profiles"
                ? "model-without-profiles"
                : "model-detail",
          ),
        );
      case "/user/like/index":
        return json(loadFixture("makeronline", "collection-models"));
      case "/user/collection/info":
        return json(loadFixture("makeronline", "collection-info"));
      case "/user/collection/sub-index":
        // A collection that's gone answers with a positive code.
        return json(loadFixture("makeronline", scenario === "gone" ? "model-missing" : "collection-models"));
      default:
        return undefined;
    }
  };
}

const spec: ProviderContractSpec = {
  id: "makeronline",
  name: "MakerOnline",
  modelUrl: MODEL_URL,
  importBody: () => ({ resolved_files: [DESIGNER_FILE] }),
  expected: {
    externalId: MODEL_ID,
    title: "Ergonomic Super Scraper",
    notesIncludes: "A **scraper** for the Kobra.",
    author: "3DPrintOfficial",
    tags: ["Kobra", "Scraper"],
    category: { name: "3D Printer Parts", parent: "3D Printer" },
    galleryImages: 2,
    plateInstanceIds: ["176077"],
    plateFilenames: ["scraper.3mf"],
  },
  connect: async () => undefined,
  disconnect: async () => undefined,
  createHandler: handlerFor,
  reimport: {
    profile: {
      url: MODEL_URL,
      body: () => ({ resolved_files: [REMIX_FILE] }),
      plateInstanceIds: ["176077", "215390"],
    },
  },
  list: {
    endpoint: "/api/import/makeronline-list/entries",
    url: COLLECTION_URL,
    title: "Scrapers",
    importedId: MODEL_ID,
    freshId: "329173",
  },
  // Public collections list without a sign-in; the user's likes and private collections need theirs.
  listing: { sync: { externalId: "599628", sourceUrl: COLLECTION_URL }, ids: [MODEL_ID, "329173"], needsSignIn: false },
  skip: {
    missingCredentials:
      "an import uses no stored credential: files come only with Grab-signed links, and their absence is the 409 makeronline_grab pinned below",
    rejectedCredentials:
      "the user's token reads likes and private collections only, never a model or its files, so an import can't have it turned down",
  },
};

const ctx = describeProviderContract(spec);

describe("MakerOnline specifics", () => {
  afterEach(async () => {
    await prisma.grabImport.deleteMany({ where: { userId: ctx.userId } });
  });

  describe("files only through Grab", () => {
    it("answers an import without Grab's signed files with 409 makeronline_grab, asking MakerOnline nothing", async () => {
      const stub = ctx.stub("ok");
      const res = await ctx.post("/api/import", { url: MODEL_URL, tags: [] });
      expectStatus(res, 409);
      expect(res.body.code).toBe("makeronline_grab");
      expect(res.body.detail).toMatch(/import it with Thingport Grab/);
      expect(stub.calls).toHaveLength(0);
      expect(await ctx.prints()).toHaveLength(0);

      // An empty list is none.
      const empty = await ctx.post("/api/import", { url: MODEL_URL, tags: [], resolved_files: [] });
      expect(empty.status).toBe(409);
      expect(empty.body.code).toBe("makeronline_grab");
    });

    it("plans what Grab has to get signed: the designer's profile 3MF, or every profile's", async () => {
      ctx.stub("ok");
      const url = await ctx.post("/api/import/makeronline/plan", { url: MODEL_URL });
      expectStatus(url, 200);
      expect(url.body).toEqual({
        title: "Ergonomic Super Scraper",
        requests: [
          {
            payload: { key: "13d314", file_type: 2, is_batch_down: 0, print_profile_id: 176077 },
            name: "scraper.3mf",
            profile_id: "176077",
          },
        ],
      });
      const all = await ctx.post("/api/import/makeronline/plan", { url: MODEL_URL, scope: "all" });
      expect(all.body.requests.map((request: { profile_id: string }) => request.profile_id)).toEqual([
        "176077",
        "215390",
      ]);

      ctx.stub("without-profiles");
      const bare = await ctx.post("/api/import/makeronline/plan", { url: MODEL_URL });
      expect(
        bare.body.requests.map((request: { name: string; profile_id: null }) => [request.name, request.profile_id]),
      ).toEqual([
        ["Left Hand Version.stl", null],
        ["Right Hand Version.stl", null],
      ]);
    });

    it("brings a model without profiles as its model files, untagged", async () => {
      ctx.stub("without-profiles");
      const res = await ctx.importUrl(MODEL_URL, {
        resolved_files: [
          { url: `${SIGNED}/f/Left%20Hand%20Version.stl?sig=1`, name: "Left Hand Version.stl" },
          { url: `${SIGNED}/f/Right%20Hand%20Version.stl?sig=1`, name: "Right Hand Version.stl", profile_id: null },
        ],
      });
      expectStatus(res, 200);
      const [print] = await ctx.prints();
      const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
      expect(plates.map((plate) => [plate.sourceInstanceId, plate.filename])).toEqual([
        [null, "Left Hand Version.stl"],
        [null, "Right Hand Version.stl"],
      ]);
    });

    it("takes only links on MakerOnline's own hosts, and says the links may have run out when none downloads", async () => {
      const stub = ctx.stub("ok");
      const res = await ctx.importUrl(MODEL_URL, {
        resolved_files: [{ url: "https://evil.example.com/scraper.3mf", name: "scraper.3mf", profile_id: "176077" }],
      });
      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/signed links may have run out/);
      expect(stub.calls.some((call) => call.url.hostname === "evil.example.com")).toBe(false);
      expect(await ctx.prints()).toHaveLength(0);
    });

    it("answers a model MakerOnline doesn't have with 404, even though Grab brought files", async () => {
      ctx.stub("missing");
      const res = await ctx.importUrl();
      expect(res.status).toBe(404);
    });
  });

  describe("adding profiles on a re-import", () => {
    it("adds every new profile's plate, ignores files of profiles it has and files without a profile", async () => {
      ctx.stub("ok");
      expect((await ctx.importUrl()).status).toBe(200);

      const stub = ctx.stub("ok");
      const nothing = await ctx.importUrl(MODEL_URL, {
        resolved_files: [DESIGNER_FILE, { url: `${SIGNED}/f/extra.stl?sig=1`, name: "extra.stl", profile_id: null }],
      });
      expect(nothing.body.import_outcome).toBe("already_imported");
      expect(stub.calls).toHaveLength(0);

      ctx.stub("ok");
      const added = await ctx.importUrl(MODEL_URL, { resolved_files: [DESIGNER_FILE, REMIX_FILE] });
      expect(added.body.import_outcome).toBe("profile_added");
      const [print] = await ctx.prints();
      const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
      expect(plates.map((plate) => plate.sourceInstanceId)).toEqual(["176077", "215390"]);
    });
  });

  describe("waiting for Grab", () => {
    it("clears the import a pasted link queued once the model comes in by any way", async () => {
      const queued = await ctx.post("/api/import/makeronline/queue", { url: MODEL_URL, tags: [] });
      expectStatus(queued, 202);
      const waiting = () =>
        prisma.grabImport.findMany({ where: { userId: ctx.userId } }).then((rows) => rows.map((row) => row.url));
      expect(await waiting()).toEqual([MODEL_URL]);

      ctx.stub("ok");
      expect((await ctx.importUrl()).status).toBe(200);
      expect(await waiting()).toEqual([]);
    });

    it("imports a waiting model with the files Grab signed, and clears it", async () => {
      await ctx.post("/api/import/makeronline/queue", { url: MODEL_URL, tags: [] });
      const [row] = await prisma.grabImport.findMany({ where: { userId: ctx.userId } });
      ctx.stub("ok");
      const res = await ctx.post(`/api/import/makeronline/waiting/${row.id}`, { files: [DESIGNER_FILE] });
      expectStatus(res, 200);
      expect(await prisma.grabImport.count({ where: { userId: ctx.userId } })).toBe(0);
      expect(await ctx.prints()).toHaveLength(1);
    });

    it("refuses to queue while MakerOnline is turned off", async () => {
      const { setProviderEnabled } = await import("../../src/services/providerSettingsService");
      await setProviderEnabled("makeronline", false);
      const res = await ctx.post("/api/import/makeronline/queue", { url: MODEL_URL, tags: [] });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("provider_disabled");
    });
  });

  it("lists a collection without a sign-in, leaving out models taken down", async () => {
    ctx.stub("list");
    const res = await ctx.post(spec.list!.endpoint, { url: COLLECTION_URL });
    expectStatus(res, 200);
    expect(res.body.entries.map((entry: { design_id: string }) => entry.design_id)).toEqual([MODEL_ID, "329173"]);
  });

  describe("collection sync of the user's likes", () => {
    const likes = () => ({
      userId: ctx.userId,
      provider: "makeronline",
      externalId: "likes",
      sourceUrl: "https://www.makeronline.com/en/user/likes/models.html",
    });

    it("reads them with the user's token, sent bare", async () => {
      await setUserMakeronlineToken(ctx.userId, { token: "user-token", expiresAt: null, userId: null });
      try {
        const stub = ctx.stub("list");
        expect(await fetchListing(likes())).toEqual([MODEL_ID, "329173"]);
        expect(stub.calls[0].headers.authorization).toBe("user-token");
      } finally {
        await setUserMakeronlineToken(ctx.userId, null);
      }
    });

    it("waits (throws) without a token", async () => {
      ctx.stub("list");
      await expect(fetchListing(likes())).rejects.toThrow(/MakerOnline/);
    });
  });
});
