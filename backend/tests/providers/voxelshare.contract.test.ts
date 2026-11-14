import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/db";
import {
  getUserVoxelshareToken,
  getVoxelshareAccountName,
  getVoxelshareConnection,
  normalizeVoxelshareSession,
  setUserVoxelshareSession,
  voxelshareTokenExpiry,
} from "../../src/providers/voxelshare/session";
import { voxelshareTrending } from "../../src/providers/voxelshare";
import { voxelshareBrowse } from "../../src/providers/voxelshare/browse";
import { modelUrl } from "../../src/providers/index.generated";
import { getTrending } from "../../src/services/providerTrendingService";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import { assertThat, binary, expectStatus, json, loadFixture, stl, threeMf, zip, type FetchHandler } from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// VoxelShare end to end: models, their print profiles and files need no sign-in, the files being signed links on its
// image host; the user's likes and own collections need their token, sent as a Bearer token. Answers are the recorded
// shapes in fixtures/providers/voxelshare; the signed-in ones are written in the shape of its others, with made-up ids.
// Its China site answers the same on api.voxelshare.cn, with a sign-in of its own.

/** A token in the site's shape, running out on 2099-01-01. */
function jwt(subject: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part({ sub: subject, exp: 4070908800 })}.c2lnbmF0dXJl`;
}
const TOKEN = jwt("1");
// A sign-in saved after TOKEN, from Grab or pasted in Thingport.
const NEWER = jwt("2");
// The China site's sign-in, another account's.
const CHINA_TOKEN = jwt("3");
const CHINA_MODEL_URL = "https://www.voxelshare.cn/zh/models/8242660-flexi-mechanical-dragon";
const CHINA_LIKES_URL = "https://www.voxelshare.cn/zh/print_list?recordTab=like";
const API = "/api/v3/";
const MODEL_ID = "8242660";
const MODEL_URL = "https://www.voxelshare.com/en/models/8242660-flexi-mechanical-dragon";
const DESIGNER_FIRST = "1502104";
const DESIGNER_SECOND = "1502105";
const COMMUNITY = "1502106";
const BARE_ID = "10602179";
const COLLECTION_ID = "664950";
const COLLECTION_URL = `https://www.voxelshare.com/en/collection/${COLLECTION_ID}-must-have-high-quality-models`;
const LIKES_URL = "https://www.voxelshare.com/en/print_list?recordTab=like";
const CHINA_COLLECTION_URL = `https://www.voxelshare.cn/zh/collection/${COLLECTION_ID}`;
const COLLECTED = ["10602179", "9610105", "9578063", "9560984"];
const LIKED = COLLECTED.slice(1);
const TITLE = "Flexi mechanical dragon";

type Model = "several" | "bare" | "folder" | "hidden";

/** The model's print profiles: the recorded one, with a second of the designer's and one of someone else's after it,
 *  as the site lists several; for "hidden", the recorded one made private, as its page leaves it out. */
function profiles(model: Model) {
  const recorded = loadFixture("voxelshare", "profiles");
  if (model === "bare" || model === "folder") return loadFixture("voxelshare", "profiles-none");
  const [first] = recorded.data.items;
  if (model === "hidden") return { ...recorded, data: { items: [{ ...first, privateFlag: true }] } };
  const other = (id: string, designer: boolean) => ({
    ...first,
    id,
    name: designer ? "0.16mm layer, fine" : "Community remix profile",
    modelCreator: designer,
    tmfDownloadUrl: first.tmfDownloadUrl.replace("b319ca9e.3mf", `${id}.3mf`),
  });
  return { ...recorded, data: { items: [first, other(DESIGNER_SECOND, true), other(COMMUNITY, false)] } };
}

/** The model the stub serves: the dragon with its profiles, or the highland cow without profiles (or with only a
 *  hidden one), its file kept zipped on its own, or in a folder of loose files. The "fileDown" scenario's image host
 *  turns the files away, and "likesDown"'s API fails the likes. */
function handlerFor(scenario: string, model: Model = "several"): FetchHandler {
  return async ({ url, json: body, headers }) => {
    if (url.hostname === "webimage.voxelshare.com") {
      assertThat(url.searchParams.get("sign"), "a file is fetched by its signed link");
      if (scenario === "fileDown" && !/\.(png|jpe?g|webp)$/i.test(url.pathname)) return json({}, 404);
      if (url.pathname.endsWith(".3mf")) return binary(await threeMf(url.pathname.split("/").pop()!));
      if (url.pathname.endsWith(".stl.zip")) return binary(await zip("cow", { "highland.stl": stl("cow") }));
      if (url.pathname.endsWith(".stl")) return binary(stl(url.pathname));
      return undefined;
    }
    const china = url.hostname === "api.voxelshare.cn";
    if ((url.hostname !== "api.voxelshare.com" && !china) || !url.pathname.startsWith(API)) return undefined;
    // Each site's sign-in is its own accounts', and goes to its own API alone.
    assertThat(
      headers.authorization !== `Bearer ${china ? TOKEN : CHINA_TOKEN}`,
      "a sign-in goes to its own site only",
    );
    const signedIn = headers.authorization === `Bearer ${china ? CHINA_TOKEN : TOKEN}`;
    if (scenario === "outage") return json({ code: 500, msg: "system error" }, 500);
    const bare = model !== "several";
    switch (url.pathname.slice(API.length)) {
      case "model/detail/info":
        if (scenario === "missing") return json(loadFixture("voxelshare", "model-missing"));
        return json(loadFixture("voxelshare", bare ? "model-without-profiles" : "model-detail"));
      case "model/detail/print_configs":
        return json(profiles(model));
      case "model/detail/source_files":
        return json(loadFixture("voxelshare", model === "folder" ? "files-folder" : "files"));
      case "model/recommend":
        return json(loadFixture("voxelshare", "trending"));
      case "model/collection/detail":
        if (scenario === "gone") return json(loadFixture("voxelshare", "collection-missing"));
        if (scenario === "private") {
          const info = loadFixture("voxelshare", "collection-info");
          return json({ ...info, data: { ...info.data, privateFlag: true } });
        }
        return json(loadFixture("voxelshare", "collection-info"));
      case "model/collection/model/list":
        assertThat(
          (body as { collectionId?: string }).collectionId === COLLECTION_ID,
          "a collection's models by its id",
        );
        return json(loadFixture("voxelshare", "collection-models"));
      case "model/creator/like_list":
        assertThat(signedIn || scenario === "rejected", "the likes are read with the user's sign-in");
        if (scenario === "rejected") return json(loadFixture("voxelshare", "unauthorized"), 401);
        if (scenario === "likesDown") return json({ code: 500, msg: "system error" }, 500);
        return json(loadFixture("voxelshare", "likes"));
      case "creator/self/profile":
        if (!signedIn) return json(loadFixture("voxelshare", "unauthorized"), 401);
        return json(loadFixture("voxelshare", "self-profile"));
      case "model/collection/list":
        assertThat(signedIn, "the user's own collections are read with their sign-in");
        return json(loadFixture("voxelshare", "own-collections"));
      default:
        return undefined;
    }
  };
}

const spec: ProviderContractSpec = {
  id: "voxelshare",
  name: "VoxelShare",
  modelUrl: MODEL_URL,
  expected: {
    externalId: MODEL_ID,
    title: TITLE,
    notesIncludes: "Print-in-place, no supports required.",
    author: "Maker 6",
    // Its models carry tags only now and then; this one has none.
    tags: [],
    category: { name: "Characters", parent: "Toys & Games" },
    galleryImages: 3,
    // The designer's first profile, which a plain link brings, named after the model.
    plateInstanceIds: [DESIGNER_FIRST],
    plateFilenames: [`${TITLE}.3mf`],
  },
  connect: async (userId) => {
    await setUserVoxelshareSession(userId, TOKEN);
  },
  // Both sites' sign-ins, so no test leaves the China one behind.
  disconnect: async (userId) => {
    await setUserVoxelshareSession(userId, null);
    await setUserVoxelshareSession(userId, null, null, "cn");
  },
  createHandler: (scenario) => handlerFor(scenario, "several"),
  reimport: {
    profile: { url: `${MODEL_URL}#profileId-${DESIGNER_SECOND}`, plateInstanceIds: [DESIGNER_FIRST, DESIGNER_SECOND] },
  },
  list: {
    endpoint: "/api/import/voxelshare/list/entries",
    url: COLLECTION_URL,
    title: "Must-have high-quality models",
    importedId: COLLECTED[1],
    freshId: COLLECTED[2],
  },
  // Anyone's public collection reads without a sign-in; only the user's own private ones need theirs.
  listing: { sync: { externalId: COLLECTION_ID, sourceUrl: COLLECTION_URL }, ids: COLLECTED, needsSignIn: false },
  skip: {
    missingCredentials: "VoxelShare's models and their files import without a sign-in; only the user's lists need one",
    rejectedCredentials: "VoxelShare's models and their files import without a sign-in; only the user's lists need one",
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

describe("VoxelShare specifics", () => {
  it("answers a model VoxelShare doesn't have with 404, and its own outage otherwise", async () => {
    ctx.stub("missing");
    expect((await ctx.importUrl("https://www.voxelshare.com/en/models/99999999999")).status).toBe(404);
    ctx.stub("outage");
    expect((await ctx.importUrl()).status).not.toBe(404);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("imports the profile a link names, someone else's too", async () => {
    ctx.install(handlerFor("ok", "several"));
    expectStatus(await ctx.importUrl(`${MODEL_URL}#profileId-${COMMUNITY}`), 200);
    expect((await plateRows()).map((plate) => plate.sourceInstanceId)).toEqual([COMMUNITY]);
  });

  it("imports a model without profiles from its own files, a file kept zipped on its own unpacked", async () => {
    const stub = ctx.install(handlerFor("ok", "bare"));
    expectStatus(await ctx.importUrl(`https://www.voxelshare.com/en/models/${BARE_ID}`), 200);
    expect((await plateRows()).map((plate) => plate.filename)).toEqual(["highland.stl"]);
    expect(stub.calls.some((call) => call.url.pathname.endsWith("0_highland.stl.zip"))).toBe(true);
    // Never the call that counts a download on the user's account.
    expect(stub.calls.some((call) => call.url.pathname.includes("download/report"))).toBe(false);
  });

  it("credits where a model it copied from another site was first published", async () => {
    ctx.install(handlerFor("ok", "bare"));
    expectStatus(await ctx.importUrl(`https://www.voxelshare.com/en/models/${BARE_ID}`), 200);
    const [print] = await ctx.prints();
    expect(print.notes).toContain(
      'Originally published on Printables: <a href="https://www.printables.com/model/1763372-grumpy-highland-cow-from-the-grumpy-animals-series">',
    );
  });

  it("imports a model's own files where none of its profiles is shown", async () => {
    ctx.install(handlerFor("ok", "hidden"));
    expectStatus(await ctx.importUrl(`https://www.voxelshare.com/en/models/${BARE_ID}`), 200);
    expect((await plateRows()).map((plate) => plate.filename)).toEqual(["highland.stl"]);
  });

  it("fails an import whose file doesn't download, rather than keep the model without it", async () => {
    ctx.install(handlerFor("fileDown", "bare"));
    const res = await ctx.importUrl(`https://www.voxelshare.com/en/models/${BARE_ID}`);
    expect(res.status).toBe(502);
    expect(res.body.detail).toMatch(/didn't hand over one of this model's files/);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("imports the files of a model's folder", async () => {
    ctx.install(handlerFor("ok", "folder"));
    expectStatus(await ctx.importUrl(`https://www.voxelshare.com/en/models/${BARE_ID}`), 200);
    expect((await plateRows()).map((plate) => plate.filename).toSorted()).toEqual([
      "obj_1_RING + NAIL.stl",
      "obj_2_RING + NAIL.stl",
      "obj_3_RING + NAIL.stl",
      "obj_4_RING + NAIL.stl",
      "obj_5_RING + NAIL.stl",
    ]);
  });

  it("imports a queued link of a model without profiles as its own files, whichever profiles it asks for", async () => {
    ctx.install(handlerFor("ok", "bare"));
    const res = await ctx.post("/api/import/links", {
      urls: [`https://www.voxelshare.com/en/models/${BARE_ID}`],
      scope: "designer",
    });
    expectStatus(res, 202);
    expect(await finished(res.body.job_id)).toMatchObject({ status: "DONE", failedCount: 0 });
    expect((await plateRows()).map((plate) => plate.filename)).toEqual(["highland.stl"]);
  });

  it.each(["designer", "all"])("imports a model's %s profiles onto one print", async (scope) => {
    ctx.install(handlerFor("ok", "several"));
    const res = await ctx.post("/api/import/voxelshare/profiles", { url: MODEL_URL, scope });
    expectStatus(res, 202);
    expect(await finished(res.body.job_id)).toMatchObject({ status: "DONE" });
    const ids = (await plateRows()).map((plate) => plate.sourceInstanceId);
    expect(ids).toEqual(
      scope === "designer" ? [DESIGNER_FIRST, DESIGNER_SECOND] : [DESIGNER_FIRST, DESIGNER_SECOND, COMMUNITY],
    );
  });

  it("lists the likes with the sign-in, and remembers one VoxelShare turns down", async () => {
    await spec.disconnect(ctx.userId);
    ctx.stub("list");
    const signedOut = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
    expect(signedOut.status).toBe(400);
    expect(signedOut.body.code).toBe("voxelshare_session");

    await spec.connect(ctx.userId);
    const signedIn = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
    expectStatus(signedIn, 200);
    expect(signedIn.body.entries.map((entry: { design_id: string }) => entry.design_id)).toEqual(LIKED);

    ctx.stub("rejected");
    const rejected = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe("voxelshare_session");
    expect(await getVoxelshareConnection(ctx.userId)).toBe("expired");
  });

  it("shows the likes and the user's own collections in the Browse tab, and asks for a sign-in without one", async () => {
    await spec.connect(ctx.userId);
    ctx.stub("list");
    const cards = await voxelshareBrowse.cards(ctx.userId);
    expect(cards.map((card) => [card.id, card.name, card.private, card.modelCount])).toEqual([
      ["likes", "VoxelShare likes", true, 3],
      ["61696524861853703", "My Collection", true, 0],
      ["61700000000000001", "Printer upgrades", false, 4],
    ]);
    expect(cards[2].thumbnails).toHaveLength(3);

    // A likes read that fails is a failure, not an empty list.
    ctx.stub("likesDown");
    await expect(voxelshareBrowse.cards(ctx.userId)).rejects.toThrow("Couldn't read your likes on VoxelShare");

    await spec.disconnect(ctx.userId);
    await expect(voxelshareBrowse.cards(ctx.userId)).rejects.toMatchObject({ status: 409 });
  });

  it("lists its home page's trending models for the trending panel", async () => {
    ctx.stub("ok");
    const trending = await voxelshareTrending.fetch(ctx.userId, 4);
    expect(Array.isArray(trending) && trending.length).toBe(4);
    expect(Array.isArray(trending) && trending[0]).toMatchObject({
      url: expect.stringMatching(/^https:\/\/www\.voxelshare\.com\/en\/models\/\d+$/),
      paid: false,
    });
  });

  it("holds the likes' sync once their sign-in is turned down, but keeps one saved while they were read", async () => {
    const { syncCollection } = await import("../../src/services/collectionSyncRunner");
    const { findOrCreateCollectionByName } = await import("../../src/services/collectionService");
    await spec.connect(ctx.userId);
    const rejecting = handlerFor("rejected");
    ctx.install(async (call) => {
      // Grab sends a new sign-in while the likes are being read with the old one.
      if (call.url.pathname.endsWith("like_list")) await setUserVoxelshareSession(ctx.userId, NEWER);
      return rejecting(call);
    });
    const collection = await findOrCreateCollectionByName(ctx.userId, "VoxelShare likes, held");
    const sync = await prisma.collectionSync.create({
      data: {
        userId: ctx.userId,
        collectionId: collection.id,
        provider: "voxelshare",
        externalId: "likes",
        sourceUrl: LIKES_URL,
      },
    });
    try {
      expect(await syncCollection(sync.id)).toBe("disconnected");
      const held = await prisma.collectionSync.findUniqueOrThrow({ where: { id: sync.id } });
      expect(held.lastError).toBe("VoxelShare sign-in ran out");
      expect(await getVoxelshareConnection(ctx.userId)).toBe("connected");
    } finally {
      await prisma.collectionSync.delete({ where: { id: sync.id } }).catch(() => undefined);
      await prisma.collection.delete({ where: { id: collection.id } }).catch(() => undefined);
    }
  });

  it("holds a sync of a private collection it has no sign-in to read, rather than taking it for gone", async () => {
    const { fetchListing } = await import("../../src/services/collectionSyncRunner");
    await spec.disconnect(ctx.userId);
    ctx.stub("private");
    const sync = { userId: ctx.userId, provider: "voxelshare", externalId: COLLECTION_ID, sourceUrl: COLLECTION_URL };
    await expect(fetchListing(sync)).rejects.toThrow("VoxelShare isn't connected to read this collection");
  });
});

describe("VoxelShare sign-in", () => {
  it("forgets the sign-in Grab saw signed out, but not one pasted in Thingport since", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/register")
      .send({
        displayName: "Grab sign-out",
        email: `voxel-signout-${Date.now()}@example.com`,
        password: "password123",
      });
    const userId: string = res.body.user.id;
    const patch = (body: Record<string, unknown>) =>
      request(app)
        .patch("/api/providers/voxelshare/connection")
        .set({ Authorization: `Bearer ${res.body.token}` })
        .send(body);
    try {
      await setUserVoxelshareSession(userId, TOKEN);
      expect((await patch({ token: null, signed_out_of: TOKEN })).body).toEqual({ configured: false });
      expect(await getVoxelshareConnection(userId)).toBe("disconnected");

      await setUserVoxelshareSession(userId, NEWER);
      expect((await patch({ token: null, signed_out_of: TOKEN })).body).toEqual({ configured: true });
      expect(await getUserVoxelshareToken(userId)).toBe(NEWER);

      // Disconnecting in Thingport clears whatever is there.
      expect((await patch({ token: null })).body).toEqual({ configured: false });
    } finally {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
  });

  it("keeps whose the sign-in is through a renewal, and forgets it for another account's", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Whose", email: `voxel-whose-${Date.now()}@example.com`, password: "password123" });
    const userId: string = res.body.user.id;
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const renewed = `${part({ alg: "RS256" })}.${part({ sub: "1", exp: 4102444800 })}.c2lnbmF0dXJl`;
    try {
      await setUserVoxelshareSession(userId, TOKEN, { id: "a1", name: "Maker 1" });
      // Grab sends the token the site renewed, saying nothing of whose it is.
      await setUserVoxelshareSession(userId, renewed);
      expect(await getVoxelshareAccountName(userId)).toBe("Maker 1");
      // Someone else signed in there.
      await setUserVoxelshareSession(userId, NEWER);
      expect(await getVoxelshareAccountName(userId)).toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
  });

  it("takes a token that has run out as expired, without asking VoxelShare", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Ran out", email: `voxel-expired-${Date.now()}@example.com`, password: "password123" });
    const userId: string = res.body.user.id;
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const old = `${part({ alg: "RS256" })}.${part({ sub: "1", exp: 1700000000 })}.c2lnbmF0dXJl`;
    try {
      await setUserVoxelshareSession(userId, old);
      expect(await getVoxelshareConnection(userId)).toBe("expired");
      expect(await getUserVoxelshareToken(userId)).toBeNull();
    } finally {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
  });

  it("reads the token however it's pasted", () => {
    expect(normalizeVoxelshareSession(TOKEN)).toBe(TOKEN);
    expect(normalizeVoxelshareSession(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(normalizeVoxelshareSession(`authorization: Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(normalizeVoxelshareSession(`Cookie: app_did=abc; token=${TOKEN}; token_expires_in=2678400`)).toBe(TOKEN);
    // A row of the browser's cookie table, as its developer tools copy it.
    expect(normalizeVoxelshareSession(`app_did\tabc\ntoken\t${TOKEN}\twww.voxelshare.com\t/\t2026-12-15`)).toBe(TOKEN);
    expect(normalizeVoxelshareSession("refresh_token=NJU0NTM2MZYTOTBK")).toBeNull();
    expect(normalizeVoxelshareSession("not a sign-in")).toBeNull();
    expect(voxelshareTokenExpiry(TOKEN)?.toISOString()).toBe("2099-01-01T00:00:00.000Z");
  });
});

describe("VoxelShare China", () => {
  /** Neither site's sign-in, as each test starts and ends. */
  const signOutOfBoth = () => spec.disconnect(ctx.userId);

  it("imports a China site link from its API, kept under a cn- id that links back there", async () => {
    await signOutOfBoth();
    const stub = ctx.install(handlerFor("ok", "several"));
    expectStatus(await ctx.importUrl(CHINA_MODEL_URL), 200);
    const [print] = await ctx.prints();
    expect(print.sourceExternalId).toBe(`cn-${MODEL_ID}`);
    expect(modelUrl("voxelshare", print.sourceExternalId!)).toBe(`https://www.voxelshare.cn/zh/models/${MODEL_ID}`);
    const apis = stub.calls.filter((call) => call.url.hostname.startsWith("api."));
    expect(apis.length).toBeGreaterThan(0);
    expect(apis.every((call) => call.url.hostname === "api.voxelshare.cn")).toBe(true);
    // Its files are on the image host both sites share.
    expect(stub.callsTo("webimage.voxelshare.com").length).toBeGreaterThan(0);

    // The main site's link to the same model is the main site's model, kept apart.
    ctx.install(handlerFor("ok", "several"));
    expectStatus(await ctx.importUrl(MODEL_URL), 200);
    expect((await ctx.prints()).map((each) => each.sourceExternalId).toSorted()).toEqual([MODEL_ID, `cn-${MODEL_ID}`]);
  });

  it("checks a China sign-in with the China site, and keeps it beside the main site's", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "China", email: `voxel-china-${Date.now()}@example.com`, password: "password123" });
    const userId: string = res.body.user.id;
    const as = { Authorization: `Bearer ${res.body.token}` };
    const connect = (token: string) =>
      request(app).patch("/api/providers/voxelshare/connection/cn").set(as).send({ token, verify: true });
    try {
      const stub = ctx.stub("ok");
      const saved = await connect(CHINA_TOKEN);
      expectStatus(saved, 200);
      expect(saved.body).toEqual({ configured: true });
      expect(stub.callsTo("api.voxelshare.cn").map((call) => call.url.pathname)).toEqual([
        "/api/v3/creator/self/profile",
      ]);
      expect(await getVoxelshareConnection(userId, "cn")).toBe("connected");
      expect(await getVoxelshareConnection(userId)).toBe("disconnected");
      const listed = await request(app).get("/api/providers").set(as);
      const slots = listed.body.providers.find((p: { id: string }) => p.id === "voxelshare").slots;
      expect(slots.cn).toMatchObject({ status: "connected" });
      expect(slots.default).toMatchObject({ status: "disconnected" });

      // The main site's sign-in, which the China site doesn't know, is turned down there.
      ctx.install(async (call) => {
        if (call.url.hostname === "api.voxelshare.cn" && call.headers.authorization === `Bearer ${TOKEN}`)
          return json(loadFixture("voxelshare", "unauthorized"), 401);
        return handlerFor("ok")(call);
      });
      expect((await connect(TOKEN)).status).toBe(422);
      expect(await getUserVoxelshareToken(userId, "cn")).toBe(CHINA_TOKEN);
    } finally {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
  });

  it("lists the China likes with the China sign-in alone, as a list of their own", async () => {
    await signOutOfBoth();
    await setUserVoxelshareSession(ctx.userId, CHINA_TOKEN, null, "cn");
    const stub = ctx.stub("list");
    const china = await ctx.post(spec.list!.endpoint, { url: CHINA_LIKES_URL });
    expectStatus(china, 200);
    expect(china.body.title).toBe("VoxelShare China likes");
    expect(china.body.entries.map((entry: { design_id: string }) => entry.design_id)).toEqual(
      LIKED.map((id) => `cn-${id}`),
    );
    expect(stub.callsTo("api.voxelshare.com")).toHaveLength(0);

    // The main site's likes still need the main site's sign-in.
    const main = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
    expect(main.status).toBe(400);
    expect(main.body.code).toBe("voxelshare_session");
    expect(main.body.detail).toMatch(/www\.voxelshare\.com/);
    await signOutOfBoth();
  });

  it("syncs a China collection from the China site, its models under their cn- ids", async () => {
    const { fetchListing } = await import("../../src/services/collectionSyncRunner");
    await signOutOfBoth();
    const stub = ctx.stub("ok");
    const sync = {
      userId: ctx.userId,
      provider: "voxelshare",
      externalId: `cn-${COLLECTION_ID}`,
      sourceUrl: CHINA_COLLECTION_URL,
    };
    expect(await fetchListing(sync)).toEqual(COLLECTED.map((id) => `cn-${id}`));
    expect(stub.callsTo("api.voxelshare.com")).toHaveLength(0);
  });

  it("holds the China likes' sync in the China site's words while it isn't connected", async () => {
    const { fetchListing } = await import("../../src/services/collectionSyncRunner");
    await signOutOfBoth();
    await spec.connect(ctx.userId);
    ctx.stub("ok");
    const sync = { userId: ctx.userId, provider: "voxelshare", externalId: "cn-likes", sourceUrl: CHINA_LIKES_URL };
    await expect(fetchListing(sync)).rejects.toThrow("VoxelShare China isn't connected");
    await signOutOfBoth();
  });

  it("shows each signed-in site's lists in the Browse tab, and the rest when one site turns its sign-in down", async () => {
    await signOutOfBoth();
    await spec.connect(ctx.userId);
    await setUserVoxelshareSession(ctx.userId, CHINA_TOKEN, null, "cn");
    ctx.stub("list");
    const cards = await voxelshareBrowse.cards(ctx.userId);
    expect(cards.map((card) => [card.id, card.name])).toEqual([
      ["likes", "VoxelShare likes"],
      ["61696524861853703", "My Collection"],
      ["61700000000000001", "Printer upgrades"],
      ["cn-likes", "VoxelShare China likes"],
      ["cn-61696524861853703", "My Collection"],
      ["cn-61700000000000001", "Printer upgrades"],
    ]);
    expect(cards[3].url).toBe(CHINA_LIKES_URL);

    ctx.install(async (call) => {
      if (call.url.hostname === "api.voxelshare.cn") return json(loadFixture("voxelshare", "unauthorized"), 401);
      return handlerFor("list")(call);
    });
    expect((await voxelshareBrowse.cards(ctx.userId)).map((card) => card.id)).toEqual([
      "likes",
      "61696524861853703",
      "61700000000000001",
    ]);
    expect(await getVoxelshareConnection(ctx.userId, "cn")).toBe("expired");
    expect(await getVoxelshareConnection(ctx.userId)).toBe("connected");
    await signOutOfBoth();
  });

  it("shows the China site's trending models to someone signed in only there", async () => {
    await signOutOfBoth();
    expect(await voxelshareTrending.region!(ctx.userId)).toBeNull();
    await setUserVoxelshareSession(ctx.userId, CHINA_TOKEN, null, "cn");
    expect(await voxelshareTrending.region!(ctx.userId)).toBe("cn");

    const stub = ctx.stub("ok");
    const china = await getTrending("voxelshare", ctx.userId);
    expect(china).toMatchObject({ status: "ok", moreUrl: "https://www.voxelshare.cn/zh/home" });
    const models = china.status === "ok" ? china.models : [];
    expect(models[0].url).toMatch(/^https:\/\/www\.voxelshare\.cn\/zh\/models\/\d+$/);
    expect(models[0].id).toMatch(/^cn-\d+$/);
    expect(stub.callsTo("api.voxelshare.cn").length).toBeGreaterThan(0);

    // Signed in to the main site too, the main site's.
    await spec.connect(ctx.userId);
    expect(await voxelshareTrending.region!(ctx.userId)).toBeNull();
    await signOutOfBoth();
  });
});
