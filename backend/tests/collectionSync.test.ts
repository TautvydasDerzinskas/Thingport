import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// No pacing or DNS here. config.ts reads the delays on load, so it's hoisted.
vi.hoisted(() => {
  process.env.IMPORT_MAKERWORLD_CALL_DELAY_MS = "0";
  process.env.IMPORT_COLLECTION_DELAY_MS = "0";
  process.env.COLLECTION_SYNC_ITEM_DELAY_MS = "0";
});
vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { releaseSync, reserveSync, runManualSync, syncCollection } from "../src/services/collectionSyncRunner";
import { SYNC_JOB_INTERRUPTED } from "../src/services/importJobRunner";
import { isSyncDue, markSchedulerStarted, nextSyncAt } from "../src/services/collectionSyncSchedule";
import { setThingiverseAccessToken } from "../src/providers/thingiverse/token";
import { checkPrintablesCollection } from "../src/providers/printables/api";
import { findOrCreateCollectionByName } from "../src/services/collectionService";

const app = createApp();
const stamp = Date.now();
const email = `sync-${stamp}@example.com`;
let token: string;
let userId: string;
const auth = () => ({ Authorization: `Bearer ${token}` });
const originalFetch = global.fetch;

// Ids unique to this run, so reruns against the same database don't collide.
let nextId = (stamp % 1_000_000_000) * 10;
const newId = () => String(nextId++);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const DESIGNER = { uid: 1692606088, name: "Deus Cat" };
function design(designId: string) {
  return {
    id: Number(designId),
    modelId: `US${designId}`,
    title: `Phoenix ${designId}`,
    summary: "<p>A phoenix.</p>",
    tags: ["phoenix"],
    coverUrl: "https://makerworld.bblmw.com/phoenix/cover.jpg",
    designCreator: DESIGNER,
    defaultInstanceId: 2,
    instances: [
      { id: 1, profileId: Number(`1${designId}`), title: "Single-colour version", instanceCreator: DESIGNER },
      { id: 2, profileId: Number(`2${designId}`), title: "multi-colored version", instanceCreator: DESIGNER },
    ],
  };
}

/** What each MakerWorld collection lists, or "gone" for one that 404s. */
const collections = new Map<string, string[] | "gone">();
/** Designs whose download hits MakerWorld's daily limit. */
const limited = new Set<string>();
/** Designs MakerWorld answers with 401, as with an expired sign-in. */
const signInRejected = new Set<string>();
/** Designs Cloudflare stands in front of, with no FlareSolverr to get past it. */
const cloudflared = new Set<string>();

function mockFetch() {
  global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
    const url = String(input);
    const listing = url.match(/^https:\/\/makerworld\.com\/api\/v1\/design-service\/favorites\/(\d+)\/designs/);
    if (listing) {
      const ids = collections.get(listing[1]);
      if (!ids || ids === "gone") return json({ error: "not found" }, 404);
      const offset = Number(new URL(url).searchParams.get("offset") ?? 0);
      const page = ids.slice(offset, offset + 20);
      return json({ total: ids.length, hits: page.map((id) => ({ id: Number(id), title: `Phoenix ${id}` })) });
    }
    const head = url.match(/^https:\/\/makerworld\.com\/api\/v1\/design-service\/favorites\/(\d+)$/);
    if (head) {
      const ids = collections.get(head[1]);
      if (!ids || ids === "gone") return json({ error: "not found" }, 404);
      return json({ id: Number(head[1]), title: "Phoenix flock" });
    }
    const model = url.match(/^https:\/\/api\.bambulab\.com\/v1\/design-service\/design\/(\d+)/);
    if (model) {
      if (signInRejected.has(model[1])) return json({ error: "unauthorized" }, 401);
      if (cloudflared.has(model[1])) return json({ error: "unavailable" }, 500);
      return json(design(model[1]));
    }
    const page = url.match(/^https:\/\/makerworld\.com\/en\/models\/(\d+)/);
    if (page && cloudflared.has(page[1])) {
      return new Response("Just a moment...", {
        status: 403,
        headers: { server: "cloudflare", "cf-mitigated": "challenge" },
      });
    }
    const profile = url.match(
      /^https:\/\/api\.bambulab\.com\/v1\/iot-service\/api\/user\/profile\/(\d+)\?model_id=US(\d+)/,
    );
    if (profile) {
      if (limited.has(profile[2])) return json({ code: -1, error: "You've reached your daily download limit." }, 400);
      return json({ message: "success", url: `https://s3.example.com/phoenix-${profile[1]}.stl`, filename: "p.stl" });
    }
    const file = url.match(/^https:\/\/s3\.example\.com\/phoenix-(\d+)\.stl$/);
    if (file) {
      return new Response(`solid phoenix-${file[1]}\nendsolid\n`, {
        headers: { "content-type": "application/octet-stream" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

const collectionUrl = (id: string) => `https://makerworld.com/en/collections/${id}-phoenix-flock`;

async function enable(body: Record<string, unknown>) {
  return request(app).post("/api/collection-sync").set(auth()).send(body);
}

async function syncOf(collectionId: string) {
  return prisma.collectionSync.findUniqueOrThrow({ where: { collectionId } });
}

async function importDirectly(designId: string) {
  const res = await request(app)
    .post("/api/import")
    .set(auth())
    .send({ url: `https://makerworld.com/en/models/${designId}`, makerworld_cookie: "token=test-bearer" });
  expect(res.status).toBe(200);
  return res.body.id as string;
}

async function latestNotification() {
  return prisma.notification.findFirstOrThrow({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}

describe("synced collections", () => {
  beforeAll(async () => {
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Sync Test", email, password: "password123" });
    token = res.body.token;
    userId = res.body.user.id;
    await prisma.user.update({ where: { id: userId }, data: { makerworldCookie: "token=test-bearer" } });
    mockFetch();
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    mockFetch();
    limited.clear();
    signInRejected.clear();
    cloudflared.clear();
    // A finished job mustn't hold the one-running-import lock for the next test.
    await prisma.importJob.updateMany({ where: { userId, status: "RUNNING" }, data: { status: "DONE" } });
  });

  it("is turned on by Grab, filing the models already in the library into a collection named after it", async () => {
    const cid = newId();
    const owned = newId();
    const printId = await importDirectly(owned);

    const res = await enable({ url: collectionUrl(cid), title: "Phoenix flock", known_ids: [owned, newId()] });
    expect(res.status).toBe(200);
    expect(res.body.collection_name).toBe("Phoenix flock");
    expect(res.body.provider).toBe("makerworld");
    expect(res.body.source_url).toBe(`https://makerworld.com/en/collections/${cid}`);

    const item = await prisma.collectionItem.findFirst({ where: { collectionId: res.body.collection_id, printId } });
    expect(item).not.toBeNull();

    const lookup = await request(app)
      .get("/api/collection-sync")
      .query({ url: collectionUrl(cid) })
      .set(auth());
    expect(lookup.body).toMatchObject({ supported: true, sync: { collection_id: res.body.collection_id } });

    const list = await request(app).get("/api/collections").set(auth());
    const listed = list.body.find((c: { id: string }) => c.id === res.body.collection_id);
    expect(listed.sync).toMatchObject({ provider: "makerworld", profile_scope: "designer", interval_hours: 24 });

    const notification = await latestNotification();
    expect(notification.title).toBe(`"Phoenix flock" is now synced`);
    expect(notification.body).toContain("once a day, each with all of the designer's print profiles");
    expect(notification.internalPath).toBe(`/models/collections/${res.body.collection_id}`);
  });

  it("brings back a deleted collection of already-imported models, in the provider's order", async () => {
    const cid = newId();
    const ids = [newId(), newId(), newId()];
    // Imported in a different order than the provider lists them.
    const printIds = new Map<string, string>();
    for (const id of ids.toReversed()) printIds.set(id, await importDirectly(id));
    const title = `Old flock ${cid}`;
    const first = await enable({ url: collectionUrl(cid), title, known_ids: ids });
    await request(app).delete(`/api/collection/${first.body.collection_id}`).set(auth());
    expect(await prisma.collectionSync.findUnique({ where: { collectionId: first.body.collection_id } })).toBeNull();

    const again = await enable({ url: collectionUrl(cid), title, known_ids: ids });
    expect(again.status).toBe(200);
    expect(again.body.collection_name).toBe(title);
    const items = await prisma.collectionItem.findMany({
      where: { collectionId: again.body.collection_id },
      orderBy: { position: "asc" },
    });
    expect(items.map((i) => i.printId)).toEqual(ids.map((id) => printIds.get(id)));
    // Nothing to download: they were all in the library already.
    const sync = await syncOf(again.body.collection_id);
    expect(await prisma.importJob.count({ where: { collectionSyncId: sync.id } })).toBe(0);
  });

  it("follows a Thingiverse user's Likes, in a collection named after them", async () => {
    const user = `Liker${newId()}`;
    const liked = new Set<string>();
    let accountGone = false;
    const thingId = newId();
    await setThingiverseAccessToken("test-token");
    // Already in the library, so the sync only has to file it.
    const print = await prisma.print.create({
      data: {
        userId,
        name: `Liked thing ${thingId}`,
        nameNormalized: `liked thing ${thingId}`,
        sourceProvider: "thingiverse",
        sourceExternalId: thingId,
      },
    });
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = new URL(String(input));
      if (url.hostname !== "api.thingiverse.com") return new Response("not found", { status: 404 });
      if (url.pathname.toLowerCase() === `/users/${user.toLowerCase()}`) {
        return accountGone ? json({ error: "Not Found" }, 404) : json({ name: user });
      }
      if (url.pathname.toLowerCase() === `/users/${user.toLowerCase()}/likes`) {
        return json(
          url.searchParams.get("page") === "1" ? [...liked].map((id) => ({ id: Number(id), name: `Thing ${id}` })) : [],
        );
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const enabled = await enable({
        url: `https://www.thingiverse.com/${user}/likes`,
        title: `${user}'s Likes`,
        known_ids: [],
      });
      expect(enabled.status).toBe(200);
      expect(enabled.body.collection_name).toBe(`Thingiverse likes (@${user})`);
      expect(enabled.body.likes_of).toBe(user);
      // Usernames aren't case-sensitive: the same user's Likes are one source.
      const lookup = await request(app)
        .get("/api/collection-sync")
        .query({ url: `https://www.thingiverse.com/${user.toUpperCase()}/likes` })
        .set(auth());
      expect(lookup.body.sync.collection_id).toBe(enabled.body.collection_id);

      const sync = await syncOf(enabled.body.collection_id);
      liked.add(thingId);
      expect(await syncCollection(sync.id)).toBe("filed");
      expect(
        await prisma.collectionItem.findFirst({
          where: { collectionId: enabled.body.collection_id, printId: print.id },
        }),
      ).not.toBeNull();
      expect((await latestNotification()).body).toContain("liked on Thingiverse");

      accountGone = true;
      expect(await syncCollection(sync.id)).toBe("gone");
      expect((await syncOf(enabled.body.collection_id)).lastError).toBe(
        `@${user}'s Thingiverse likes couldn't be found`,
      );
      expect(await syncCollection(sync.id)).toBe("unsynced");
      expect((await latestNotification()).body).toContain(`@${user}'s Thingiverse likes can't be found any more`);
    } finally {
      await setThingiverseAccessToken(null);
    }
  });

  it("takes a Printables collection as gone only when Printables says so", async () => {
    const answer = (body: unknown) => {
      global.fetch = vi.fn<() => Promise<Response>>(async () => json(body)) as unknown as typeof fetch;
    };
    answer({ data: { collection: null } });
    expect(await checkPrintablesCollection("1")).toBeNull();
    // A resolver's not-found error alongside the null, as GraphQL servers often send.
    answer({ data: { collection: null }, errors: [{ message: "Collection matching query does not exist." }] });
    expect(await checkPrintablesCollection("1")).toBeNull();
    answer({ data: { collection: null }, errors: [{ message: "not_found" }] });
    expect(await checkPrintablesCollection("1")).toBeNull();
    // Anything else is no answer, never "gone".
    answer({ data: { collection: null }, errors: [{ message: "Request was throttled." }] });
    await expect(checkPrintablesCollection("1")).rejects.toThrow("Couldn't read the Printables collection");
    answer({ data: null });
    await expect(checkPrintablesCollection("1")).rejects.toThrow("Couldn't read the Printables collection");
    answer({ data: { collection: { id: "1", name: "Desk stuff" } } });
    expect(await checkPrintablesCollection("1")).toEqual({ title: "Desk stuff" });

    const enabled = await enable({
      url: `https://www.printables.com/collections/${newId()}`,
      title: `Printables ${newId()}`,
      known_ids: [],
    });
    answer({ data: { collection: null } });
    expect(await syncCollection((await syncOf(enabled.body.collection_id)).id)).toBe("gone");
  });

  it("gives back a manual sync's place when its first lookup fails, instead of holding it forever", async () => {
    const cid = newId();
    collections.set(cid, []);
    const enabled = await enable({ url: collectionUrl(cid), title: `Flock ${cid}`, known_ids: [] });
    const sync = await syncOf(enabled.body.collection_id);

    expect(reserveSync(sync.id)).toBe(true);
    const lookup = vi.spyOn(prisma.collectionSync, "findUnique").mockRejectedValueOnce(new Error("connection reset"));
    try {
      // Never rejects: the route starts it without waiting on it.
      await expect(runManualSync(sync.id, { reserved: true })).resolves.toBe("error");
    } finally {
      lookup.mockRestore();
    }
    // Free again, for the next Sync now and the scheduled checks alike.
    expect(reserveSync(sync.id)).toBe(true);
    releaseSync(sync.id);
  });

  it("starts one sync when Sync now is clicked twice at once", async () => {
    const cid = newId();
    collections.set(cid, []);
    const enabled = await enable({ url: collectionUrl(cid), title: `Flock ${cid}`, known_ids: [] });
    const run = () => request(app).post(`/api/collection/${enabled.body.collection_id}/sync/run`).set(auth());
    const statuses = (await Promise.all([run(), run()])).map((res) => res.status);
    expect(statuses.filter((status) => status === 202)).toHaveLength(1);
    // The other is refused: already syncing, or already checked a moment ago.
    expect(statuses.filter((status) => status === 409 || status === 429)).toHaveLength(1);
  });

  it("gives a same-named collection from another source a collection of its own", async () => {
    const title = `Things ${newId()}`;
    // A Thingiverse collection called "Things" is synced first...
    const thingiverse = await enable({
      url: `https://www.thingiverse.com/collections/${newId()}`,
      title,
      known_ids: [],
    });
    expect(thingiverse.body.collection_name).toBe(title);
    // ...so a MakerWorld one called the same gets "Things (MakerWorld)" instead of a refusal.
    const makerworld = await enable({ url: collectionUrl(newId()), title, known_ids: [] });
    expect(makerworld.status).toBe(200);
    expect(makerworld.body.collection_name).toBe(`${title} (MakerWorld)`);
    expect(makerworld.body.collection_id).not.toBe(thingiverse.body.collection_id);
    const another = await enable({ url: collectionUrl(newId()), title, known_ids: [] });
    expect(another.body.collection_name).toBe(`${title} (MakerWorld 2)`);

    // Turning the MakerWorld one on again still finds its own collection.
    const again = await enable({ url: makerworld.body.source_url, title, known_ids: [] });
    expect(again.body.collection_id).toBe(makerworld.body.collection_id);
  });

  it("adopts a plain collection of the same name rather than making another", async () => {
    const title = `Plain ${newId()}`;
    const plain = await request(app).post("/api/collections").set(auth()).send({ name: title });
    const enabled = await enable({ url: collectionUrl(newId()), title, known_ids: [] });
    expect(enabled.body.collection_id).toBe(plain.body.id);
  });

  it("gives two sources racing for one new name a collection each", async () => {
    const title = `Contested ${newId()}`;
    const [a, b] = await Promise.all([
      enable({ url: collectionUrl(newId()), title, known_ids: [] }),
      enable({ url: collectionUrl(newId()), title, known_ids: [] }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.collection_name, b.body.collection_name].toSorted()).toEqual([title, `${title} (MakerWorld)`]);
  });

  it("finds or creates one collection by name, even when asked twice at once", async () => {
    const name = `Twice ${newId()}`;
    const [one, two] = await Promise.all([
      findOrCreateCollectionByName(userId, name),
      findOrCreateCollectionByName(userId, name),
    ]);
    expect(one.id).toBe(two.id);
  });

  it("says when a page isn't a collection a sync can follow", async () => {
    const res = await request(app)
      .get("/api/collection-sync")
      .query({ url: "https://www.thingiverse.com/someone/designs" })
      .set(auth());
    expect(res.body).toEqual({ supported: false, sync: null });
  });

  it("never links two Thingport collections to one provider collection, or one to two", async () => {
    const cid = newId();
    const first = await enable({ url: collectionUrl(cid), title: `Flock ${cid}`, known_ids: [] });
    const other = await request(app)
      .post("/api/collections")
      .set(auth())
      .send({ name: `Other ${cid}` });

    const again = await enable({ url: collectionUrl(cid), collection_id: other.body.id, known_ids: [] });
    expect(again.status).toBe(409);

    const secondSource = await enable({ url: collectionUrl(newId()), collection_id: first.body.collection_id });
    expect(secondSource.status).toBe(409);

    // Enabling the same source again just returns the link.
    const same = await enable({ url: collectionUrl(cid), known_ids: [] });
    expect(same.body.collection_id).toBe(first.body.collection_id);
  });

  it("imports only models added since, into the collection whatever it's been renamed to", async () => {
    const cid = newId();
    const known = newId();
    const added = newId();
    collections.set(cid, [known]);
    const enabled = await enable({ url: collectionUrl(cid), title: `Flock ${cid}`, known_ids: [known] });
    const collectionId = enabled.body.collection_id;
    const sync = await syncOf(collectionId);

    expect(await syncCollection(sync.id)).toBe("unchanged");

    await request(app)
      .patch(`/api/collection/${collectionId}`)
      .set(auth())
      .send({ name: `Renamed ${cid}` });
    collections.set(cid, [known, added]);
    expect(await syncCollection(sync.id)).toBe("queued");

    const print = await prisma.print.findFirstOrThrow({ where: { userId, sourceExternalId: added } });
    expect(await prisma.collectionItem.findFirst({ where: { collectionId, printId: print.id } })).not.toBeNull();
    // The model left out when sync was turned on stays out.
    expect(await prisma.print.findFirst({ where: { userId, sourceExternalId: known } })).toBeNull();
    expect((await syncOf(collectionId)).knownIds).toEqual(expect.arrayContaining([known, added]));

    const job = await prisma.importJob.findFirstOrThrow({ where: { collectionSyncId: sync.id } });
    expect(job.status).toBe("DONE");
    const notification = await latestNotification();
    expect(notification.title).toBe(`1 new model synced into "Renamed ${cid}"`);
    expect(notification.body).toContain(`"Phoenix ${added}"`);
    expect(notification.internalPath).toBe(`/models/collections/${collectionId}`);

    expect(await syncCollection(sync.id)).toBe("unchanged");
  });

  it("syncs one collection on demand, and always answers with a notification", async () => {
    const cid = newId();
    const added = newId();
    collections.set(cid, []);
    const enabled = await enable({ url: collectionUrl(cid), title: `Flock ${cid}`, known_ids: [] });
    const collectionId = enabled.body.collection_id;

    const run = () => request(app).post(`/api/collection/${collectionId}/sync/run`).set(auth());
    const waitFor = async (title: string) => {
      for (let i = 0; i < 100; i++) {
        const found = await prisma.notification.findFirst({ where: { userId, title } });
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`No "${title}" notification`);
    };

    // Pretends the last check was long enough ago for Sync now to be available again.
    const coolDown = () =>
      prisma.collectionSync.update({
        where: { collectionId },
        data: { lastCheckedAt: new Date(Date.now() - 10 * 60 * 1000) },
      });

    const first = await run();
    expect(first.status).toBe(202);
    // The cool-down starts at the click, and the answer says when it ends.
    expect(first.body.last_checked_at).not.toBeNull();
    expect(new Date(first.body.sync_now_at).getTime()).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    await waitFor(`"Flock ${cid}" is up to date`);

    const tooSoon = await run();
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.detail).toMatch(/available again in 5 min/);

    await coolDown();
    collections.set(cid, [added]);
    expect((await run()).status).toBe(202);
    await waitFor(`1 new model synced into "Flock ${cid}"`);
    expect(await prisma.print.findFirst({ where: { userId, sourceExternalId: added } })).not.toBeNull();

    await coolDown();
    const running = await prisma.importJob.create({
      data: { userId, type: "LINKS", status: "RUNNING", sourceUrl: "https://example.com" },
    });
    try {
      expect((await run()).status).toBe(409);
    } finally {
      await prisma.importJob.delete({ where: { id: running.id } });
    }

    const plain = await request(app)
      .post("/api/collections")
      .set(auth())
      .send({ name: `Plain ${cid}` });
    expect((await request(app).post(`/api/collection/${plain.body.id}/sync/run`).set(auth())).status).toBe(404);
  });

  it("only ever adds: a model removed on the provider stays in the collection and the library", async () => {
    const cid = newId();
    const [kept, removed, added] = [newId(), newId(), newId()];
    collections.set(cid, []);
    const enabled = await enable({ url: collectionUrl(cid), title: `Flock ${cid}`, known_ids: [] });
    const collectionId = enabled.body.collection_id;
    const sync = await syncOf(collectionId);
    collections.set(cid, [kept, removed]);
    await syncCollection(sync.id);
    const removedPrint = await prisma.print.findFirstOrThrow({ where: { userId, sourceExternalId: removed } });

    collections.set(cid, [kept, added]);
    expect(await syncCollection(sync.id)).toBe("queued");

    expect(await prisma.print.findUnique({ where: { id: removedPrint.id } })).not.toBeNull();
    expect(await prisma.collectionItem.findFirst({ where: { collectionId, printId: removedPrint.id } })).not.toBeNull();
    expect(await prisma.collectionItem.count({ where: { collectionId } })).toBe(3);
  });

  it("files a new model that's already in the library without importing it", async () => {
    const cid = newId();
    const owned = newId();
    const printId = await importDirectly(owned);
    collections.set(cid, [owned]);
    const enabled = await enable({ url: collectionUrl(cid), title: `Flock ${cid}`, known_ids: [] });

    expect(await syncCollection((await syncOf(enabled.body.collection_id)).id)).toBe("filed");
    expect(
      await prisma.collectionItem.findFirst({ where: { collectionId: enabled.body.collection_id, printId } }),
    ).not.toBeNull();
    expect((await latestNotification()).title).toBe(`1 model added to "Flock ${cid}"`);
  });

  it("queues each new MakerWorld model with the sync's print profile choice", async () => {
    const cid = newId();
    const added = newId();
    collections.set(cid, []);
    const enabled = await enable({ url: collectionUrl(cid), title: `Flock ${cid}`, known_ids: [] });
    const scope = await request(app)
      .patch(`/api/collection/${enabled.body.collection_id}/sync`)
      .set(auth())
      .send({ profile_scope: "all" });
    expect(scope.body.profile_scope).toBe("all");

    collections.set(cid, [added]);
    const sync = await syncOf(enabled.body.collection_id);
    await syncCollection(sync.id);

    const item = await prisma.importJobItem.findFirstOrThrow({ where: { job: { collectionSyncId: sync.id } } });
    expect(item.payload).toMatchObject({ scope: "all", collection_id: enabled.body.collection_id });
    // Each print profile is its own model file.
    const print = await prisma.print.findFirstOrThrow({
      where: { userId, sourceExternalId: added },
      include: { plates: true },
    });
    expect(print.plates.length).toBe(2);
  });

  it("only lets MakerWorld syncs pick print profiles", async () => {
    const enabled = await enable({
      url: `https://www.printables.com/collections/${newId()}`,
      title: `Printables ${stamp}`,
      known_ids: [],
    });
    expect(enabled.body.provider).toBe("printables");
    const res = await request(app)
      .patch(`/api/collection/${enabled.body.collection_id}/sync`)
      .set(auth())
      .send({ profile_scope: "all" });
    expect(res.status).toBe(400);
  });

  it("checks every collection on its own interval, 24 hours unless it picks 1 or 6", async () => {
    const enabled = await enable({
      url: `https://www.thingiverse.com/collections/${newId()}`,
      title: `Thingiverse ${newId()}`,
      known_ids: [],
    });
    expect(enabled.body.interval_hours).toBe(24);
    const patch = (body: Record<string, unknown>) =>
      request(app).patch(`/api/collection/${enabled.body.collection_id}/sync`).set(auth()).send(body);

    const six = await patch({ interval_hours: 6 });
    expect(six.status).toBe(200);
    expect(six.body.interval_hours).toBe(6);
    expect((await patch({ interval_hours: 3 })).status).toBe(400);
    expect((await patch({ interval_hours: 12 })).status).toBe(400);
    expect((await patch({ interval_hours: 0.5 })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
  });

  it("is due once its interval has passed since the last check, and right away if never checked", () => {
    const now = Date.UTC(2026, 9, 9, 12, 0);
    const hoursAgo = (h: number) => new Date(now - h * 60 * 60 * 1000);
    expect(isSyncDue({ lastCheckedAt: null, intervalHours: 24 }, now)).toBe(true);
    expect(isSyncDue({ lastCheckedAt: hoursAgo(1), intervalHours: 1 }, now)).toBe(true);
    expect(isSyncDue({ lastCheckedAt: hoursAgo(5), intervalHours: 6 }, now)).toBe(false);
    expect(isSyncDue({ lastCheckedAt: hoursAgo(24.5), intervalHours: 24 }, now)).toBe(true);

    // The estimate lands on the scheduler's next wake-up after the collection falls due.
    markSchedulerStarted(now - 60 * 60 * 1000);
    const next = nextSyncAt({ lastCheckedAt: hoursAgo(5), intervalHours: 6 }, now)!;
    expect(next.getTime()).toBeGreaterThanOrEqual(now + 60 * 60 * 1000);
    expect(next.getTime()).toBeLessThan(now + 65 * 60 * 1000);
    expect(nextSyncAt({ lastCheckedAt: null, intervalHours: 1 }, now)!.getTime()).toBeLessThanOrEqual(
      now + 5 * 60 * 1000,
    );
  });

  it("pauses in the import queue on a rate limit, and later finds wait with it", async () => {
    const cid = newId();
    const [a, b, c] = [newId(), newId(), newId()];
    collections.set(cid, []);
    const enabled = await enable({ url: collectionUrl(cid), title: `Flock ${cid}`, known_ids: [] });
    const sync = await syncOf(enabled.body.collection_id);

    collections.set(cid, [a, b]);
    limited.add(a);
    limited.add(b);
    expect(await syncCollection(sync.id)).toBe("queued");

    const job = await prisma.importJob.findFirstOrThrow({
      where: { collectionSyncId: sync.id },
      include: { items: true },
    });
    expect(job.status).toBe("PAUSED");
    expect(job.errorMessage).toMatch(/daily download limit/);
    expect(job.items.map((i) => i.status)).toEqual(["PENDING", "PENDING"]);
    const paused = await latestNotification();
    expect(paused.title).toBe(`Syncing "Flock ${cid}" is paused`);
    expect(paused.body).toContain("2 new models wait in the import queue");

    // The next sync adds to the paused job instead of starting another.
    collections.set(cid, [a, b, c]);
    expect(await syncCollection(sync.id)).toBe("queued");
    const after = await prisma.importJob.findMany({ where: { collectionSyncId: sync.id }, include: { items: true } });
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe("PAUSED");
    expect(after[0].items).toHaveLength(3);

    // Grab's "Add to the queue" starts a queue of its own rather than joining the sync's.
    const queued = await request(app)
      .post("/api/import/queue")
      .set(auth())
      .send({ url: `https://makerworld.com/en/models/${newId()}` });
    expect(queued.body.job_id).not.toBe(job.id);
    await prisma.importJob.delete({ where: { id: queued.body.job_id } });
  });

  it("picks a job cut off by a restart back up by itself", async () => {
    const cid = newId();
    const added = newId();
    collections.set(cid, []);
    const enabled = await enable({ url: collectionUrl(cid), title: `Flock ${cid}`, known_ids: [] });
    const sync = await syncOf(enabled.body.collection_id);
    collections.set(cid, [added]);
    limited.add(added);
    await syncCollection(sync.id);
    const job = await prisma.importJob.findFirstOrThrow({ where: { collectionSyncId: sync.id } });
    // What server.ts leaves on a sync job that was running when the server stopped.
    await prisma.importJob.update({ where: { id: job.id }, data: { errorMessage: SYNC_JOB_INTERRUPTED } });

    limited.clear();
    expect(await syncCollection(sync.id)).toBe("resumed");
    expect((await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("DONE");
    expect(await prisma.print.findFirst({ where: { userId, sourceExternalId: added } })).not.toBeNull();
  });

  it("waits while another import of the user's is running", async () => {
    const cid = newId();
    collections.set(cid, []);
    const enabled = await enable({ url: collectionUrl(cid), title: `Flock ${cid}`, known_ids: [] });
    const running = await prisma.importJob.create({
      data: { userId, type: "LINKS", status: "RUNNING", sourceUrl: "https://example.com" },
    });
    try {
      collections.set(cid, [newId()]);
      expect(await syncCollection((await syncOf(enabled.body.collection_id)).id)).toBe("busy");
      expect((await syncOf(enabled.body.collection_id)).knownIds).toEqual([]);
    } finally {
      await prisma.importJob.delete({ where: { id: running.id } });
    }
  });

  it("unsyncs when the provider's collection is gone twice in a row, keeping the models", async () => {
    const cid = newId();
    collections.set(cid, []);
    const enabled = await enable({ url: collectionUrl(cid), title: `Flock ${cid}`, known_ids: [] });
    const sync = await syncOf(enabled.body.collection_id);

    collections.set(cid, "gone");
    expect(await syncCollection(sync.id)).toBe("gone");
    expect((await syncOf(enabled.body.collection_id)).missingChecks).toBe(1);

    expect(await syncCollection(sync.id)).toBe("unsynced");
    expect(await prisma.collectionSync.findUnique({ where: { id: sync.id } })).toBeNull();
    expect(await prisma.collection.findUnique({ where: { id: enabled.body.collection_id } })).not.toBeNull();
    expect((await latestNotification()).title).toBe(`"Flock ${cid}" is no longer synced`);
  });

  it("keeps the sync when the provider can't be read", async () => {
    const cid = newId();
    collections.set(cid, []);
    const enabled = await enable({ url: collectionUrl(cid), title: `Flock ${cid}`, known_ids: [] });
    global.fetch = vi.fn<() => Promise<Response>>(
      async () => new Response("bad gateway", { status: 502 }),
    ) as unknown as typeof fetch;

    const sync = await syncOf(enabled.body.collection_id);
    expect(await syncCollection(sync.id)).toBe("error");
    expect(await syncCollection(sync.id)).toBe("error");
    const after = await syncOf(enabled.body.collection_id);
    expect(after.missingChecks).toBe(0);
    expect(after.lastError).toMatch(/HTTP 502/);
  });

  it("waits without unsyncing while MakerWorld isn't connected, telling the user once for all", async () => {
    const [one, two] = [newId(), newId()];
    collections.set(one, ["1"]);
    collections.set(two, ["1"]);
    const first = await enable({ url: collectionUrl(one), title: `Flock ${one}`, known_ids: [] });
    const second = await enable({ url: collectionUrl(two), title: `Flock ${two}`, known_ids: [] });
    const sync = await syncOf(first.body.collection_id);
    await request(app).patch("/api/settings/makerworld").set(auth()).send({ cookie: null });
    try {
      const calls = vi.mocked(global.fetch).mock.calls.length;
      const before = await prisma.notification.count({ where: { userId } });

      expect(await syncCollection(sync.id)).toBe("disconnected");
      expect(await syncCollection((await syncOf(second.body.collection_id)).id)).toBe("disconnected");
      expect(vi.mocked(global.fetch).mock.calls.length).toBe(calls);
      for (const enabled of [first, second]) {
        const held = await syncOf(enabled.body.collection_id);
        expect(held.lastError).toBe("MakerWorld isn't connected");
        expect(held.lastCheckedAt).toBeNull();
      }
      // Every MakerWorld sync of the user's, in one notification.
      expect(await prisma.notification.count({ where: { userId } })).toBe(before + 1);
      const note = await latestNotification();
      expect(note.title).toMatch(/^Couldn't sync \d+ MakerWorld collections$/);
      expect(note.body).toMatch(/^MakerWorld isn't connected\. .+ won't sync until you connect it again/);

      // Sync now still answers, for its own collection.
      expect(await runManualSync(sync.id)).toBe("disconnected");
      expect(await prisma.notification.count({ where: { userId } })).toBe(before + 2);
      expect((await latestNotification()).title).toBe(`Couldn't sync "Flock ${one}"`);
    } finally {
      await request(app).patch("/api/settings/makerworld").set(auth()).send({ cookie: "token=test-bearer" });
    }
    expect(await syncCollection(sync.id)).not.toBe("disconnected");
    expect((await syncOf(first.body.collection_id)).lastError).toBeNull();
  });

  it("holds MakerWorld syncs once the sign-in is turned down, until the cookie changes", async () => {
    const cid = newId();
    collections.set(cid, ["1"]);
    const enabled = await enable({ url: collectionUrl(cid), title: `Flock ${cid}`, known_ids: [] });
    const sync = await syncOf(enabled.body.collection_id);
    global.fetch = vi.fn<() => Promise<Response>>(async () =>
      json({ error: "unauthorized" }, 401),
    ) as unknown as typeof fetch;
    try {
      expect(await syncCollection(sync.id)).toBe("disconnected");
      expect(await prisma.collectionSync.findUnique({ where: { id: sync.id } })).not.toBeNull();
      expect((await syncOf(enabled.body.collection_id)).lastError).toBe("Your MakerWorld sign-in has expired");
      const settings = await request(app).get("/api/settings/makerworld").set(auth());
      expect(settings.body).toEqual({ configured: true, expired: true });

      const calls = vi.mocked(global.fetch).mock.calls.length;
      expect(await syncCollection(sync.id)).toBe("disconnected");
      expect(vi.mocked(global.fetch).mock.calls.length).toBe(calls);

      // The extension sending the same cookie again doesn't count as fixing it.
      await request(app).patch("/api/settings/makerworld").set(auth()).send({ cookie: "token=test-bearer" });
      expect(await syncCollection(sync.id)).toBe("disconnected");
    } finally {
      mockFetch();
      await request(app).patch("/api/settings/makerworld").set(auth()).send({ cookie: "token=fresh-bearer" });
    }
    expect(await syncCollection(sync.id)).not.toBe("disconnected");
    const settings = await request(app).get("/api/settings/makerworld").set(auth());
    expect(settings.body).toEqual({ configured: true, expired: false });
    await prisma.user.update({ where: { id: userId }, data: { makerworldCookie: "token=test-bearer" } });
  });

  it("hands models back to the sync when the sign-in is turned down mid-import, for after reconnecting", async () => {
    const cid = newId();
    const [first, second, third] = [newId(), newId(), newId()];
    collections.set(cid, []);
    const enabled = await enable({ url: collectionUrl(cid), title: `Flock ${cid}`, known_ids: [] });
    const collectionId = enabled.body.collection_id;
    const sync = await syncOf(collectionId);
    collections.set(cid, [first, second, third]);
    signInRejected.add(second);

    expect(await syncCollection(sync.id)).toBe("queued");
    expect(await prisma.print.findFirst({ where: { userId, sourceExternalId: first } })).not.toBeNull();
    const after = await syncOf(collectionId);
    expect(after.knownIds).toContain(first);
    expect(after.knownIds).not.toContain(second);
    expect(after.knownIds).not.toContain(third);
    expect(after.lastError).toBe("Your MakerWorld sign-in has expired");
    // Nothing left in the queue to retry by hand.
    const job = await prisma.importJob.findFirstOrThrow({ where: { collectionSyncId: sync.id } });
    expect(job.status).toBe("DONE");
    expect(await prisma.importJobItem.count({ where: { jobId: job.id, status: { not: "DONE" } } })).toBe(0);
    const note = await latestNotification();
    expect(note.title).toBe(`1 new model synced into "Flock ${cid}"`);
    expect(note.body).toContain("2 more models will come in on the next sync once you connect MakerWorld again");
    expect((await request(app).get("/api/settings/makerworld").set(auth())).body.expired).toBe(true);
    expect(await syncCollection(sync.id)).toBe("disconnected");

    signInRejected.clear();
    await request(app).patch("/api/settings/makerworld").set(auth()).send({ cookie: "token=fresh-bearer" });
    try {
      expect(await syncCollection(sync.id)).toBe("queued");
      for (const id of [second, third]) {
        expect(await prisma.print.findFirst({ where: { userId, sourceExternalId: id } })).not.toBeNull();
      }
      expect((await syncOf(collectionId)).knownIds).toEqual(expect.arrayContaining([first, second, third]));
    } finally {
      await prisma.user.update({ where: { id: userId }, data: { makerworldCookie: "token=test-bearer" } });
    }
  });

  it("hands models back to the sync when Cloudflare blocks them, without holding MakerWorld", async () => {
    const cid = newId();
    const [first, second] = [newId(), newId()];
    collections.set(cid, []);
    const enabled = await enable({ url: collectionUrl(cid), title: `Flock ${cid}`, known_ids: [] });
    const collectionId = enabled.body.collection_id;
    // The model's own profile, whose page fallback is what Cloudflare stands in front of.
    const sync = await prisma.collectionSync.update({ where: { collectionId }, data: { profileScope: "url" } });
    collections.set(cid, [first, second]);
    cloudflared.add(first);

    expect(await syncCollection(sync.id)).toBe("queued");
    const after = await syncOf(collectionId);
    expect(after.knownIds).not.toContain(first);
    expect(after.knownIds).not.toContain(second);
    expect(after.lastError).toBe("Cloudflare blocked MakerWorld and FlareSolverr didn't get past it");
    const job = await prisma.importJob.findFirstOrThrow({ where: { collectionSyncId: sync.id } });
    expect(await prisma.importJobItem.count({ where: { jobId: job.id } })).toBe(0);
    expect((await latestNotification()).body).toContain(
      "2 more models will come in on a later sync: Cloudflare blocked",
    );
    expect((await request(app).get("/api/settings/makerworld").set(auth())).body.expired).toBe(false);

    cloudflared.clear();
    expect(await syncCollection(sync.id)).toBe("queued");
    expect((await syncOf(collectionId)).knownIds).toEqual(expect.arrayContaining([first, second]));
    expect((await syncOf(collectionId)).lastError).toBeNull();
  });

  it("is removed with its collection, and can be turned off without touching the collection", async () => {
    const one = await enable({ url: collectionUrl(newId()), title: `Gone ${stamp}`, known_ids: [] });
    await request(app).delete(`/api/collection/${one.body.collection_id}`).set(auth());
    expect(await prisma.collectionSync.findUnique({ where: { collectionId: one.body.collection_id } })).toBeNull();

    const two = await enable({ url: collectionUrl(newId()), title: `Kept ${stamp}`, known_ids: [] });
    const off = await request(app).delete(`/api/collection/${two.body.collection_id}/sync`).set(auth());
    expect(off.status).toBe(200);
    expect(await prisma.collectionSync.findUnique({ where: { collectionId: two.body.collection_id } })).toBeNull();
    expect(await prisma.collection.findUnique({ where: { id: two.body.collection_id } })).not.toBeNull();
  });
});
