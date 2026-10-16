import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { setProviderEnabled } from "../src/services/providerSettingsService";
import { runAuthorLinking, type AuthorLinkingRun } from "../src/services/authorLinkingService";
import { getThingiverseAccessToken, setThingiverseAccessToken } from "../src/services/settingsService";

const app = createApp();
let admin: string;
let member: string;
let memberId: string;

async function register(role: "ADMIN" | "MEMBER") {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: role, email: `providers-${role}-${Date.now()}@example.com`, password: "password123" });
  await prisma.user.update({ where: { id: res.body.user.id }, data: { role } });
  return { token: res.body.token as string, id: res.body.user.id as string };
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const enabledMap = (body: { providers: { id: string; enabled: boolean }[] }) =>
  Object.fromEntries(body.providers.map((p) => [p.id, p.enabled]));

beforeAll(async () => {
  admin = (await register("ADMIN")).token;
  ({ token: member, id: memberId } = await register("MEMBER"));
});

// Files share one database: every provider is back on afterwards, even when a test fails.
afterAll(async () => {
  for (const provider of ["makerworld", "printables", "thingiverse"] as const) await setProviderEnabled(provider, true);
});

describe("turning providers off", () => {
  it("has every provider on, and only lets admins switch them", async () => {
    const res = await request(app).get("/api/settings/providers").set(as(member));
    expect(res.status).toBe(200);
    expect(enabledMap(res.body)).toEqual({ makerworld: true, printables: true, thingiverse: true });

    expect(
      (await request(app).patch("/api/settings/providers/thingiverse").set(as(member)).send({ enabled: false })).status,
    ).toBe(403);
    expect(
      (await request(app).patch("/api/settings/providers/cults3d").set(as(admin)).send({ enabled: false })).status,
    ).toBe(404);

    const off = await request(app).patch("/api/settings/providers/thingiverse").set(as(admin)).send({ enabled: false });
    expect(off.status).toBe(200);
    expect(enabledMap(off.body)).toEqual({ makerworld: true, printables: true, thingiverse: false });
  });

  it("refuses new imports from a provider that's off, and only from it", async () => {
    await setProviderEnabled("thingiverse", false);
    const blocked = await request(app)
      .post("/api/import")
      .set(as(member))
      .send({ url: "https://www.thingiverse.com/thing:12345" });
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({ code: "provider_disabled" });
    expect(blocked.body.detail).toMatch(/Thingiverse is turned off/);

    // Another provider's link isn't refused for this reason, whatever happens to it after.
    const other = await request(app)
      .post("/api/import/inspect")
      .set(as(member))
      .send({ url: "https://www.printables.com/model/1-x" });
    expect(other.body?.code).not.toBe("provider_disabled");
  });

  it("still reports a model that's already in the library as such while its provider is off", async () => {
    const thingId = String(Date.now());
    const print = await prisma.print.create({
      data: {
        userId: memberId,
        name: "Already here",
        nameNormalized: "already here",
        sourceProvider: "thingiverse",
        sourceExternalId: thingId,
      },
    });
    await setProviderEnabled("thingiverse", false);
    const res = await request(app)
      .post("/api/import")
      .set(as(member))
      .send({ url: `https://www.thingiverse.com/thing:${thingId}` });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: print.id, import_outcome: "already_imported" });
  });

  it("refuses what Thingport Grab reads on Printables while Printables is off", async () => {
    await setProviderEnabled("printables", false);
    const wanted = await request(app).get("/api/provider-collections/printables/wanted").set(as(member));
    expect(wanted.status).toBe(403);
    expect(wanted.body).toMatchObject({ code: "provider_disabled" });
    const push = await request(app)
      .put("/api/provider-collections/printables/push")
      .set(as(member))
      .send({ user: { id: "1", handle: "someone" } });
    expect(push.status).toBe(403);
    await setProviderEnabled("printables", true);
  });

  it("refuses Sync now on a collection synced with a provider that's off, saying why", async () => {
    const name = `Synced ${Date.now()}`;
    const collection = await prisma.collection.create({
      data: { userId: memberId, name, nameNormalized: name.toLowerCase() },
    });
    await prisma.collectionSync.create({
      data: {
        userId: memberId,
        collectionId: collection.id,
        provider: "thingiverse",
        externalId: "123",
        sourceUrl: "https://www.thingiverse.com/someone/collections/123",
      },
    });
    await setProviderEnabled("thingiverse", false);
    const res = await request(app).post(`/api/collection/${collection.id}/sync/run`).set(as(member));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "provider_disabled" });
    // Not marked as checked: the click didn't start anything.
    expect(
      (await prisma.collectionSync.findUnique({ where: { collectionId: collection.id } }))?.lastCheckedAt,
    ).toBeNull();
  });

  it("still lets a collection synced with a provider that's off be unsynced", async () => {
    const name = `Unsync ${Date.now()}`;
    const collection = await prisma.collection.create({
      data: { userId: memberId, name, nameNormalized: name.toLowerCase() },
    });
    await prisma.collectionSync.create({
      data: {
        userId: memberId,
        collectionId: collection.id,
        provider: "printables",
        externalId: String(Date.now()),
        sourceUrl: "https://www.printables.com/@someone/collections/1",
      },
    });
    await setProviderEnabled("printables", false);
    const res = await request(app).delete(`/api/collection/${collection.id}/sync`).set(as(member));
    expect(res.status).toBeLessThan(300);
    expect(await prisma.collectionSync.findUnique({ where: { collectionId: collection.id } })).toBeNull();
    await setProviderEnabled("printables", true);
  });

  it("doesn't report a turned-off provider's missing token as a problem when linking authors", async () => {
    const previous = await getThingiverseAccessToken();
    await setThingiverseAccessToken(null);
    // All off, so the run has nothing to look up online in a shared database; afterAll turns them back on.
    for (const provider of ["makerworld", "printables", "thingiverse"] as const)
      await setProviderEnabled(provider, false);
    try {
      const run: AuthorLinkingRun = {
        running: true,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        toLookUp: 0,
        lookedUp: 0,
        linked: 0,
        notFound: 0,
        problems: [],
      };
      await runAuthorLinking(run);
      expect(run.problems).not.toContain("thingiverse_no_token");
    } finally {
      await setThingiverseAccessToken(previous);
    }
  });

  it("won't list a provider's collections to sync with while it's off", async () => {
    await setProviderEnabled("thingiverse", false);
    const res = await request(app).get("/api/provider-collections").query({ provider: "thingiverse" }).set(as(member));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "provider_disabled" });
  });
});
