import type { Prisma } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { invalidateAllowlist, lineFor } from "../src/federation/allowlist";
import { NOT_LINKED, federationFetch } from "../src/federation/fetch";
import { cameThroughLink, linkEnded, linkOpen, newLinkToken, requestLinkOpen, sha256 } from "../src/federation/links";
import { storeIncomingRequest } from "../src/federation/peers";
import { resetRuntime } from "../src/federation/runtime";
import { clearFederationSettingsCache, updateFederationSettings } from "../src/federation/settings";
import { getSocialSettings, setSocialSettings } from "../src/services/settingsService";

const app = createApp();
const ORIGIN = "http://192.0.2.61:8000";
// Never reached in these tests: a request that tried would hang until its timeout instead of failing at once.
const HOME = "http://192.0.2.90:8000";
const KEYS = ["federation", "public_url"];

let savedSocial: Awaited<ReturnType<typeof getSocialSettings>>;
let savedSettings: { key: string; value: Prisma.JsonValue }[];

async function until(check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

beforeAll(async () => {
  savedSocial = await getSocialSettings();
  savedSettings = await prisma.setting.findMany({ where: { key: { in: KEYS } } });
  await setSocialSettings({ enabled: true });
  await prisma.setting.upsert({
    where: { key: "public_url" },
    create: { key: "public_url", value: ORIGIN },
    update: { value: ORIGIN },
  });
  await updateFederationSettings({ enabled: true });
  resetRuntime();
});

afterAll(async () => {
  await prisma.peer.deleteMany({ where: { origin: { startsWith: "http://192.0.2.9" } } });
  await prisma.peerRequest.deleteMany({ where: { origin: { startsWith: "http://192.0.2.9" } } });
  await prisma.federationKv.deleteMany({ where: { key: { startsWith: "thingport:link-" } } });
  await setSocialSettings(savedSocial);
  await prisma.setting.deleteMany({ where: { key: { in: KEYS } } });
  for (const row of savedSettings) {
    await prisma.setting.create({ data: { key: row.key, value: row.value as Prisma.InputJsonValue } });
  }
  clearFederationSettingsCache();
  invalidateAllowlist();
  resetRuntime();
});

describe("links", () => {
  it("carries a request down a partner's open link and its answer back up", async () => {
    const token = newLinkToken();
    const peer = await prisma.peer.create({
      data: {
        origin: HOME,
        status: "ACTIVE",
        link: "theirs",
        linkToken: sha256(token),
        actorUrl: `${HOME}/api/ap/actors/instance`,
      },
    });
    invalidateAllowlist();
    // Closed: its address is never tried instead.
    const started = Date.now();
    await expect(federationFetch(`${HOME}/api/ap/directory`, {}, () => true)).rejects.toThrow(NOT_LINKED);
    expect(Date.now() - started).toBeLessThan(2000);

    const ask = request(app)
      .get("/api/ap/link")
      .set("Authorization", `Link ${token}`)
      .then((res) => res);
    await until(() => linkOpen(peer.id));
    const fetched = federationFetch(
      `${HOME}/api/ap/directory?page=1`,
      { headers: { Accept: "application/activity+json" } },
      () => true,
    );
    const asked = await ask;
    expect(asked.status).toBe(200);
    const [sent] = asked.body.requests;
    expect(sent).toMatchObject({ method: "GET", url: `${HOME}/api/ap/directory?page=1` });
    expect(sent.headers.accept).toBe("application/activity+json");

    const reply = await request(app)
      .post(`/api/ap/link/replies/${sent.id}`)
      .set("Authorization", `Link ${token}`)
      .set("Content-Type", "application/octet-stream")
      .set("X-Link-Status", "200")
      .set("X-Link-Headers", Buffer.from(JSON.stringify({ "content-type": "application/json" })).toString("base64url"))
      .send(Buffer.from('{"orderedItems":[]}'));
    expect(reply.status).toBe(204);
    const response = await fetched;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ orderedItems: [] });
    // An answer to nothing it was asked, or with another's secret, isn't taken.
    const stray = await request(app)
      .post(`/api/ap/link/replies/${sent.id}`)
      .set("Authorization", `Link ${token}`)
      .set("X-Link-Status", "200")
      .send(Buffer.from("x"));
    expect(stray.status).toBe(410);
    expect((await request(app).get("/api/ap/link").set("Authorization", `Link ${newLinkToken()}`)).status).toBe(401);
    expect((await request(app).get("/api/ap/link")).status).toBe(401);

    await prisma.peer.delete({ where: { id: peer.id } });
    invalidateAllowlist();
  });

  it("opens a waiting request's link with its secret, and says why once it's ended", async () => {
    const origin = "http://192.0.2.91:8000";
    const token = newLinkToken();
    const stored = await storeIncomingRequest({
      origin,
      url: `${ORIGIN}/api/ap/inbox`,
      headers: {},
      raw: "{}",
      follow: {
        type: "Follow",
        id: `${origin}/api/ap/follows/f1`,
        actor: `${origin}/api/ap/actors/instance`,
        "thingport:link": token,
      } as never,
    });
    expect(stored).toBe("stored");
    const asking = await prisma.peerRequest.findFirstOrThrow({ where: { origin } });
    expect(asking.linkToken).toBe(sha256(token));
    // Its address is reached through its link only, from now on.
    expect(await lineFor(origin)).toBe(`request:${asking.id}`);

    const ask = request(app).get("/api/ap/link").set("Authorization", `Link ${token}`);
    const pending = ask.then((res) => res);
    await until(() => requestLinkOpen(asking.id));
    ask.abort();
    await pending.catch(() => null);

    await prisma.peerRequest.update({ where: { id: asking.id }, data: { status: "DECLINED" } });
    await linkEnded(asking.linkToken!, origin, "declined");
    const told = await request(app).get("/api/ap/link").set("Authorization", `Link ${token}`);
    expect(told.status).toBe(410);
    expect(told.body).toEqual({ reason: "declined" });
    // Still never reached at its address.
    expect(await lineFor(origin)).toBe("ended");
    await expect(federationFetch(`${origin}/api/ap/instance`, {}, () => true)).rejects.toThrow(NOT_LINKED);
  });

  it("turns away an instance at a partner's address that isn't that partner", async () => {
    const origin = "http://192.0.2.92:8000";
    await prisma.peer.create({ data: { origin, status: "ACTIVE", actorUrl: `${origin}/api/ap/actors/instance` } });
    invalidateAllowlist();
    const res = await request(app)
      .post("/api/ap/inbox")
      .set("Content-Type", "application/activity+json")
      .set("Signature", `keyId="${origin}/api/ap/actors/instance#main-key",signature="x"`)
      .send(
        JSON.stringify({
          type: "Follow",
          id: `${origin}/api/ap/follows/other`,
          actor: `${origin}/api/ap/actors/instance`,
          object: `${ORIGIN}/api/ap/actors/instance`,
          "thingport:link": newLinkToken(),
        }),
      );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("address_taken");
  });

  it("tells what came down this instance's own link from what came from outside", () => {
    expect(cameThroughLink({ "x-thingport-link": "0".repeat(32) })).toBe(false);
    expect(cameThroughLink({})).toBe(false);
  });
});
