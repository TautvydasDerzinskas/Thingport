import { describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db";
import { fab365Browse } from "../../src/providers/fab365/browse";
import { fab365Connection } from "../../src/providers/fab365/connection";
import {
  decodeFab365Token,
  Fab365AuthError,
  fab365GalleryFrom,
  fab365LikesFrom,
  fab365ModelFrom,
  refreshFab365Session,
} from "../../src/providers/fab365/api";
import { fab365Trending } from "../../src/providers/fab365";
import {
  getFab365Connection,
  normalizeFab365Session,
  readFab365Paste,
  setUserFab365Session,
} from "../../src/providers/fab365/session";
import { fetchListing } from "../../src/services/collectionSyncRunner";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import { binary, expectStatus, html, json, loadFixture, stl, zip, type FetchHandler } from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// Fab365 end to end, from the JSON API its pages call: a model's detail from `/api/v2/item/detail`, its gallery from
// `/api/item/data`, its designer from `/api/v2/designer/<id>/info`, and one zip of all its files from a signed link
// `/api/my/downloads/<id>` hands a signed-in owner. Its answers are the recorded shapes in fixtures/providers/fab365,
// trimmed -- the model's description cut short, three gallery pictures, the signed-in member renamed. A free model
// downloads with any signed-in account; a paid one answers `cannot_downloadable` until it's bought.

const b64url = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const jwt = (claims: object) => `${b64url({ typ: "JWT", alg: "HS256" })}.${b64url(claims)}.${"sig".repeat(10)}`;
// `index` tells tokens apart however close together they're made, so one never stands in for another by accident.
const token = (seconds: number, index = "2af8a746") =>
  jwt({ loginId: "242181", loginType: "W", index, iat: 0, exp: Math.floor(Date.now() / 1000) + seconds });

const ACCESS = token(3600);
const REFRESH = token(7200);
const ACCOUNT = { userId: "242181", name: "maker-one" };

const API = "/api";
const MODEL_URL = "https://fab365.net/items/116";
const LIKES_URL = "https://fab365.net/my/likes";
const ZIP_HOST = "fab-model-v2.s3.ap-northeast-2.amazonaws.com";
const PLATES = ["Fab365_JetPack-A.stl", "Fab365_JetPack-B.stl"];

type Overrides = {
  /** Which access tokens the API accepts, besides the default one. */
  accepts?: string[];
  /** What `/api/v3_1/refresh` answers with: a new pair, Fab365's own refusal, or an outage's page that isn't its JSON. */
  refresh?: { access: string; refresh: string } | "fail" | "outage";
  /** Run before a request whose path matches is answered, such as another sign-in saved meanwhile. */
  before?: { path: RegExp; run: () => Promise<unknown> };
};

function handlerFor(scenario: string, over: Overrides = {}): FetchHandler {
  const accepts = new Set([ACCESS, ...(over.accepts ?? [])]);
  const authed = (headers: Record<string, string | undefined>) => {
    if (scenario === "rejected") return false;
    const bearer = headers.authorization?.replace(/^Bearer /, "") ?? "";
    return accepts.has(bearer);
  };
  const unauthorized = () => json({ returnCode: "E00005", message: "Unauthorized" }, 401);
  return async ({ url, method, headers }) => {
    if (over.before?.path.test(url.pathname)) await over.before.run();
    if (url.hostname === ZIP_HOST && url.pathname.endsWith(".zip")) {
      return binary(await zip("fab365", Object.fromEntries(PLATES.map((name) => [name, stl(name)]))));
    }
    if (url.hostname !== "fab365.net") return undefined;
    const p = url.pathname;
    if (p === `${API}/v2/item/detail/116`) {
      return scenario === "missing"
        ? json({ returnCode: "C00009", message: "NO data retured" })
        : json(loadFixture("fab365", "detail"));
    }
    if (p === `${API}/v2/item/detail/3222`) return json(loadFixture("fab365", "detail-paid"));
    if (p.startsWith(`${API}/v2/item/detail/`)) return json({ returnCode: "C00009", message: "NO data retured" });
    if (p === `${API}/item/data/116`) return json(loadFixture("fab365", "gallery"));
    if (p.startsWith(`${API}/item/data/`)) return json({ returnCode: "C00009" });
    if (p === `${API}/v2/designer/29/info`) return json(loadFixture("fab365", "designer"));
    if (p === `${API}/my/downloads/116`)
      return authed(headers) ? json(loadFixture("fab365", "downloads")) : unauthorized();
    if (p === `${API}/my/downloads/3222`)
      return authed(headers) ? json({ returnCode: "E00108", message: "cannot_downloadable - " }) : unauthorized();
    if (p === `${API}/my/likes`) return authed(headers) ? json(loadFixture("fab365", "likes")) : unauthorized();
    if (p === `${API}/my/profile`) return authed(headers) ? json(loadFixture("fab365", "profile")) : unauthorized();
    if (p === `${API}/v2/item/offer`) return json(loadFixture("fab365", "popular"));
    if (p === `${API}/v3_1/refresh` && method === "POST") {
      if (over.refresh === "outage") return html("<html><body><h1>502 Bad Gateway</h1></body></html>", 502);
      if (!over.refresh || over.refresh === "fail") return json({ returnCode: "C00008", code: "error_request_fail" });
      return json({
        returnCode: "C00000",
        data: { access_token: over.refresh.access, refresh_token: over.refresh.refresh },
      });
    }
    return undefined;
  };
}

const connect = (userId: string, access = ACCESS, refresh: string | null = REFRESH) =>
  setUserFab365Session(
    userId,
    { accessToken: access, refreshToken: refresh, userId: "242181", expiresAt: decodeFab365Token(access)!.expiresAt },
    { ...ACCOUNT },
  );

const spec: ProviderContractSpec = {
  id: "fab365",
  name: "Fab365",
  modelUrl: MODEL_URL,
  expected: {
    externalId: "116",
    title: "Jet Pack & Laser gun",
    notesIncludes: "additional equipments for the foldable robot",
    author: "GOODesign",
    tags: [],
    category: { name: "Toys & Games", parent: null },
    galleryImages: 3,
    plateInstanceIds: [null, null],
    plateFilenames: PLATES,
  },
  connect: (userId) => connect(userId),
  disconnect: async (userId) => {
    await setUserFab365Session(userId, null);
  },
  createHandler: (scenario) => handlerFor(scenario),
  credentials: {
    sessionCode: "fab365_session",
    connection: async (userId) => (await getFab365Connection(userId)).state,
  },
  reimport: {},
  list: {
    endpoint: "/api/import/fab365/list/entries",
    url: LIKES_URL,
    title: "Fab365 favourites",
    importedId: "116",
    freshId: "428",
  },
  // The favourites are the user's own, read with their sign-in, and never gone.
  listing: {
    sync: { externalId: "likes", sourceUrl: LIKES_URL },
    ids: ["116", "428", "232"],
    needsSignIn: true,
    neverGone: true,
  },
};

const ctx = describeProviderContract(spec);

describe("Fab365 specifics", () => {
  it("answers a model Fab365 doesn't have with 404", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    expect((await ctx.importUrl("https://fab365.net/items/999999")).status).toBe(404);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("imports the one zip Fab365 hands over, unpacked into the model's files, with its designer and gallery", async () => {
    await connect(ctx.userId);
    const stub = ctx.stub("ok");
    expectStatus(await ctx.importUrl(), 200);
    const [print] = await ctx.prints();
    const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
    expect(plates.map((plate) => plate.filename)).toEqual(PLATES);
    expect(print.creator).toBe("GOODesign");
    // One download, from the signed link its API gave.
    expect(stub.calls.filter((call) => call.url.pathname === `${API}/my/downloads/116`)).toHaveLength(1);
    expect(stub.calls.some((call) => call.url.hostname === ZIP_HOST)).toBe(true);
  });

  it("refuses a paid model the user hasn't bought, before asking for its files", async () => {
    await connect(ctx.userId);
    const stub = ctx.stub("ok");
    const res = await ctx.importUrl("https://fab365.net/items/3222");
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/paid Fab365 model you haven't bought/);
    // The download was never asked for: the detail's flags already said it isn't owned.
    expect(stub.calls.some((call) => call.url.pathname === `${API}/my/downloads/3222`)).toBe(false);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("renews the access token from the refresh token when it has expired, and keeps the new pair", async () => {
    const expired = token(-10);
    const fresh = token(3600);
    const nextRefresh = token(7200);
    await connect(ctx.userId, expired, REFRESH);
    ctx.install(handlerFor("ok", { accepts: [fresh], refresh: { access: fresh, refresh: nextRefresh } }));
    expectStatus(await ctx.importUrl(), 200);
    const row = await prisma.providerConnection.findFirstOrThrow({ where: { userId: ctx.userId, provider: "fab365" } });
    expect(row.secret).toEqual({ accessToken: fresh, refreshToken: nextRefresh });
    expect((await getFab365Connection(ctx.userId)).state).toBe("connected");
  });

  it("marks the sign-in expired when the refresh token is turned down", async () => {
    await connect(ctx.userId, token(-10), REFRESH);
    ctx.install(handlerFor("ok", { refresh: "fail" }));
    const res = await ctx.importUrl();
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("fab365_session");
    expect((await getFab365Connection(ctx.userId)).state).toBe("expired");
  });

  it("lists the user's favourites, free and paid alike", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    const res = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
    expectStatus(res, 200);
    expect(res.body.title).toBe("Fab365 favourites");
    expect(res.body.entries.map((e: { design_id: string }) => e.design_id)).toEqual(["116", "428", "232"]);
    expect(res.body.total).toBe(3);
  });

  it("says so when the favourites are empty", async () => {
    await connect(ctx.userId);
    ctx.install(async ({ url, headers }) => {
      if (url.pathname === `${API}/my/likes` && headers.authorization)
        return json(loadFixture("fab365", "likes-empty"));
      return undefined;
    });
    const res = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/haven't favourited anything/);
  });

  it("shows the user's favourites in the Browse tab, and asks for a sign-in without one", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    const cards = await fab365Browse.cards(ctx.userId);
    expect(cards.map((card) => [card.id, card.name, card.modelCount, card.private])).toEqual([
      ["likes", "Fab365 favourites", 3, true],
    ]);

    await setUserFab365Session(ctx.userId, null);
    await expect(fab365Browse.cards(ctx.userId)).rejects.toMatchObject({ status: 409 });
  });

  it("lists its most-liked models for the trending panel", async () => {
    ctx.stub("ok");
    const trending = await fab365Trending.fetch(ctx.userId, 3);
    expect(Array.isArray(trending) && trending.map((model) => [model.id, model.paid])).toEqual([
      ["229", true],
      ["321", false],
      ["277", true],
    ]);
  });

  it("keeps a pasted access token, and turns one Fab365 doesn't take down when asked to check", async () => {
    ctx.stub("ok");
    expect(await fab365Connection.save(ctx.userId, { token: ACCESS, verify: true })).toEqual({ configured: true });
    expect(await getFab365Connection(ctx.userId)).toEqual({ state: "connected", account: ACCOUNT });

    ctx.stub("rejected");
    await expect(
      fab365Connection.save(ctx.userId, { token: token(-10), refresh_token: REFRESH, verify: true }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(fab365Connection.save(ctx.userId, { token: "not a jwt", verify: true })).rejects.toMatchObject({
      status: 422,
    });
  });

  it("keeps the refresh token from pasted local-storage rows, so a sign-in connected by hand renews too", async () => {
    ctx.stub("ok");
    // The site's local-storage table as DevTools copies it: key, tab, value, tab -- other rows left alone, the
    // `bt_…` JWT among them.
    const table = [
      `__paypal_storage__\t{"id":"uid_x"}\t`,
      `accessToken\t${ACCESS}\t`,
      `bt_maker%40example.com\t${token(5000)}\t`,
      `refreshToken\t${REFRESH}\t`,
      `lang\ten\t`,
    ].join("\n");
    const secret = async () =>
      (await prisma.providerConnection.findFirstOrThrow({ where: { userId: ctx.userId, provider: "fab365" } })).secret;
    expect(await fab365Connection.save(ctx.userId, { token: table, verify: true })).toEqual({ configured: true });
    expect(await secret()).toEqual({ accessToken: ACCESS, refreshToken: REFRESH });

    // The access token's value alone still connects, with nothing to renew it by.
    expect(await fab365Connection.save(ctx.userId, { token: ACCESS, verify: true })).toEqual({ configured: true });
    expect(await secret()).toEqual({ accessToken: ACCESS, refreshToken: null });
  });

  it("takes only a whole-word valid_Token for a token still valid: invalid_token is a refusal", async () => {
    const secret = { accessToken: ACCESS, refreshToken: REFRESH };
    const answer = (body: object, status = 200) =>
      ctx.install(async ({ url }) => (url.pathname === `${API}/v3_1/refresh` ? json(body, status) : undefined));
    // Only the word Fab365 really sends: a message that merely mentions a valid token isn't one.
    for (const message of ["invalid_token", "Invalid Token", "valid token required"]) {
      answer({ returnCode: "E00099", message });
      await expect(refreshFab365Session(secret)).rejects.toBeInstanceOf(Fab365AuthError);
    }
    // Fab365's own answers, as seen live: `E00002` comes with valid_Token, but also refuses a refresh token with "Login
    // is required" -- on a 501, as is valid_Token -- so neither its code nor its status says which it is.
    answer({ returnCode: "E00002", message: "Login is required" }, 501);
    await expect(refreshFab365Session(secret)).rejects.toBeInstanceOf(Fab365AuthError);
    answer({ returnCode: "E00002", message: "valid_Token" }, 501);
    await expect(refreshFab365Session(secret)).resolves.toMatchObject({ accessToken: ACCESS, refreshToken: REFRESH });

    // An outage's page isn't Fab365's answer at all, so it says nothing about the token.
    ctx.install(handlerFor("ok", { refresh: "outage" }));
    const outage = await refreshFab365Session(secret).catch((err: unknown) => err);
    expect(outage).toBeInstanceOf(Error);
    expect(outage).not.toBeInstanceOf(Fab365AuthError);
  });

  const stored = async () =>
    (await prisma.providerConnection.findFirstOrThrow({ where: { userId: ctx.userId, provider: "fab365" } })).secret;

  it("doesn't mark a sign-in saved meanwhile expired when renewing the one an import started with is refused", async () => {
    const other = { access: token(3400, "other"), refresh: token(7300, "other-refresh") };
    await connect(ctx.userId, token(-10), REFRESH);
    const reconnect = { path: /\/v3_1\/refresh$/, run: () => connect(ctx.userId, other.access, other.refresh) };
    ctx.install(handlerFor("ok", { refresh: "fail", before: reconnect }));
    const res = await ctx.importUrl();
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/replaced since/);
    expect((await getFab365Connection(ctx.userId)).state).toBe("connected");
    expect(await stored()).toEqual({ accessToken: other.access, refreshToken: other.refresh });
  });

  it("doesn't mark a sign-in saved meanwhile expired when the retried one is turned down", async () => {
    const other = { access: token(3400, "other"), refresh: token(7300, "other-refresh") };
    // Stored and fresh, but turned down; renewing it hands back one that's turned down too.
    await connect(ctx.userId, token(3600, "stale"), REFRESH);
    let downloads = 0;
    const reconnect = {
      path: /\/my\/downloads\/116$/,
      run: async () => {
        if (++downloads === 2) await connect(ctx.userId, other.access, other.refresh);
      },
    };
    ctx.install(
      handlerFor("ok", {
        refresh: { access: token(3500, "renewed"), refresh: token(7250, "renewed-refresh") },
        before: reconnect,
      }),
    );
    const res = await ctx.importUrl();
    expect(res.status).toBe(409);
    expect(downloads).toBe(2);
    expect((await getFab365Connection(ctx.userId)).state).toBe("connected");
  });

  it("leaves a sign-in saved during a sync alone when the sync's own is refused", async () => {
    const other = { access: token(3400, "other"), refresh: token(7300, "other-refresh") };
    await connect(ctx.userId, token(-10), REFRESH);
    const reconnect = { path: /\/v3_1\/refresh$/, run: () => connect(ctx.userId, other.access, other.refresh) };
    ctx.install(handlerFor("ok", { refresh: "fail", before: reconnect }));
    const sync = { userId: ctx.userId, provider: "fab365", externalId: "likes", sourceUrl: LIKES_URL };
    await expect(fetchListing(sync)).rejects.toThrow(/replaced since/);
    expect((await getFab365Connection(ctx.userId)).state).toBe("connected");
  });

  it("keeps a working sign-in rather than swap it for a stale pair Grab sends that Fab365 turns down", async () => {
    await connect(ctx.userId);
    const stale = { access_token: token(-10, "stale"), refresh_token: token(7400, "stale-refresh") };
    ctx.install(handlerFor("ok", { refresh: "fail" }));
    expect(await fab365Connection.save(ctx.userId, stale)).toEqual({ configured: true });
    expect(await stored()).toEqual({ accessToken: ACCESS, refreshToken: REFRESH });
    expect((await getFab365Connection(ctx.userId)).state).toBe("connected");

    // One that can't be checked just now is saved as it came: nothing says it doesn't work.
    ctx.install(handlerFor("ok", { refresh: "outage" }));
    expect(await fab365Connection.save(ctx.userId, stale)).toEqual({ configured: true });
    expect(await stored()).toEqual({ accessToken: stale.access_token, refreshToken: stale.refresh_token });
  });
});

describe("Fab365 pages", () => {
  it("builds a model from its detail, gallery and designer", () => {
    const item = loadFixture<{ item: Record<string, unknown> }>("fab365", "detail").item;
    const gallery = fab365GalleryFrom(loadFixture("fab365", "gallery"));
    const resolved = fab365ModelFrom(item, gallery, { id: "29", name: "GOODesign", logo: null });
    expect(resolved.meta.title).toBe("Jet Pack & Laser gun");
    expect(resolved.meta.creator).toBe("GOODesign");
    expect(resolved.meta.siteCategoryIds).toEqual([1008]);
    expect(resolved.galleryImages).toHaveLength(3);
    expect(resolved.free).toBe(true);
    expect(resolved.meta.license).toEqual({ id: "fab365-personal", raw: "https://fab365.net/terms" });
  });

  it("keeps a gallery picture whether or not its entry is tagged, and leaves out videos", () => {
    const gallery = fab365GalleryFrom({
      item: {
        imgs: [
          { img: "https://st.fab365.net/img/detail_resize/1_a.jpg" },
          { type: "img", img: "https://st.fab365.net/img/detail_resize/1_b.jpg" },
          { type: "video", img: "https://st.fab365.net/img/detail_resize/1_c.mp4" },
        ],
      },
    });
    expect(gallery.map((image) => image.filename)).toEqual(["1_a.jpg", "1_b.jpg"]);
  });

  it("reads the favourites, and skips the empty list's one row of nothing", () => {
    expect(fab365LikesFrom(loadFixture("fab365", "likes")).map((entry) => entry.itemId)).toEqual(["116", "428", "232"]);
    expect(fab365LikesFrom(loadFixture("fab365", "likes-empty"))).toEqual([]);
  });

  it("reads the tokens out of a paste: local-storage rows, JSON or the access token alone", () => {
    const both = { access: ACCESS, refresh: REFRESH };
    // The two values on lines of their own, each after its name, as the connect form asks for them.
    expect(readFab365Paste(`accessToken: ${ACCESS}\nrefreshToken: ${REFRESH}`)).toEqual(both);
    expect(readFab365Paste(`accessToken\t${ACCESS}\t\nrefreshToken\t${REFRESH}\t`)).toEqual(both);
    expect(readFab365Paste(JSON.stringify({ accessToken: ACCESS, refreshToken: REFRESH }))).toEqual(both);
    expect(readFab365Paste(` "${ACCESS}" `)).toEqual({ access: ACCESS, refresh: null });
    // A token under any other key isn't the sign-in.
    expect(readFab365Paste(`bt_maker%40example.com\t${ACCESS}`)).toEqual({ access: null, refresh: null });
    expect(readFab365Paste("not a token")).toEqual({ access: null, refresh: null });
    expect(readFab365Paste(null)).toEqual({ access: null, refresh: null });
  });

  it("keeps a refresh token only when it's the same account's", () => {
    const another = jwt({
      loginId: "999",
      loginType: "W",
      index: "x",
      iat: 0,
      exp: Math.floor(Date.now() / 1000) + 7200,
    });
    expect(normalizeFab365Session(ACCESS, REFRESH)?.refreshToken).toBe(REFRESH);
    expect(normalizeFab365Session(ACCESS, another)?.refreshToken).toBeNull();
    expect(normalizeFab365Session(ACCESS, "not a jwt")?.refreshToken).toBeNull();
  });

  it("decodes who a token is and when it runs out", () => {
    const claims = decodeFab365Token(ACCESS);
    expect(claims?.userId).toBe("242181");
    expect(claims?.expiresAt).toBeInstanceOf(Date);
    expect(decodeFab365Token("not.a.jwt")).toBeNull();
  });
});
