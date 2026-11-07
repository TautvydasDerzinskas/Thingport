import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Prisma } from "@prisma/client";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { invalidateAllowlist, lineFor } from "../src/federation/allowlist";
import { canonicalHeaders } from "../src/federation/edge";
import { NOT_LINKED, federationFetch } from "../src/federation/fetch";
import { cameThroughLink, linkOpen, newLinkToken, requestLinkOpen, sha256 } from "../src/federation/links";
import {
  answersAt,
  blockRequest,
  declineRequest,
  disconnectPeer,
  listInstances,
  lookupInstance,
  requestDetails,
  storeIncomingRequest,
} from "../src/federation/peers";
import { getRuntime, resetRuntime } from "../src/federation/runtime";
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
    // Anyone can send one, naming any address: only its own review goes through its link, and how that address is
    // reached doesn't change.
    expect(await lineFor(origin)).toBeNull();

    const ask = request(app).get("/api/ap/link").set("Authorization", `Link ${token}`);
    const pending = ask.then((res) => res);
    await until(() => requestLinkOpen(asking.id));
    ask.abort();
    await pending.catch(() => null);

    await declineRequest("test-admin", asking.id);
    const told = await request(app).get("/api/ap/link").set("Authorization", `Link ${token}`);
    expect(told.status).toBe(410);
    expect(told.body).toEqual({ reason: "declined" });
    // Nor once it's declined: an instance really at that address can still be connected with.
    expect(await lineFor(origin)).toBeNull();
  });

  it("tells a blocked request's link it was declined, not that it's blocked, so it stops asking", async () => {
    const origin = "http://192.0.2.98:8000";
    const token = newLinkToken();
    await storeIncomingRequest({
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
    const asking = await prisma.peerRequest.findFirstOrThrow({ where: { origin } });
    await blockRequest("test-admin", asking.id);
    const told = await request(app).get("/api/ap/link").set("Authorization", `Link ${token}`);
    expect(told.status).toBe(410);
    expect(told.body).toEqual({ reason: "declined" });
  });

  it("never fetches a partner's address once its link ended", async () => {
    const origin = "http://192.0.2.96:8000";
    const token = newLinkToken();
    const peer = await prisma.peer.create({
      data: {
        origin,
        status: "ACTIVE",
        link: "theirs",
        linkToken: sha256(token),
        actorUrl: `${origin}/api/ap/actors/instance`,
      },
    });
    invalidateAllowlist();
    await disconnectPeer("test-admin", peer.id);
    const told = await request(app).get("/api/ap/link").set("Authorization", `Link ${token}`);
    expect(told.status).toBe(410);
    expect(told.body).toEqual({ reason: "disconnected" });
    // What was on its way to it meanwhile doesn't go to its address, which may be another machine from here.
    expect(await lineFor(origin)).toBe("ended");
    await expect(federationFetch(`${origin}/api/ap/inbox`, {}, () => true)).rejects.toThrow(NOT_LINKED);
  });

  it("points a lookup of an address it can't reach at the request that asked from it through a link", async () => {
    const origin = "http://192.0.2.97:8000";
    await storeIncomingRequest({
      origin,
      url: `${ORIGIN}/api/ap/inbox`,
      headers: {},
      raw: "{}",
      follow: {
        type: "Follow",
        id: `${origin}/api/ap/follows/f1`,
        actor: `${origin}/api/ap/actors/instance`,
        "thingport:link": newLinkToken(),
      } as never,
    });
    const saved = process.env.FEDERATION_UNREACHABLE;
    process.env.FEDERATION_UNREACHABLE = origin;
    try {
      await expect(lookupInstance(origin)).rejects.toMatchObject({ code: "asked_with_link" });
    } finally {
      if (saved === undefined) delete process.env.FEDERATION_UNREACHABLE;
      else process.env.FEDERATION_UNREACHABLE = saved;
    }
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

  it("doesn't send down a link what was given up on before it went", async () => {
    const token = newLinkToken();
    const origin = "http://192.0.2.93:8000";
    const peer = await prisma.peer.create({
      data: { origin, status: "ACTIVE", link: "theirs", linkToken: sha256(token) },
    });
    invalidateAllowlist();
    const ask = request(app).get("/api/ap/link").set("Authorization", `Link ${token}`);
    const pending = ask.then((res) => res);
    await until(() => linkOpen(peer.id));
    await expect(
      federationFetch(`${origin}/api/ap/directory`, { signal: AbortSignal.abort() }, () => true),
    ).rejects.toThrow("took too long");
    ask.abort();
    await pending.catch(() => null);
  });

  it("checks a linked partner's signatures only against the keys compared, its kept document included", async () => {
    const runtime = await getRuntime();
    const pem = () =>
      crypto
        .generateKeyPairSync("rsa", { modulusLength: 2048 })
        .publicKey.export({ type: "spki", format: "pem" }) as string;
    const compared = pem();
    const jwk = crypto.createPublicKey(compared).export({ format: "jwk" });
    const origin = "http://192.0.2.94:8000";
    const actorUrl = `${origin}/api/ap/actors/instance`;
    const doc = (keys: string[]) => ({
      "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
      id: actorUrl,
      type: "Application",
      inbox: `${origin}/api/ap/inbox`,
      publicKey: keys.map((key, n) => ({ id: `${actorUrl}#key-${n}`, owner: actorUrl, publicKeyPem: key })),
    });
    const peer = await prisma.peer.create({
      data: {
        origin,
        status: "ACTIVE",
        link: "theirs",
        actorUrl,
        publicKeys: [{ kty: jwk.kty, n: jwk.n, e: jwk.e }] as Prisma.InputJsonValue,
        actorDocument: doc([compared]) as Prisma.InputJsonValue,
      },
    });
    invalidateAllowlist();
    expect(((await runtime.pinnedLoader(`${actorUrl}#key-0`)) as { document: { id: string } }).document.id).toBe(
      actorUrl,
    );
    // One more key in it, however it got there: refused.
    await prisma.peer.update({
      where: { id: peer.id },
      data: { actorDocument: doc([compared, pem()]) as Prisma.InputJsonValue },
    });
    await expect(runtime.pinnedLoader(`${actorUrl}#key-0`)).rejects.toThrow("other than the one compared");
  });

  it("lists every request that keeps a link on its own, whatever else came from its address", async () => {
    const origin = "http://192.0.2.95:8000";
    const follow = (n: number, token?: string) => ({
      type: "Follow",
      id: `${origin}/api/ap/follows/f${n}`,
      actor: `${origin}/api/ap/actors/instance`,
      ...(token ? { "thingport:link": token } : {}),
    });
    for (const [n, token] of [
      [1, newLinkToken()],
      [2, newLinkToken()],
      [3, undefined],
      [4, undefined],
    ] as const) {
      await storeIncomingRequest({
        origin,
        url: `${ORIGIN}/api/ap/inbox`,
        headers: {},
        raw: "{}",
        follow: follow(n, token) as never,
      });
    }
    const listed = (await listInstances()).incoming.filter((item) => item.origin === origin);
    expect(listed.filter((item) => item.link)).toHaveLength(2);
    expect(listed.filter((item) => !item.link)).toHaveLength(1);
  });

  it("tells what came down this instance's own link from what came from outside", () => {
    expect(cameThroughLink({ "x-thingport-link": "0".repeat(32) })).toBe(false);
    expect(cameThroughLink({})).toBe(false);
  });
});

// An address a request through a link names: what answers there directly, beside what comes down its link.

const onTheInternet = async () => ({ kind: "public" as const, addresses: ["203.0.113.7"] });

/** A key of an instance's own: the public half as its actor publishes it, the private one to sign with. */
async function instanceKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  const signing = await crypto.webcrypto.subtle.importKey(
    "pkcs8",
    privateKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["sign"],
  );
  return { pem: publicKey, signing };
}

/** What a Thingport instance at `origin` answers a lookup with, by path. */
function instanceDocuments(origin: string, name: string, pem: string): Record<string, unknown> {
  const actor = `${origin}/api/ap/actors/instance`;
  return {
    "/api/ap/instance": { software: "thingport", version: "1", name, actor },
    "/api/ap/actors/instance": {
      "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
      id: actor,
      type: "Application",
      inbox: `${origin}/api/ap/inbox`,
      publicKey: { id: `${actor}#main-key`, owner: actor, publicKeyPem: pem },
    },
  };
}

/** Something at an address on this machine: an instance answering from `documents`, one that never answers
 *  (`silent`, which notes when it's given up on), or nothing listening at all (`closed`). */
async function answering(serve: ((origin: string) => Record<string, unknown>) | "silent" | "closed") {
  let origin = "";
  let givenUp = false;
  const server = http.createServer((req, res) => {
    if (serve === "silent") {
      req.on("close", () => {
        givenUp = true;
      });
      return;
    }
    if (serve === "closed") return;
    const body = serve(origin)[req.url ?? ""];
    if (!body) return void res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": "application/activity+json" }).end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  if (serve === "closed") await close();
  return { origin, close: serve === "closed" ? async () => {} : close, givenUp: () => givenUp };
}

/** A home instance at `origin` asking to connect through its link: its request signed with `key`, and what's asked
 *  down the link answered as that instance, until `close`. */
async function linkedRequest(origin: string, name: string, key: Awaited<ReturnType<typeof instanceKey>>) {
  const runtime = await getRuntime();
  const actor = `${origin}/api/ap/actors/instance`;
  const token = newLinkToken();
  const follow = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `${origin}/api/ap/follows/${crypto.randomUUID()}`,
    type: "Follow",
    actor,
    object: runtime.actorUrl.href,
    "thingport:link": token,
  };
  const raw = JSON.stringify(follow);
  const signed = await runtime.fedify.signRequest(
    new Request(`${ORIGIN}/api/ap/inbox`, {
      method: "POST",
      headers: { "Content-Type": "application/activity+json" },
      body: raw,
    }),
    key.signing as never,
    new URL(`${actor}#main-key`),
  );
  const headers = canonicalHeaders(Object.fromEntries(signed.headers.entries()), ORIGIN);
  expect(
    await storeIncomingRequest({ origin, url: `${ORIGIN}/api/ap/inbox`, headers, raw, follow: follow as never }),
  ).toBe("stored");
  const stored = await prisma.peerRequest.findFirstOrThrow({ where: { linkToken: sha256(token) } });
  const served = { ...instanceDocuments(origin, name, key.pem), [new URL(follow.id).pathname]: follow };
  // Asked over the network, as the home instance would, so closing ends the ask waiting at that moment.
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const authorization = `Link ${token}`;
  const stop = new AbortController();
  const kept = (async () => {
    while (!stop.signal.aborted) {
      const asked = await fetch(`${base}/api/ap/link`, { headers: { authorization }, signal: stop.signal }).catch(
        () => null,
      );
      if (!asked?.ok) return;
      const { requests } = (await asked.json()) as { requests: { id: string; url: string }[] };
      for (const sent of requests) {
        const body = served[new URL(sent.url).pathname];
        await fetch(`${base}/api/ap/link/replies/${sent.id}`, {
          method: "POST",
          headers: {
            authorization,
            "content-type": "application/octet-stream",
            "x-link-status": body ? "200" : "404",
            "x-link-headers": Buffer.from(JSON.stringify({ "content-type": "application/activity+json" })).toString(
              "base64url",
            ),
          },
          body: JSON.stringify(body ?? {}),
          signal: stop.signal,
        }).catch(() => null);
      }
    }
  })();
  await until(() => requestLinkOpen(stored.id));
  return {
    id: stored.id,
    close: async () => {
      stop.abort();
      await kept;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      // Gone at once, so the hour's count of new requests isn't run up.
      await prisma.peerRequest.deleteMany({ where: { id: stored.id } });
    },
  };
}

/** A request through a link from `there`'s address, reviewed here with that address counted as on the internet. */
async function reviewedFrom(
  there: { origin: string },
  home: Awaited<ReturnType<typeof instanceKey>>,
  timeoutMs?: number,
) {
  const asking = await linkedRequest(there.origin, "Home workshop", home);
  try {
    return await requestDetails(asking.id, { classify: onTheInternet, timeoutMs });
  } finally {
    await asking.close();
  }
}

describe("an address a request through a link names", () => {
  // What answers there is on this machine: reachable at all only with loopback let through.
  beforeEach(() => {
    process.env.FEDERATION_ALLOW_LOOPBACK = "1";
  });
  afterEach(() => {
    delete process.env.FEDERATION_ALLOW_LOOPBACK;
  });

  it("finds the instance that answers directly at an address on the internet, and never asks one at home", async () => {
    const key = await instanceKey();
    const there = await answering((origin) => instanceDocuments(origin, "Makerspace", key.pem));
    try {
      const found = await answersAt(there.origin, { classify: onTheInternet });
      expect(found?.name).toBe("Makerspace");
      expect(found?.fingerprint).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4})+$/);
      // On a home network it may be another machine from here: not asked at all.
      expect(await answersAt(there.origin)).toBeNull();
    } finally {
      await there.close();
    }
  });

  it("asks the address itself, never down a link this instance knows for it", async () => {
    const key = await instanceKey();
    const there = await answering((origin) => instanceDocuments(origin, "Makerspace", key.pem));
    // A partner at that address reaching this instance through its link, closed now: asked down it, this would fail.
    const peer = await prisma.peer.create({
      data: {
        origin: there.origin,
        status: "ACTIVE",
        link: "theirs",
        linkToken: sha256(newLinkToken()),
        actorUrl: `${there.origin}/api/ap/actors/instance`,
      },
    });
    invalidateAllowlist();
    try {
      expect(await lineFor(there.origin)).toBe(`peer:${peer.id}`);
      expect((await answersAt(there.origin, { classify: onTheInternet }))?.name).toBe("Makerspace");
    } finally {
      await prisma.peer.delete({ where: { id: peer.id } });
      invalidateAllowlist();
      await there.close();
    }
  });

  it("doesn't warn when what answers at a linked request's address has the key that came down its link", async () => {
    const home = await instanceKey();
    const there = await answering((origin) => instanceDocuments(origin, "Makerspace", home.pem));
    try {
      const details = await reviewedFrom(there, home);
      expect(details).toMatchObject({ verified: true, link: true, name: "Home workshop", elsewhere: null });
    } finally {
      await there.close();
    }
  }, 30_000);

  it("shows another instance answering at a linked request's address with another key", async () => {
    const home = await instanceKey();
    const other = await instanceKey();
    const there = await answering((origin) => instanceDocuments(origin, "Makerspace", other.pem));
    try {
      const details = await reviewedFrom(there, home);
      expect(details).toMatchObject({ verified: true, link: true, name: "Home workshop" });
      expect(details.elsewhere?.name).toBe("Makerspace");
      expect(details.elsewhere?.fingerprint).not.toBe(details.fingerprint);
    } finally {
      await there.close();
    }
  }, 30_000);

  it("reviews a linked request as usual when nothing listens at its address", async () => {
    const there = await answering("closed");
    const details = await reviewedFrom(there, await instanceKey());
    expect(details).toMatchObject({ verified: true, link: true, elsewhere: null });
  }, 30_000);

  it("gives up on an address that doesn't answer in time, fetch and all, without holding up the review", async () => {
    const there = await answering("silent");
    try {
      const started = Date.now();
      const details = await reviewedFrom(there, await instanceKey(), 500);
      expect(details).toMatchObject({ verified: true, link: true, elsewhere: null });
      expect(Date.now() - started).toBeLessThan(5000);
      // Its connection closed from this end, not left open until it answers.
      await until(() => there.givenUp());
    } finally {
      await there.close();
    }
  }, 30_000);
});
