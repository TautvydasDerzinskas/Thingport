import JSZip from "jszip";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/db";
import {
  getQidimakerConnection,
  getUserQidimakerToken,
  normalizeQidimakerSession,
  setUserQidimakerSession,
} from "../../src/providers/qidimaker/session";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import { assertThat, binary, expectStatus, json, loadFixture, stl, threeMf, type FetchHandler } from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// QIDI Maker end to end: models, their print profiles and files need no sign-in, the files being on a public CDN; the
// user's likes and private collections need their token cookie, with an XSRF pair the site only compares. Every call
// carries the headers its pages send. Answers are the recorded shapes in fixtures/providers/qidimaker.

const TOKEN = "0123456789abcdef0123456789abcdef";
// A sign-in saved after TOKEN, from Grab or pasted in Thingport.
const NEWER = "fedcba9876543210fedcba9876543210";
const API = "/community/v1/";
const MODEL_ID = "2094485343639777281";
const MODEL_URL = `https://www.qidimaker.com/en/models/detail/${MODEL_ID}`;
const DESIGNER_FIRST = "2094485346244440065";
const DESIGNER_SECOND = "2094487632165285889";
const COMMUNITY = "2091804233625579522";
const COLLECTION_ID = "2119450902810669058";
const COLLECTION_URL = `https://www.qidimaker.com/en/collections/detail/${COLLECTION_ID}`;
const LIKES_URL = "https://www.qidimaker.com/en/my/collections/detail?type=1";
const COLLECTED = ["2079504508867624961", "2066722423216062465", "2087143752360574978", "2089830911530577921"];
const LIKED = COLLECTED.slice(1);
const TITLE = "True Flexi Filament Clip ⧸ Tangle Free Storage";

/** The zip the site makes of a model's files, as it writes most of them: every entry, but no central directory. */
async function brokenZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(`model_${MODEL_ID}_stl_files/2026-09-29_0b02060ac4bd04.stl`, stl("chute"));
  zip.file(`model_${MODEL_ID}_stl_files/2026-09-29_9ce434e9a4ae8d.3mf`, await threeMf("chute"));
  const whole = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", streamFiles: true });
  return whole.subarray(0, whole.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])));
}

type Model = "profiles" | "community" | "bare";

const DETAILS: Record<Model, [string, string]> = {
  profiles: ["model-detail", "profiles"],
  community: ["model-community-detail", "profiles-community"],
  bare: ["model-without-profiles", "profiles-none"],
};

/** The model the stub serves: one with its designer's profiles and someone else's, one with only someone else's, or
 *  one with none. */
function handlerFor(scenario: string, model: Model = "profiles"): FetchHandler {
  return async ({ url, json: body, headers }) => {
    if (url.hostname === "public-cdn.qidimaker.com") {
      if (url.pathname.endsWith(".3mf")) return binary(await threeMf(url.pathname.split("/").pop()!));
      if (url.pathname.endsWith(".zip")) return binary(await brokenZip());
      return undefined;
    }
    if (url.hostname !== "www.qidimaker.com" || !url.pathname.startsWith(API)) return undefined;
    assertThat(
      headers["x-timestamp"] && headers["x-nonce"] && headers["x-deviceid"] && headers["accept-language"] === "en_US",
      "every call carries the headers the site's pages send",
    );
    const signedIn = headers.cookie?.includes(`token=${TOKEN}`) ?? false;
    if (signedIn) {
      const xsrf = headers.cookie!.match(/XSRF-TOKEN=([^;]+)/)?.[1];
      assertThat(xsrf && headers["x-xsrf-token"] === xsrf, "a signed-in call carries a matching XSRF pair");
    }
    if (scenario === "outage") return json(loadFixture("qidimaker", "model-missing"), 500);
    const [detail, profiles] = DETAILS[model];
    switch (url.pathname.slice(API.length)) {
      case "sliceModel/getModelDetail":
        if (scenario === "missing") return json(loadFixture("qidimaker", "model-missing"), 500);
        return json(loadFixture("qidimaker", detail));
      case "sliceModelConfiguration/getListByModelId":
        return json(loadFixture("qidimaker", profiles));
      case "sliceClassify/getList":
        return json(loadFixture("qidimaker", "categories"));
      case "sliceModel/getModelPagePublic":
        return json(loadFixture("qidimaker", "trending"));
      case "sliceModelFavorite/getById":
        if (scenario === "gone") return json(loadFixture("qidimaker", "collection-missing"), 400);
        return json(loadFixture("qidimaker", "collection-info"));
      case "sliceModelFavorite/getModelListByFavoriteId": {
        if ((body as { favoriteType?: number }).favoriteType === 1) {
          assertThat(signedIn || scenario === "rejected", "the likes are read with the user's sign-in");
          if (scenario === "rejected") return json(loadFixture("qidimaker", "unauthorized"), 401);
          return json(loadFixture("qidimaker", "likes"));
        }
        if (scenario === "gone") return json(loadFixture("qidimaker", "collection-missing"), 400);
        return json(loadFixture("qidimaker", "collection-models"));
      }
      default:
        return undefined;
    }
  };
}

const spec: ProviderContractSpec = {
  id: "qidimaker",
  name: "QIDI Maker",
  modelUrl: MODEL_URL,
  expected: {
    externalId: MODEL_ID,
    title: TITLE,
    notesIncludes: "An innovative but simple filament clip",
    author: "Maker 1",
    // As its English page shows them: translated, "flexi" and all.
    tags: ["Clip", "Filament", "Flexion", "Free", "Organizer", "Spool", "Storage", "Tangle", "True", "Universal"],
    category: { name: "3D Printer Accessories", parent: "3D Printer" },
    // Its animated cover, and five pictures.
    galleryImages: 6,
    // The designer's first profile, which a plain link brings, named after the model.
    plateInstanceIds: [DESIGNER_FIRST],
    plateFilenames: [`${TITLE}.3mf`],
  },
  connect: async (userId) => {
    await setUserQidimakerSession(userId, TOKEN);
  },
  disconnect: async (userId) => {
    await setUserQidimakerSession(userId, null);
  },
  createHandler: (scenario) => handlerFor(scenario),
  reimport: {
    profile: { url: `${MODEL_URL}?profile_id=${DESIGNER_SECOND}`, plateInstanceIds: [DESIGNER_FIRST, DESIGNER_SECOND] },
  },
  list: {
    endpoint: "/api/import/qidimaker/list/entries",
    url: COLLECTION_URL,
    title: "Printer upgrades",
    importedId: COLLECTED[0],
    freshId: COLLECTED[1],
  },
  // Anyone's public collection reads without a sign-in; only the user's own private ones need theirs.
  listing: { sync: { externalId: COLLECTION_ID, sourceUrl: COLLECTION_URL }, ids: COLLECTED, needsSignIn: false },
  skip: {
    missingCredentials: "QIDI Maker's models and their files import without a sign-in; only the user's lists need one",
    rejectedCredentials: "QIDI Maker's models and their files import without a sign-in; only the user's lists need one",
  },
};

const ctx = describeProviderContract(spec);

/** The import job, once it has finished. */
async function finished(jobId: string) {
  for (let tries = 0; tries < 150; tries++) {
    const job = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
    if (job.status !== "RUNNING") return job;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The import didn't finish");
}

async function plateRows() {
  const [print] = await ctx.prints();
  return prisma.plate.findMany({ where: { printId: print.id }, orderBy: { createdAt: "asc" } });
}

describe("QIDI Maker specifics", () => {
  it("answers a model QIDI Maker doesn't have with 404, and its own outage otherwise", async () => {
    ctx.stub("missing");
    expect((await ctx.importUrl(`https://www.qidimaker.com/en/models/detail/9999999999999999999`)).status).toBe(404);
    ctx.stub("outage");
    expect((await ctx.importUrl()).status).not.toBe(404);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("imports the profile a link names, someone else's too", async () => {
    ctx.stub("ok");
    expectStatus(await ctx.importUrl(`${MODEL_URL}?profile_id=${COMMUNITY}`), 200);
    expect((await plateRows()).map((plate) => plate.sourceInstanceId)).toEqual([COMMUNITY]);
  });

  it("imports someone else's profile where the designer made none", async () => {
    ctx.install(handlerFor("ok", "community"));
    expectStatus(await ctx.importUrl("https://www.qidimaker.com/en/models/detail/2088060037789433858"), 200);
    expect((await plateRows()).map((plate) => plate.sourceInstanceId)).toEqual([COMMUNITY]);
  });

  it("imports a model without profiles from the site's zip of its files, put back together first", async () => {
    const stub = ctx.install(handlerFor("ok", "bare"));
    expectStatus(await ctx.importUrl("https://www.qidimaker.com/en/models/detail/2105158803743387649"), 200);
    const plates = await plateRows();
    // The site names the files only by when they were uploaded, so they're named after the model.
    expect(plates.map((plate) => plate.filename).toSorted()).toEqual([
      "QIDI Plus5 Poop Chute - Clears Power, Switch & Eth.3mf",
      "QIDI Plus5 Poop Chute - Clears Power, Switch & Eth.stl",
    ]);
    expect(stub.calls.some((call) => call.url.pathname.endsWith("all_stls.zip"))).toBe(true);
  });

  it("imports a queued link of a model without profiles as its own files, whichever profiles it asks for", async () => {
    ctx.install(handlerFor("ok", "bare"));
    const res = await ctx.post("/api/import/links", {
      urls: ["https://www.qidimaker.com/en/models/detail/2105158803743387649"],
      scope: "designer",
    });
    expectStatus(res, 202);
    expect(await finished(res.body.job_id)).toMatchObject({ status: "DONE", failedCount: 0 });
    expect((await plateRows()).map((plate) => plate.filename).toSorted()).toEqual([
      "QIDI Plus5 Poop Chute - Clears Power, Switch & Eth.3mf",
      "QIDI Plus5 Poop Chute - Clears Power, Switch & Eth.stl",
    ]);
  });

  it.each(["designer", "all"])("imports a model's %s profiles onto one print", async (scope) => {
    ctx.stub("ok");
    const res = await ctx.post("/api/import/qidimaker/profiles", { url: MODEL_URL, scope });
    expectStatus(res, 202);
    expect(await finished(res.body.job_id)).toMatchObject({ status: "DONE" });
    const ids = (await plateRows()).map((plate) => plate.sourceInstanceId);
    expect(ids).toEqual(
      scope === "designer" ? [DESIGNER_FIRST, DESIGNER_SECOND] : [DESIGNER_FIRST, DESIGNER_SECOND, COMMUNITY],
    );
  });

  it("lists the likes with the sign-in, and remembers one QIDI Maker turns down", async () => {
    await spec.disconnect(ctx.userId);
    ctx.stub("list");
    const signedOut = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
    expect(signedOut.status).toBe(400);
    expect(signedOut.body.code).toBe("qidimaker_session");

    await spec.connect(ctx.userId);
    const signedIn = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
    expectStatus(signedIn, 200);
    expect(signedIn.body.entries.map((entry: { design_id: string }) => entry.design_id)).toEqual(LIKED);

    ctx.stub("rejected");
    const rejected = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe("qidimaker_session");
    expect(await getQidimakerConnection(ctx.userId)).toBe("expired");
  });

  it("holds the likes' sync once their sign-in is turned down, but keeps one saved while they were read", async () => {
    const { syncCollection } = await import("../../src/services/collectionSyncRunner");
    const { findOrCreateCollectionByName } = await import("../../src/services/collectionService");
    await spec.connect(ctx.userId);
    const rejecting = handlerFor("rejected");
    ctx.install(async (call) => {
      // Grab sends a new sign-in while the likes are being read with the old one.
      if (call.url.pathname.endsWith("getModelListByFavoriteId")) await setUserQidimakerSession(ctx.userId, NEWER);
      return rejecting(call);
    });
    const collection = await findOrCreateCollectionByName(ctx.userId, "QIDI Maker likes, held");
    const sync = await prisma.collectionSync.create({
      data: {
        userId: ctx.userId,
        collectionId: collection.id,
        provider: "qidimaker",
        externalId: "likes",
        sourceUrl: LIKES_URL,
      },
    });
    try {
      expect(await syncCollection(sync.id)).toBe("disconnected");
      const held = await prisma.collectionSync.findUniqueOrThrow({ where: { id: sync.id } });
      expect(held.lastError).toBe("QIDI Maker sign-in ran out");
      expect(await getQidimakerConnection(ctx.userId)).toBe("connected");
    } finally {
      await prisma.collectionSync.delete({ where: { id: sync.id } }).catch(() => undefined);
      await prisma.collection.delete({ where: { id: collection.id } }).catch(() => undefined);
    }
  });

  it("holds a sync of a collection it can't read without a sign-in, rather than taking it for gone", async () => {
    const { fetchListing } = await import("../../src/services/collectionSyncRunner");
    await spec.disconnect(ctx.userId);
    ctx.stub("gone");
    const sync = { userId: ctx.userId, provider: "qidimaker", externalId: COLLECTION_ID, sourceUrl: COLLECTION_URL };
    await expect(fetchListing(sync)).rejects.toThrow("QIDI Maker isn't connected to read this collection");
  });
});

describe("QIDI Maker sign-in", () => {
  it("forgets the sign-in Grab saw signed out, but not one pasted in Thingport since", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Grab sign-out", email: `qidi-signout-${Date.now()}@example.com`, password: "password123" });
    const userId: string = res.body.user.id;
    const patch = (body: Record<string, unknown>) =>
      request(app)
        .patch("/api/providers/qidimaker/connection")
        .set({ Authorization: `Bearer ${res.body.token}` })
        .send(body);
    try {
      await setUserQidimakerSession(userId, TOKEN);
      expect((await patch({ token: null, signed_out_of: TOKEN })).body).toEqual({ configured: false });
      expect(await getQidimakerConnection(userId)).toBe("disconnected");

      await setUserQidimakerSession(userId, NEWER);
      expect((await patch({ token: null, signed_out_of: TOKEN })).body).toEqual({ configured: true });
      expect(await getUserQidimakerToken(userId)).toBe(NEWER);

      // Disconnecting in Thingport clears whatever is there.
      expect((await patch({ token: null })).body).toEqual({ configured: false });
    } finally {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
  });

  it("reads the token cookie however it's pasted", () => {
    expect(normalizeQidimakerSession(TOKEN)).toBe(TOKEN);
    expect(normalizeQidimakerSession(`Cookie: theme=system; token=${TOKEN}; XSRF-TOKEN=abc`)).toBe(TOKEN);
    // A row of the browser's cookie table, as its developer tools copy it.
    expect(normalizeQidimakerSession(`XSRF-TOKEN\tabc\ntoken\t${TOKEN}\twww.qidimaker.com\t/\t2027-02-11`)).toBe(TOKEN);
    expect(normalizeQidimakerSession("XSRF-TOKEN=abc")).toBeNull();
    expect(normalizeQidimakerSession("not a sign-in")).toBeNull();
  });
});
