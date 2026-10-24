import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// No pacing here. config.ts reads the delays on load, so it's hoisted.
vi.hoisted(() => {
  process.env.IMPORT_MAKERWORLD_CALL_DELAY_MS = "0";
  process.env.COLLECTION_SYNC_ITEM_DELAY_MS = "0";
});

import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { setUserMakerworldCookie } from "../src/providers/makerworld/session";
import {
  PRINTABLES_FORGOTTEN,
  pushedPrintablesModels,
  WAITING_FOR_GRAB,
} from "../src/services/providerListingsService";
import { syncCollection } from "../src/services/collectionSyncRunner";
import { getThingiverseAccessToken, setThingiverseAccessToken } from "../src/services/settingsService";

const app = createApp();
const stamp = Date.now();
let token: string;
let userId: string;
const auth = () => ({ Authorization: `Bearer ${token}` });
const originalFetch = global.fetch;

// Ids unique to this run, so reruns against the same database don't collide.
let nextId = (stamp % 1_000_000_000) * 10;
const newId = () => String(nextId++);

const THINGIVERSE_USER = `Liker${stamp}`;
let previousThingiverseToken: string | null = null;
// A real Printables user, but not this Thingport user's: only typed into the app.
const OTHER_PRINTABLES_USER = { id: "777", handle: `Other_${stamp}`, publicUsername: "Other" };
const PRINTABLES_USER = { id: "3560603", handle: `Tester_${stamp}`, publicUsername: "Tester" };
const printablesCollections = [
  { id: newId(), name: "Practical finds", printsCount: 23 },
  { id: newId(), name: "Cool toys", printsCount: 8 },
];
const makerworldCollections = [
  { id: newId(), title: "To print", status: 2, designCnt: 3 },
  { id: newId(), title: "Secret", status: 1, designCnt: 1 },
];
const makerworldDesigns: Record<string, string[]> = {
  [makerworldCollections[0].id]: [newId(), newId(), newId()],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function printablesCard(c: { id: string; name: string; printsCount: number }) {
  return {
    ...c,
    private: false,
    user: { handle: PRINTABLES_USER.handle },
    thumbnails11: [{ image: { filePath: `media/${c.id}.jpg` } }],
  };
}

function printablesGraphql(query: string, variables: Record<string, unknown>): Response {
  if (query.includes("user(id:")) {
    if (variables.id === `@${OTHER_PRINTABLES_USER.handle}`) return json({ data: { user: OTHER_PRINTABLES_USER } });
    const ok = variables.id === `@${PRINTABLES_USER.handle}` || variables.id === PRINTABLES_USER.id;
    return json({ data: { user: ok ? PRINTABLES_USER : null } });
  }
  if (query.includes("userCollections"))
    return json({ data: { collections: printablesCollections.map(printablesCard) } });
  if (query.includes("moreCollectionModels"))
    return json({ data: { moreCollectionModels: { items: [], cursor: "" } } });
  if (query.includes("collection(id:")) {
    const found = printablesCollections.find((c) => c.id === variables.id);
    return json({ data: { collection: found ? printablesCard(found) : null } });
  }
  return json({ errors: [{ message: "unexpected query" }] });
}

function makerworldCard(c: (typeof makerworldCollections)[number]) {
  return { ...c, designCover: [`https://makerworld.bblmw.com/${c.id}.jpg`], creator: { handle: "Tautve" } };
}

beforeAll(async () => {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Browse", email: `browse-${stamp}@example.com`, password: "password123" });
  token = res.body.token;
  userId = res.body.user.id;

  global.fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://api.printables.com/graphql")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { query: string; variables: Record<string, unknown> };
      return printablesGraphql(body.query, body.variables);
    }
    // Thingiverse's API as it answers for a user with two likes and one collection.
    const thingiverse = url.match(/^https:\/\/api\.thingiverse\.com(\/[^?]*)/);
    if (thingiverse) {
      if (url.includes("access_token=rejected-token")) return json({}, 401);
      if (url.includes("access_token=challenged-token")) {
        return new Response("<title>Just a moment...</title>", {
          status: 403,
          headers: { "cf-mitigated": "challenge" },
        });
      }
      const path = thingiverse[1];
      if (path === `/users/${THINGIVERSE_USER}`) return json({ name: THINGIVERSE_USER, like_count: 2 });
      if (path === `/users/${THINGIVERSE_USER}/likes`) {
        return json([
          { id: 11, name: "Hook", thumbnail: "https://cdn.thingiverse.com/hook.jpg" },
          { id: 12, name: "Clip", thumbnail: "https://cdn.thingiverse.com/clip.jpg" },
        ]);
      }
      if (path === `/users/${THINGIVERSE_USER}/collections`) {
        return json([{ id: 77, name: "Bits", count: 3, creator: { name: THINGIVERSE_USER } }]);
      }
      return json({ error: "not found" }, 404);
    }
    if (url.startsWith("https://api.bambulab.com/v1/design-service/my/favorites/listlite")) {
      return json({ total: makerworldCollections.length, hits: makerworldCollections.map(makerworldCard) });
    }
    const card = url.match(/^https:\/\/api\.bambulab\.com\/v1\/design-service\/favorites\/(\d+)$/);
    if (card) {
      const found = makerworldCollections.find((c) => c.id === card[1]);
      return found ? json(makerworldCard(found)) : json({ error: "not found" }, 404);
    }
    const head = url.match(/^https:\/\/makerworld\.com\/api\/v1\/design-service\/favorites\/(\d+)$/);
    if (head) return makerworldDesigns[head[1]] ? json({ id: Number(head[1]), title: "To print" }) : json({}, 404);
    const listing = url.match(/^https:\/\/makerworld\.com\/api\/v1\/design-service\/favorites\/(\d+)\/designs/);
    if (listing) {
      const ids = makerworldDesigns[listing[1]] ?? [];
      return json({ total: ids.length, hits: ids.map((id) => ({ id: Number(id), title: `Model ${id}` })) });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
});

afterAll(async () => {
  global.fetch = originalFetch;
  await setThingiverseAccessToken(previousThingiverseToken);
});

async function newCollection(name: string): Promise<string> {
  const res = await request(app)
    .post("/api/collections")
    .set(auth())
    .send({ name: `${name} ${stamp}` });
  return res.body.id as string;
}

describe("browsing a provider's collections to sync with", () => {
  it("says which providers can be browsed, and who the user is on them", async () => {
    const res = await request(app).get("/api/provider-collections/accounts").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.makerworld).toEqual({ connected: false, account: null });
    expect(res.body.printables).toEqual({ connected: true, account: null });
  });

  it("remembers a Printables user from their profile link, then lists their collections", async () => {
    const before = await request(app).get("/api/provider-collections").query({ provider: "printables" }).set(auth());
    expect(before.status).toBe(409);

    const unknown = await request(app)
      .put("/api/provider-collections/accounts/printables")
      .set(auth())
      .send({ value: "@nobody" });
    expect(unknown.status).toBe(404);

    const saved = await request(app)
      .put("/api/provider-collections/accounts/printables")
      .set(auth())
      .send({ value: `https://www.printables.com/@${PRINTABLES_USER.handle}/collections` });
    expect(saved.status).toBe(200);
    expect(saved.body.printables.account).toBe(PRINTABLES_USER.handle);

    const list = await request(app).get("/api/provider-collections").query({ provider: "printables" }).set(auth());
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    expect(list.body[0]).toMatchObject({
      id: printablesCollections[0].id,
      name: "Practical finds",
      model_count: 23,
      url: `https://www.printables.com/@${PRINTABLES_USER.handle}/collections/${printablesCollections[0].id}`,
      thumbnails: [`https://media.printables.com/media/${printablesCollections[0].id}.jpg`],
      synced: null,
    });
  });

  it("lists the user's own MakerWorld collections through their cookie, private ones included", async () => {
    await setUserMakerworldCookie(userId, "token=test-bearer");
    const list = await request(app).get("/api/provider-collections").query({ provider: "makerworld" }).set(auth());
    expect(list.status).toBe(200);
    expect(list.body.map((c: { name: string; private: boolean }) => [c.name, c.private])).toEqual([
      ["To print", false],
      ["Secret", true],
    ]);
  });

  it("looks up a pasted collection link as the same card", async () => {
    const id = makerworldCollections[0].id;
    const res = await request(app)
      .get("/api/provider-collections/lookup")
      .query({ url: `https://makerworld.com/en/collections/${id}-to-print` })
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, name: "To print", model_count: 3, owner: "Tautve", synced: null });

    const notACollection = await request(app)
      .get("/api/provider-collections/lookup")
      .query({ url: "https://makerworld.com/en/models/123" })
      .set(auth());
    expect(notACollection.status).toBe(400);
  });
});

describe("Thingiverse likes in the Browse tab", () => {
  it("lists a user's likes first, counted from their profile, with a few of their models", async () => {
    previousThingiverseToken = await getThingiverseAccessToken();
    await setThingiverseAccessToken("test-token");
    const saved = await request(app)
      .put("/api/provider-collections/accounts/thingiverse")
      .set(auth())
      .send({ value: `https://www.thingiverse.com/${THINGIVERSE_USER}/designs` });
    expect(saved.body.thingiverse.account).toBe(THINGIVERSE_USER);

    const list = await request(app).get("/api/provider-collections").query({ provider: "thingiverse" }).set(auth());
    expect(list.status).toBe(200);
    expect(list.body.map((c: { name: string; likes: boolean }) => [c.name, c.likes])).toEqual([
      ["Liked models", true],
      ["Bits", false],
    ]);
    expect(list.body[0]).toMatchObject({
      id: `likes:${THINGIVERSE_USER.toLowerCase()}`,
      url: `https://www.thingiverse.com/${THINGIVERSE_USER}/likes`,
      model_count: 2,
      thumbnails: ["https://cdn.thingiverse.com/hook.jpg", "https://cdn.thingiverse.com/clip.jpg"],
    });
  });

  it("says the instance's token was rejected, rather than failing", async () => {
    await setThingiverseAccessToken("rejected-token");
    const list = await request(app).get("/api/provider-collections").query({ provider: "thingiverse" }).set(auth());
    expect(list.status).toBe(400);
    expect(list.body.detail).toMatch(/App Token .* was rejected/);
    await setThingiverseAccessToken("test-token");
  });

  it("tells a Cloudflare challenge from a rejected token", async () => {
    await setThingiverseAccessToken("challenged-token");
    const list = await request(app).get("/api/provider-collections").query({ provider: "thingiverse" }).set(auth());
    expect(list.status).toBe(429);
    expect(list.body.detail).toMatch(/Cloudflare.*Setting up FlareSolverr/);
    await setThingiverseAccessToken("test-token");
  });
});

describe("turning sync on from the app", () => {
  it("only follows new MakerWorld models: everything there now counts as seen", async () => {
    const collectionId = await newCollection("MakerWorld");
    const source = makerworldCollections[0];
    const res = await request(app)
      .post(`/api/collection/${collectionId}/sync`)
      .set(auth())
      .send({ url: `https://makerworld.com/en/collections/${source.id}`, interval_hours: 6 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ importing: false, sync: { provider: "makerworld", interval_hours: 6 } });

    const sync = await prisma.collectionSync.findUniqueOrThrow({ where: { collectionId } });
    expect(sync.knownIds.toSorted()).toEqual(makerworldDesigns[source.id].toSorted());
    expect(await prisma.importJob.count({ where: { collectionSyncId: sync.id } })).toBe(0);

    const list = await request(app).get("/api/provider-collections").query({ provider: "makerworld" }).set(auth());
    expect(list.body[0].synced).toEqual({ collection_id: collectionId, collection_name: `MakerWorld ${stamp}` });

    // One provider collection syncs with one Thingport collection at most.
    const other = await newCollection("Second");
    const again = await request(app)
      .post(`/api/collection/${other}/sync`)
      .set(auth())
      .send({ url: `https://makerworld.com/en/collections/${source.id}` });
    expect(again.status).toBe(409);
  });

  it("imports what a Printables collection holds now, through the sync's first check", async () => {
    const collectionId = await newCollection("Printables");
    const source = printablesCollections[1];
    const res = await request(app)
      .post(`/api/collection/${collectionId}/sync`)
      .set(auth())
      .send({ url: `https://www.printables.com/@${PRINTABLES_USER.handle}/collections/${source.id}` });
    expect(res.status).toBe(200);
    expect(res.body.importing).toBe(true);

    // The first check runs in the background; the stand-in collection is empty, so it just finishes.
    await vi.waitFor(
      async () => {
        const sync = await prisma.collectionSync.findUniqueOrThrow({ where: { collectionId } });
        expect(sync.lastCheckedAt).not.toBeNull();
      },
      { timeout: 5000 },
    );
  });

  it("refuses print profile choices for providers without them", async () => {
    const collectionId = await newCollection("Profiles");
    const res = await request(app)
      .post(`/api/collection/${collectionId}/sync`)
      .set(auth())
      .send({ url: `https://www.printables.com/collections/${printablesCollections[0].id}`, profile_scope: "all" });
    expect(res.status).toBe(400);
  });
});

async function queuedUrls(collectionId: string): Promise<string[]> {
  const sync = await prisma.collectionSync.findUniqueOrThrow({ where: { collectionId } });
  const items = await prisma.importJobItem.findMany({ where: { job: { collectionSyncId: sync.id } } });
  return items.map((item) => item.url).toSorted();
}

describe("private Printables collections and likes, through Thingport Grab", () => {
  const privateId = newId();
  const likedIds = [newId(), newId()];
  const push = (body: Record<string, unknown>) =>
    request(app)
      .put("/api/provider-collections/printables/push")
      .set(auth())
      .send({ user: { id: PRINTABLES_USER.id, handle: PRINTABLES_USER.handle }, ...body });
  const likesUrl = `https://www.printables.com/@${PRINTABLES_USER.handle}/collections/liked`;

  it("lists the private collections and likes Grab read, after the public ones", async () => {
    const res = await push({
      collections: [
        { id: privateId, name: "Secret stash", model_count: 2, thumbnails: [], private: true },
        { id: printablesCollections[0].id, name: "Practical finds", model_count: 23, thumbnails: [], private: false },
      ],
      likes: { model_count: 2, thumbnails: [] },
    });
    expect(res.status).toBe(200);

    const list = await request(app).get("/api/provider-collections").query({ provider: "printables" }).set(auth());
    expect(list.body.map((c: { name: string; private: boolean }) => [c.name, c.private])).toEqual([
      ["Liked models", true],
      ["Practical finds", false],
      ["Cool toys", false],
      ["Secret stash", true],
    ]);
    expect(list.body[0]).toMatchObject({
      id: `likes:${PRINTABLES_USER.handle.toLowerCase()}`,
      url: likesUrl,
      likes: true,
    });
    expect(list.body[1].likes).toBe(false);
  });

  it("finds the user's own likes by link, and nobody else's", async () => {
    const own = await request(app).get("/api/provider-collections/lookup").query({ url: likesUrl }).set(auth());
    expect(own.status).toBe(200);
    expect(own.body.name).toBe("Liked models");

    const other = await request(app)
      .get("/api/provider-collections/lookup")
      .query({ url: "https://www.printables.com/@someone_1/collections/liked" })
      .set(auth());
    expect(other.status).toBe(404);
  });

  it("waits for Grab to read a private collection, then imports it on the next visit", async () => {
    const collectionId = await newCollection("Private");
    const res = await request(app)
      .post(`/api/collection/${collectionId}/sync`)
      .set(auth())
      .send({ url: `https://www.printables.com/@${PRINTABLES_USER.handle}/collections/${privateId}` });
    expect(res.body).toMatchObject({ importing: true, waiting: true });
    await vi.waitFor(
      async () =>
        expect((await prisma.collectionSync.findUniqueOrThrow({ where: { collectionId } })).lastError).toBe(
          WAITING_FOR_GRAB,
        ),
      { timeout: 5000 },
    );

    const wanted = await request(app).get("/api/provider-collections/printables/wanted").set(auth());
    expect(wanted.body.keys).toContain(privateId);

    const models = [newId(), newId()];
    await push({ listings: { [privateId]: models } });
    await vi.waitFor(
      async () =>
        expect(await queuedUrls(collectionId)).toEqual(
          models.map((m) => `https://www.printables.com/model/${m}`).toSorted(),
        ),
      { timeout: 5000 },
    );
  });

  it("reads a collection made public live again, not from what Grab read while it was private", async () => {
    const id = newId();
    await push({
      collections: [{ id, name: "Was private", model_count: 1, thumbnails: [], private: true }],
      listings: { [id]: [newId()] },
    });
    expect(Array.isArray(await pushedPrintablesModels(userId, id))).toBe(true);

    await push({ collections: [{ id, name: "Was private", model_count: 1, thumbnails: [], private: false }] });
    expect(await pushedPrintablesModels(userId, id)).toBeNull();
  });

  it("forgets the models Grab read of a collection that's no longer private", async () => {
    const id = newId();
    await push({
      collections: [{ id, name: "Soon public", model_count: 1, thumbnails: [], private: true }],
      listings: { [id]: [newId()] },
    });
    await push({ collections: [{ id, name: "Soon public", model_count: 1, thumbnails: [], private: false }] });
    expect(await prisma.providerListing.count({ where: { userId, key: id } })).toBe(0);
  });

  it("refuses a push for a Printables account Printables doesn't know", async () => {
    const res = await request(app)
      .put("/api/provider-collections/printables/push")
      .set(auth())
      .send({ user: { id: PRINTABLES_USER.id, handle: "someone_else" }, collections: [] });
    expect(res.status).toBe(400);
  });

  it("asks Grab for only a few private collections per visit", async () => {
    const ids = [newId(), newId(), newId(), newId()];
    await push({
      collections: ids.map((id) => ({ id, name: `Private ${id}`, model_count: 1, thumbnails: [], private: true })),
    });
    for (const id of ids) {
      const collectionId = await newCollection(`Capped ${id}`);
      await request(app)
        .post(`/api/collection/${collectionId}/sync`)
        .set(auth())
        .send({ url: `https://www.printables.com/@${PRINTABLES_USER.handle}/collections/${id}` });
    }
    const wanted = await request(app).get("/api/provider-collections/printables/wanted").set(auth());
    expect(wanted.body.keys.filter((key: string) => ids.includes(key))).toHaveLength(3);
  });

  it("takes only a few private collections' models per push", async () => {
    const listings = Object.fromEntries(Array.from({ length: 11 }, () => [newId(), [newId()]]));
    expect((await push({ listings })).status).toBe(400);
  });

  it("refuses to sync someone else's Printables likes", async () => {
    const collectionId = await newCollection("Their likes");
    const res = await request(app)
      .post(`/api/collection/${collectionId}/sync`)
      .set(auth())
      .send({ url: "https://www.printables.com/@someone_1/collections/liked" });
    expect(res.status).toBe(400);
    const viaGrab = await request(app)
      .post("/api/collection-sync")
      .set(auth())
      .send({ url: "https://www.printables.com/@someone_1/collections/liked", known_ids: [] });
    expect(viaGrab.status).toBe(400);
    expect(await prisma.collectionSync.count({ where: { userId, externalId: "likes:someone_1" } })).toBe(0);
  });

  it("doesn't take a typed-in Printables username as proof whose likes they are", async () => {
    await request(app)
      .put("/api/provider-collections/accounts/printables")
      .set(auth())
      .send({ value: `@${OTHER_PRINTABLES_USER.handle}` });
    const collectionId = await newCollection("Typed likes");
    const res = await request(app)
      .post(`/api/collection/${collectionId}/sync`)
      .set(auth())
      .send({ url: `https://www.printables.com/@${OTHER_PRINTABLES_USER.handle}/collections/liked` });
    expect(res.status).toBe(400);
    // Back to the account Grab pushed, for the tests after this one.
    await push({});
  });

  it("turns Grab's Printables pushes off when the user forgets their account, until they give one again", async () => {
    const forget = await request(app)
      .put("/api/provider-collections/accounts/printables")
      .set(auth())
      .send({ value: null });
    expect(forget.body.printables.account).toBeNull();
    expect(await prisma.providerListing.count({ where: { userId, provider: "printables" } })).toBe(0);
    expect((await request(app).get("/api/provider-collections/printables/wanted").set(auth())).status).toBe(409);
    expect((await push({ collections: [] })).status).toBe(409);
    // The private collection synced earlier can't be told from a deleted one now: it pauses.
    const synced = await prisma.collectionSync.findFirstOrThrow({ where: { userId, externalId: privateId } });
    expect(await syncCollection(synced.id)).toBe("error");
    expect((await prisma.collectionSync.findUniqueOrThrow({ where: { id: synced.id } })).lastError).toBe(
      PRINTABLES_FORGOTTEN,
    );

    await request(app)
      .put("/api/provider-collections/accounts/printables")
      .set(auth())
      .send({ value: `@${PRINTABLES_USER.handle}` });
    expect((await push({ likes: { model_count: 0, thumbnails: [] } })).status).toBe(200);
  });

  it("syncs the user's likes from the ids Grab read", async () => {
    const collectionId = await newCollection("Likes");
    const res = await request(app).post(`/api/collection/${collectionId}/sync`).set(auth()).send({ url: likesUrl });
    expect(res.body).toMatchObject({ importing: true, waiting: true });

    const wanted = await request(app).get("/api/provider-collections/printables/wanted").set(auth());
    expect(wanted.body.keys).toContain("likes");

    await push({ likes: { model_count: 2, thumbnails: [], ids: likedIds } });
    await vi.waitFor(
      async () =>
        expect(await queuedUrls(collectionId)).toEqual(
          likedIds.map((m) => `https://www.printables.com/model/${m}`).toSorted(),
        ),
      { timeout: 5000 },
    );
  });
});
