import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { setProviderEnabled } from "../src/services/providerSettingsService";

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
  for (const provider of [
    "makerworld",
    "printables",
    "thingiverse",
    "myminifactory",
    "snapmaker",
    "makeronline",
    "crealitycloud",
    "nexprint",
    "thangs",
    "cults3d",
    "eufymake",
    "pinshape",
    "toymakr3d",
    "makerables",
    "cgtrader",
    "grabcad",
    "meshy",
    "pixup3d",
    "fab365",
    "threedexport",
  ] as const)
    await setProviderEnabled(provider, true);
});

describe("turning providers off", () => {
  it("has every provider on, and only lets admins switch them", async () => {
    const res = await request(app).get("/api/settings/providers").set(as(member));
    expect(res.status).toBe(200);
    expect(enabledMap(res.body)).toEqual({
      makerworld: true,
      printables: true,
      thingiverse: true,
      myminifactory: true,
      snapmaker: true,
      makeronline: true,
      crealitycloud: true,
      nexprint: true,
      thangs: true,
      cults3d: true,
      eufymake: true,
      pinshape: true,
      owlcad: true,
      toymakr3d: true,
      makerables: true,
      cgtrader: true,
      grabcad: true,
      meshy: true,
      pixup3d: true,
      fab365: true,
      threedexport: true,
    });

    expect(
      (await request(app).patch("/api/settings/providers/thingiverse").set(as(member)).send({ enabled: false })).status,
    ).toBe(403);
    expect(
      (await request(app).patch("/api/settings/providers/no-such-site").set(as(admin)).send({ enabled: false })).status,
    ).toBe(404);

    const off = await request(app).patch("/api/settings/providers/thingiverse").set(as(admin)).send({ enabled: false });
    expect(off.status).toBe(200);
    expect(enabledMap(off.body)).toEqual({
      makerworld: true,
      printables: true,
      thingiverse: false,
      myminifactory: true,
      snapmaker: true,
      makeronline: true,
      crealitycloud: true,
      nexprint: true,
      thangs: true,
      cults3d: true,
      eufymake: true,
      pinshape: true,
      owlcad: true,
      toymakr3d: true,
      makerables: true,
      cgtrader: true,
      grabcad: true,
      meshy: true,
      pixup3d: true,
      fab365: true,
      threedexport: true,
    });
  });

  it("switches several at once, for admins only", async () => {
    const send = (token: string, body: unknown) =>
      request(app).patch("/api/settings/providers").set(as(token)).send(body);
    expect((await send(member, { providers: ["pinshape"], enabled: false })).status).toBe(403);
    expect((await send(admin, { providers: [], enabled: false })).status).toBe(400);
    expect((await send(admin, { providers: ["no-such-site"], enabled: false })).status).toBe(400);

    const saved = async () => enabledMap((await request(app).get("/api/settings/providers").set(as(member))).body);
    const off = await send(admin, { providers: ["pinshape", "grabcad", "pinshape"], enabled: false });
    expect(off.status).toBe(200);
    expect(enabledMap(off.body)).toMatchObject({ pinshape: false, grabcad: false, printables: true });
    expect(await saved()).toMatchObject({ pinshape: false, grabcad: false, printables: true });

    const on = await send(admin, { providers: ["pinshape", "grabcad"], enabled: true });
    expect(enabledMap(on.body)).toMatchObject({ pinshape: true, grabcad: true });
    expect(await saved()).toMatchObject({ pinshape: true, grabcad: true });
  });

  it("keeps both of two changes made at once", async () => {
    // The list is stored whole, so it must exist for the row to be held.
    await setProviderEnabled("pinshape", true);
    const send = (providers: string[]) =>
      request(app).patch("/api/settings/providers").set(as(admin)).send({ providers, enabled: false });
    let first: Promise<request.Response> | undefined;
    let second: Promise<request.Response> | undefined;
    // An outside transaction holds the stored list while both requests start: each has read it, unchanged, by the
    // time it's let go, unless the reads wait their turn.
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT key FROM "Setting" WHERE key = 'disabled_providers' FOR UPDATE`;
        first = send(["pinshape"]).then((res) => res);
        second = send(["grabcad"]).then((res) => res);
        await new Promise((resolve) => setTimeout(resolve, 500));
      },
      { timeout: 10_000 },
    );
    expect((await first!).status).toBe(200);
    expect((await second!).status).toBe(200);
    const saved = enabledMap((await request(app).get("/api/settings/providers").set(as(member))).body);
    expect(saved).toMatchObject({ pinshape: false, grabcad: false });
    await setProviderEnabled("pinshape", true);
    await setProviderEnabled("grabcad", true);
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
      (await prisma.collectionSync.findFirst({ where: { collectionId: collection.id } }))?.lastCheckedAt,
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
    expect(await prisma.collectionSync.findFirst({ where: { collectionId: collection.id } })).toBeNull();
    await setProviderEnabled("printables", true);
  });

  it("won't list a provider's collections to sync with while it's off", async () => {
    await setProviderEnabled("thingiverse", false);
    const res = await request(app).get("/api/provider-collections").query({ provider: "thingiverse" }).set(as(member));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "provider_disabled" });
  });
});

it("verifies and saves a MakerWorld cookie through Bambu Cloud when the website is blocked", async () => {
  const transport = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    if (String(input) === "https://api.bambulab.com/v1/design-user-service/my/preference") {
      return new Response(JSON.stringify({ uid: 123 }), { status: 200 });
    }
    return new Response("Cloudflare challenge", { status: 403, headers: { "cf-mitigated": "challenge" } });
  });
  vi.stubGlobal("fetch", transport);
  try {
    const res = await request(app)
      .patch("/api/settings/makerworld")
      .set(as(member))
      .send({ cookie: "token=test-token", verify: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: true });
    const saved = await request(app).get("/api/settings/makerworld").set(as(member));
    expect(saved.body).toEqual({ configured: true, expired: false });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(
      "https://api.bambulab.com/v1/design-user-service/my/preference",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }),
    );
  } finally {
    vi.unstubAllGlobals();
    await request(app).patch("/api/settings/makerworld").set(as(member)).send({ cookie: null });
  }
});
