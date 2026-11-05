import { describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db";
import { meshyTrending } from "../../src/providers/meshy";
import { meshyBrowse } from "../../src/providers/meshy/browse";
import { meshyConnection } from "../../src/providers/meshy/connection";
import {
  getMeshyConnection,
  normalizeMeshySession,
  setUserMeshySession,
  type MeshySession,
} from "../../src/providers/meshy/session";
import { fetchListing } from "../../src/services/collectionSyncRunner";
import { SyncHeldError } from "../../src/providers/syncProblem";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import { assertThat, binary, expectStatus, html, json, loadFixture, threeMf, type FetchHandler } from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// Meshy end to end, through the API its own pages call: posts, collections and the popular listing are anyone's to
// read, but a model's files are Meshy converting it for a signed-in account (asset-url), on a signed CloudFront link.
// The sign-in is Supabase's: a short-lived access token Thingport renews from the refresh token beside it. Its answers
// are the recorded shapes in fixtures/providers/meshy, the signed-in account renamed.

const MESHY_USER = "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e";
const ACCOUNT = { userId: MESHY_USER, name: "maker-one", handle: "s1793402995maker" };
const DEVICE = "b3fec3f4-515c-4672-ade3-e5b8b18391c8";
const WAF = "ecbd2976-bc8b-407a-8ff6-2a687638cbd6:FAoAdwZqAChtJwAA:v8QyctEl8XS02Ih8+ThP2xgivkt8cwu0tF8yPt8ijBy=";
const POST_ID = "01a1a8bd-7d1a-757e-a8bc-b5f5a93723c5";
const POST_TASK = "01a0d0d4-a717-74ff-975b-b71d7cc2beed";
const PHOTO_POST_ID = "01a1560f-f5f6-7426-80e3-4876e325f98f";
const OWN_TASK = "01a1b2c3-1111-7222-8333-444455556666";
const EXAMPLE_TASK = "01a18f26-a4c0-7762-a46c-2c16edc01022";
const COLLECTION_ID = "30c16c30-c6de-4199-a5c4-b949b3cc5e33";
const MODEL_URL = `https://www.meshy.ai/posts/011-forgotten-temple-${POST_ID}`;
const COLLECTION_URL = `https://www.meshy.ai/collections/${COLLECTION_ID}`;
const GENERATIONS_URL = `https://www.meshy.ai/workspace?user=${MESHY_USER}`;
const COLLECTION_POSTS = [
  "0196f842-8f5b-7674-942e-b4a2ac8e2cd8",
  "0196eacb-b71c-72b1-8b6b-d023d062d6d1",
  "0196be4d-5d1a-71ce-917d-0735ba3abf3d",
  "0196be47-df89-71ce-8a20-067c4a4b9e7b",
  "01954f35-56e4-73df-be47-bb9307c0566f",
  "01950f41-6f72-70c1-92a1-687fc58bbc77",
];

const IN_2100 = 4102444800;
const jwt = (claims: Record<string, unknown>) =>
  [{ alg: "ES256", typ: "JWT" }, claims]
    .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
    .join(".") + ".c2lnbmF0dXJl";
const TOKEN = jwt({ sub: MESHY_USER, exp: IN_2100, session_id: "first" });
const RENEWED = jwt({ sub: MESHY_USER, exp: IN_2100, session_id: "renewed" });
const EXPIRED = jwt({ sub: MESHY_USER, exp: 1700000000, session_id: "old" });
const REFRESH = "firstrefresh";

/** The browser's sign-in cookies as Supabase writes them: `base64-` and the session's JSON, split in two. */
function cookieFor(accessToken: string, refreshToken = REFRESH): string {
  const value = `base64-${Buffer.from(
    JSON.stringify({
      access_token: accessToken,
      token_type: "bearer",
      expires_in: 900,
      expires_at: IN_2100,
      refresh_token: refreshToken,
      user: { id: MESHY_USER },
    }),
  ).toString("base64url")}`;
  const half = Math.ceil(value.length / 2);
  return [
    `sb-auth-auth-token.0=${value.slice(0, half)}`,
    `sb-auth-auth-token.1=${value.slice(half)}`,
    `meshy_device_id=${DEVICE}`,
    `aws-waf-token=${WAF}`,
  ].join("; ");
}

const sessionOf = (accessToken: string): MeshySession => normalizeMeshySession(cookieFor(accessToken))!;

const signedIn = (headers: Record<string, string | undefined>) =>
  headers.authorization === `Bearer ${TOKEN}` || headers.authorization === `Bearer ${RENEWED}`;

/** `answers` replaces what one path answers with, for a variant of the ok scenario. */
function handlerFor(scenario: string, answers: Record<string, () => Response> = {}): FetchHandler {
  return async ({ url, headers, json: body }) => {
    if (url.hostname === "assets.meshy.ai") return binary(await threeMf(url.pathname), "model/3mf");
    if (url.hostname === "auth.meshy.ai") {
      assertThat(url.searchParams.get("grant_type") === "refresh_token", "only ever renews");
      assertThat(headers.apikey?.startsWith("eyJ"), "Supabase wants its public key beside every call");
      if (answers.refresh) return answers.refresh();
      if (scenario === "rejected" || body?.refresh_token !== REFRESH) {
        return json(loadFixture("meshy", "refresh-rejected"), 400);
      }
      return json({ ...loadFixture("meshy", "refresh"), access_token: RENEWED, expires_at: IN_2100 });
    }
    if (url.hostname !== "www.meshy.ai" || !url.pathname.startsWith("/meshyd-api/web/")) return undefined;
    const path = url.pathname.slice("/meshyd-api/web".length);
    const answer = answers[path];
    if (answer) return answer();

    // Anyone's to read.
    const post = path.match(/^\/public\/community\/posts\/([\w-]+)$/)?.[1];
    if (post) {
      if (scenario === "missing") return json(loadFixture("meshy", "post-missing"), 404);
      if (post === POST_ID) return json(loadFixture("meshy", "post"));
      if (post === PHOTO_POST_ID) return json(loadFixture("meshy", "post-photos"));
      return json(loadFixture("meshy", "post-missing"), 404);
    }
    if (path === "/public/community/posts") {
      if (url.searchParams.get("communityCollectionId") === COLLECTION_ID) {
        return json(loadFixture("meshy", "collection-posts"));
      }
      assertThat(url.searchParams.get("is3DPrintable") === "true", "trending is the printable posts");
      return json(loadFixture("meshy", "popular"));
    }
    if (path === `/public/community-collections/${COLLECTION_ID}`) {
      if (scenario === "gone") return json(loadFixture("meshy", "collection-missing"), 404);
      return json(loadFixture("meshy", "collection"));
    }
    if (path === "/public/community-collections") {
      assertThat(url.searchParams.get("createdBy") === MESHY_USER, "a user's collections are asked for by their id");
      return json(loadFixture("meshy", "user-collections"));
    }

    // The signed-in account's.
    if (!signedIn(headers) || scenario === "rejected") return json(loadFixture("meshy", "invalid-token"), 401);
    assertThat(headers["x-device-id"] === DEVICE, "calls go as the browser's device");
    if (path === "/v1/me/info") return json(loadFixture("meshy", "me"));
    if (path === "/v2/tasks") return json(loadFixture("meshy", "tasks"));
    if (path === `/v2/tasks/${OWN_TASK}`) return json(loadFixture("meshy", "task"));
    if (path === `/v2/tasks/${EXAMPLE_TASK}`) {
      const tasks = loadFixture("meshy", "tasks");
      return json({ ...tasks, result: tasks.result.find((task: { id: string }) => task.id === EXAMPLE_TASK) });
    }
    if (/^\/v2\/tasks\/[\w-]+$/.test(path)) return json(loadFixture("meshy", "task-missing"), 404);
    if (path.endsWith("/asset-url")) {
      assertThat(url.searchParams.get("format") === "3mf", "a model is converted to a 3MF");
      return json(loadFixture("meshy", "asset-url"));
    }
    if (path.endsWith("/mark-downloaded")) return json(loadFixture("meshy", "mark-downloaded"));
    return undefined;
  };
}

const connect = (userId: string, accessToken = TOKEN) => setUserMeshySession(userId, sessionOf(accessToken), ACCOUNT);

const spec: ProviderContractSpec = {
  id: "meshy",
  name: "Meshy",
  modelUrl: MODEL_URL,
  expected: {
    externalId: POST_ID,
    title: "011 Forgotten Temple",
    notesIncludes: "FRAGMENTED WORLDS",
    author: "lk_antunes",
    tags: ["Ancient", "Roots", "Ruins", "Stone", "Temple"],
    // The first of its categories Thingport has a place for: Architecture, before Nature & Plants.
    category: { name: "Architecture", parent: "Miniatures" },
    galleryImages: 1,
    plateInstanceIds: [null],
    plateFilenames: ["011 Forgotten Temple.3mf"],
  },
  connect: (userId) => connect(userId),
  disconnect: async (userId) => {
    await setUserMeshySession(userId, null);
  },
  createHandler: (scenario) => handlerFor(scenario),
  credentials: {
    sessionCode: "meshy_session",
    connection: async (userId) => (await getMeshyConnection(userId)).state,
  },
  reimport: {},
  list: {
    endpoint: "/api/import/meshy/list/entries",
    url: COLLECTION_URL,
    title: "maker-one's collection",
    importedId: COLLECTION_POSTS[0],
    freshId: COLLECTION_POSTS[1],
  },
  // A collection is anyone's to read; only the files in it need the sign-in.
  listing: {
    sync: { externalId: COLLECTION_ID, sourceUrl: COLLECTION_URL },
    ids: COLLECTION_POSTS,
    needsSignIn: false,
  },
};

const ctx = describeProviderContract(spec);

const platesOf = async (printId: string) =>
  (await prisma.plate.findMany({ where: { printId }, orderBy: { position: "asc" } })).map((plate) => plate.filename);

describe("Meshy specifics", () => {
  it("asks Meshy to convert a community model for the account, as the browser's device, and says it was downloaded", async () => {
    await connect(ctx.userId);
    const stub = ctx.stub("ok");
    expectStatus(await ctx.importUrl(), 200);
    const convert = stub.calls.find((call) => call.url.pathname.endsWith("/asset-url"));
    expect(convert?.url.pathname).toBe(`/meshyd-api/web/v2/tasks/${POST_TASK}/asset-url`);
    expect(convert?.url.searchParams.get("type")).toBe("Showcase");
    expect(convert?.headers.cookie).toBe(`aws-waf-token=${WAF}`);
    const marked = stub.calls.find((call) => call.url.pathname.endsWith("/mark-downloaded"));
    expect(marked?.method).toBe("POST");
    expect(marked?.json).toEqual({ format: "3mf" });
  });

  it("keeps a post's photos with its model's render, and names the file after the post", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    expectStatus(await ctx.importUrl(`https://www.meshy.ai/posts/fangy-mchowl-${PHOTO_POST_ID}`), 200);
    const [print] = await ctx.prints();
    expect(print.title).toBe("Fangy McHowl");
    expect(await platesOf(print.id)).toEqual(["Fangy McHowl.3mf"]);
    expect(await prisma.previewImage.count({ where: { printId: print.id, generated: false } })).toBe(6);
  });

  it("takes the older /3d-models/ address of a post as the same post", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    expectStatus(await ctx.importUrl(`https://www.meshy.ai/3d-models/011-forgotten-temple-${POST_ID}`), 200);
    expect((await ctx.prints()).map((print) => print.sourceExternalId)).toEqual([POST_ID]);
  });

  it("says a community model needs Pro on a plan without it, and leaves the sign-in alone", async () => {
    await connect(ctx.userId);
    ctx.install(
      handlerFor("ok", {
        [`/v2/tasks/${POST_TASK}/asset-url`]: () => json(loadFixture("meshy", "asset-url-plan"), 402),
      }),
    );
    const res = await ctx.importUrl();
    expect(res.status).toBe(403);
    expect(res.body.detail).toContain("Pro and Studio");
    expect(await ctx.prints()).toHaveLength(0);
    expect((await getMeshyConnection(ctx.userId)).state).toBe("connected");
  });

  it("stops with the download-limit code once the month's downloads are used up", async () => {
    await connect(ctx.userId);
    ctx.install(
      handlerFor("ok", {
        [`/v2/tasks/${POST_TASK}/asset-url`]: () => json(loadFixture("meshy", "asset-url-limit"), 403),
      }),
    );
    const res = await ctx.importUrl();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("MESHY_DOWNLOAD_LIMIT");
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("renews an access token that has run out, and keeps the refresh token Supabase hands back", async () => {
    await connect(ctx.userId, EXPIRED);
    const stub = ctx.stub("ok");
    expectStatus(await ctx.importUrl(), 200);
    expect(stub.callsTo("auth.meshy.ai").map((call) => call.json)).toEqual([{ refresh_token: REFRESH }]);
    const row = await prisma.providerConnection.findFirstOrThrow({ where: { userId: ctx.userId, provider: "meshy" } });
    expect(row.secret).toMatchObject({ accessToken: RENEWED, refreshToken: "nextrefresh2", deviceId: DEVICE });
  });

  it("renews once and tries again when Meshy turns the access token down", async () => {
    await connect(ctx.userId);
    let refused = 0;
    ctx.install(async (call) => {
      if (call.url.pathname.endsWith("/asset-url") && call.headers.authorization === `Bearer ${TOKEN}`) {
        refused++;
        return json(loadFixture("meshy", "invalid-token"), 401);
      }
      return handlerFor("ok")(call);
    });
    expectStatus(await ctx.importUrl(), 200);
    expect(refused).toBe(1);
    expect((await getMeshyConnection(ctx.userId)).state).toBe("connected");
  });

  it("leaves the sign-in alone when Supabase can't renew it, rather than marking it ended", async () => {
    await connect(ctx.userId, EXPIRED);
    ctx.install(handlerFor("ok", { refresh: () => html("<title>502 Bad Gateway</title>", 502) }));
    const res = await ctx.importUrl();
    expect(res.status).not.toBe(200);
    expect(res.body.code).not.toBe("meshy_session");
    expect((await getMeshyConnection(ctx.userId)).state).toBe("connected");
  });

  it("imports one of the user's own generations from their workspace, with the prompt it was made from", async () => {
    await connect(ctx.userId);
    const stub = ctx.stub("ok");
    expectStatus(await ctx.importUrl(`https://www.meshy.ai/workspace?task=${OWN_TASK}&sidebar=print`), 200);
    const [print] = await ctx.prints();
    expect(print.sourceExternalId).toBe(`task-${OWN_TASK}`);
    expect(print.title).toBe("Sleepy Fox Keychain");
    expect(print.notes).toContain("sleepy fox curled up");
    expect(print.creator).toBe("maker-one");
    expect(await platesOf(print.id)).toEqual(["Sleepy Fox Keychain.3mf"]);
    const convert = stub.calls.find((call) => call.url.pathname.endsWith("/asset-url"));
    expect(convert?.url.pathname).toBe(`/meshyd-api/web/v2/tasks/${OWN_TASK}/asset-url`);
    expect(convert?.url.searchParams.get("type")).toBe("Task");
  });

  it("lists the user's own generations, leaving out Meshy's examples and the pictures, and turns down another's", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    const res = await ctx.post("/api/import/meshy/list/entries", { url: GENERATIONS_URL });
    expectStatus(res, 200);
    expect(res.body.title).toBe("Meshy generations");
    expect(res.body.entries.map((entry: { design_id: string }) => entry.design_id)).toEqual([`task-${OWN_TASK}`]);
    expect(res.body.total).toBe(1);

    // Left out of the list, but still the user's to import by its link.
    expectStatus(await ctx.importUrl(`https://www.meshy.ai/workspace?task=${EXAMPLE_TASK}`), 200);
    expect((await ctx.prints()).map((print) => print.title)).toEqual(["Anxious Adventurer Panda"]);

    const someoneElse = await ctx.post("/api/import/meshy/list/entries", {
      url: "https://www.meshy.ai/workspace?user=11111111-2222-4333-8444-555555555555",
    });
    expect(someoneElse.status).toBe(400);
    expect(someoneElse.body.detail).toContain("another Meshy account");
  });

  it("asks for a sign-in before listing anything, as every file needs one", async () => {
    ctx.stub("ok");
    const res = await ctx.post("/api/import/meshy/list/entries", { url: COLLECTION_URL });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("meshy_session");
  });

  it("syncs the user's generations, and holds a sync of another account's rather than unsyncing it", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    const own = {
      userId: ctx.userId,
      provider: "meshy",
      externalId: `generations-${MESHY_USER}`,
      sourceUrl: GENERATIONS_URL,
    };
    expect(await fetchListing(own)).toEqual([`task-${OWN_TASK}`]);
    const another = "11111111-2222-4333-8444-555555555555";
    await expect(
      fetchListing({
        ...own,
        externalId: `generations-${another}`,
        sourceUrl: `https://www.meshy.ai/workspace?user=${another}`,
      }),
    ).rejects.toBeInstanceOf(SyncHeldError);
  });

  it("shows the user's generations and their collections in the Browse tab, and asks for a sign-in without one", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    const cards = await meshyBrowse.cards(ctx.userId);
    expect(cards.map((card) => [card.id, card.name, card.modelCount, card.private])).toEqual([
      [`generations-${MESHY_USER}`, "Meshy generations", 1, true],
      [COLLECTION_ID, "maker-one's collection", 6, false],
    ]);
    expect(cards.map((card) => card.url)).toEqual([GENERATIONS_URL, COLLECTION_URL]);

    await setUserMeshySession(ctx.userId, null);
    await expect(meshyBrowse.cards(ctx.userId)).rejects.toMatchObject({ status: 409 });
  });

  it("lists the most popular printable posts for the trending panel", async () => {
    ctx.stub("ok");
    const models = await meshyTrending.fetch(ctx.userId, 2);
    assertThat(Array.isArray(models), "a list, not a setup");
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({ id: "01977b49-47c8-7059-ba30-b5e353d19c39", paid: false });
    expect(models[0].url).toBe("https://www.meshy.ai/posts/01977b49-47c8-7059-ba30-b5e353d19c39");
  });

  it("keeps a pasted Cookie header with who it is, and turns one Meshy doesn't take down when asked to check", async () => {
    ctx.stub("ok");
    const pasted = `:authority\nwww.meshy.ai\ncookie\nclient_ip=1.2.3.4; ${cookieFor(TOKEN)}; geo_country=PL\nuser-agent\nMozilla/5.0`;
    expect(await meshyConnection.save(ctx.userId, { session: pasted, verify: true })).toEqual({ configured: true });
    expect(await getMeshyConnection(ctx.userId)).toEqual({ state: "connected", account: ACCOUNT });

    ctx.stub("rejected");
    await expect(meshyConnection.save(ctx.userId, { session: cookieFor(TOKEN), verify: true })).rejects.toMatchObject({
      status: 422,
    });
    await expect(meshyConnection.save(ctx.userId, { session: "not a cookie", verify: true })).rejects.toMatchObject({
      status: 422,
    });
  });

  it("keeps the renewed session when the check had to renew a sign-in that had run out", async () => {
    ctx.stub("ok");
    await meshyConnection.save(ctx.userId, { session: cookieFor(EXPIRED) });
    const row = await prisma.providerConnection.findFirstOrThrow({ where: { userId: ctx.userId, provider: "meshy" } });
    // The refresh token it came with is spent: only the one Supabase handed back renews it now.
    expect(row.secret).toMatchObject({ accessToken: RENEWED, refreshToken: "nextrefresh2" });
  });
});

describe("Meshy sign-in", () => {
  it("reads the session out of its split cookie, with the device id and bot-check token beside it", () => {
    const jumbled = cookieFor(TOKEN).split("; ").toReversed().join("; ");
    expect(normalizeMeshySession(`statsig-stable-id=abc; ${jumbled}`)).toEqual({
      accessToken: TOKEN,
      refreshToken: REFRESH,
      deviceId: DEVICE,
      wafToken: WAF,
      userId: MESHY_USER,
      expiresAt: new Date(IN_2100 * 1000),
    });
  });

  it("takes an unsplit cookie, and nothing from a page without a sign-in", () => {
    const whole = cookieFor(TOKEN)
      .split("; ")
      .filter((part) => part.startsWith("sb-auth-auth-token."))
      .map((part) => part.split("=")[1])
      .join("");
    expect(normalizeMeshySession(`sb-auth-auth-token=${whole}`)?.accessToken).toBe(TOKEN);
    expect(normalizeMeshySession(`meshy_device_id=${DEVICE}; geo_country=PL`)).toBeNull();
    expect(normalizeMeshySession("")).toBeNull();
    expect(normalizeMeshySession(null)).toBeNull();
  });
});
