// Two real instances pairing when only one can reach the other: a home one behind NAT and one on the internet. Nothing
// answers at the home one's Public URL, not even for itself, as behind a router that can't loop back or a certificate
// nothing trusts: it turns on all the same, and whatever the other needs from it comes down the link it keeps open.
// Opt-in, with two empty, migrated databases of its own:
//   FEDERATION_E2E_DB_C=postgresql://.../fed_c FEDERATION_E2E_DB_D=postgresql://.../fed_d \
//     npx vitest run tests/federationLink.e2e.test.ts
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_HOME = process.env.FEDERATION_E2E_DB_C;
const DB_PUBLIC = process.env.FEDERATION_E2E_DB_D;

/** `base` is where this test reaches it, `origin` its Public URL, what other instances know it by. */
type Instance = { base: string; origin: string; process: ChildProcess; token?: string };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(label: string, fn: () => Promise<T | null | undefined | false>, ms = 45_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out: ${label}`);
    await wait(300);
  }
}

function start(database: string, port: number, secret: string, origin = `http://127.0.0.1:${port}`): Instance {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-link-e2e-"));
  const child = spawn(path.resolve("node_modules/.bin/tsx"), ["src/server.ts"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      DATABASE_URL: database,
      FILE_STORAGE: storage,
      FLARESOLVERR_URL: "",
      API_PORT: String(port),
      AUTH_SECRET: secret,
      PUBLIC_URL: origin,
      FEDERATION_ALLOW_LOOPBACK: "1",
    },
    // FEDERATION_E2E_LOGS=<dir> keeps each instance's output there.
    stdio: process.env.FEDERATION_E2E_LOGS
      ? [
          "ignore",
          fs.openSync(path.join(process.env.FEDERATION_E2E_LOGS, `${port}.log`), "w"),
          fs.openSync(path.join(process.env.FEDERATION_E2E_LOGS, `${port}.err.log`), "w"),
        ]
      : "ignore",
  });
  return { base: `http://127.0.0.1:${port}`, origin, process: child };
}

async function call(instance: Instance, method: string, route: string, body?: unknown) {
  const res = await fetch(`${instance.base}/api${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(instance.token ? { Authorization: `Bearer ${instance.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe.skipIf(!DB_HOME || !DB_PUBLIC)("pairing through a link", () => {
  let home: Instance;
  let reachable: Instance;
  const turnedOn = new Map<Instance, { reachability: { kind: string; reason: string | null } }>();

  beforeAll(async () => {
    // Listening on 8051, known by an address where nothing does.
    home = start(DB_HOME!, 8051, "e2e-secret-home", "http://127.0.0.1:8059");
    reachable = start(DB_PUBLIC!, 8052, "e2e-secret-public");
    for (const [instance, name] of [
      [home, "Hana"],
      [reachable, "Petras"],
    ] as const) {
      await until(`${name}'s instance up`, async () => (await fetch(`${instance.base}/api/health`)).ok);
      const registered = await call(instance, "POST", "/register", {
        displayName: name,
        email: `${name.toLowerCase()}@example.com`,
        password: "password123",
      });
      instance.token = registered.body.token;
      await call(instance, "PATCH", "/social/settings", { enabled: true, chats: true });
      const on = await call(instance, "PATCH", "/federation/settings", { enabled: true });
      if (on.body?.enabled !== true) throw new Error(`${name}'s instance didn't turn on: ${JSON.stringify(on.body)}`);
      turnedOn.set(instance, on.body);
    }
  }, 120_000);

  afterAll(() => {
    home?.process.kill();
    reachable?.process.kill();
  });

  it("pairs, shares, chats and disconnects with only the home instance reaching out", async () => {
    // Not even the home instance reached itself, and it's on: through links only.
    expect(turnedOn.get(home)?.reachability).toMatchObject({ kind: "unreachable", reason: "refused" });
    expect(turnedOn.get(reachable)?.reachability).toMatchObject({ kind: "local" });
    // The instance on the internet can't reach the home one to ask it.
    const cannot = await call(reachable, "GET", `/federation/lookup?address=${encodeURIComponent(home.origin)}`);
    expect(cannot.body.code).toBe("unreachable");

    // The home one asks, keeping a link open, as its lookup suggests.
    const lookup = await call(home, "GET", `/federation/lookup?address=${encodeURIComponent(reachable.base)}`);
    expect(lookup.body.suggestLink).toBe("unreachable");
    const asked = await call(home, "POST", "/federation/connect", {
      address: reachable.base,
      fingerprint: lookup.body.fingerprint,
      note: "From the workshop at home",
      link: true,
    });
    expect(asked.body.peer).toMatchObject({ status: "OUTGOING", link: "ours" });

    // Its request arrives with its link, which opens while it waits: the admin there reviews it through that.
    const incoming = await until("the request, its link open", async () => {
      const found = (await call(reachable, "GET", "/federation/instances")).body.incoming[0];
      return found?.linkOpen && found;
    });
    expect(incoming).toMatchObject({ origin: home.origin, link: true, note: "From the workshop at home" });
    // Another request from that address with a link of its own, as from an instance with the same address on another
    // network: it's declined with the approval below.
    const elsewhere = crypto.randomBytes(32).toString("base64url");
    const another = await fetch(`${reachable.base}/api/ap/inbox`, {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json",
        Signature: `keyId="${home.origin}/api/ap/actors/instance#main-key",signature="x"`,
      },
      body: JSON.stringify({
        type: "Follow",
        id: `${home.origin}/api/ap/follows/elsewhere`,
        actor: `${home.origin}/api/ap/actors/instance`,
        object: `${reachable.base}/api/ap/actors/instance`,
        "thingport:link": elsewhere,
      }),
    });
    expect(another.status).toBe(202);
    const details = await call(reachable, "GET", `/federation/requests/${incoming.id}`);
    const homeSettings = await call(home, "GET", "/federation/settings");
    expect(details.body).toMatchObject({ verified: true, link: true, fingerprint: homeSettings.body.fingerprint });

    const approved = await call(reachable, "POST", `/federation/requests/${incoming.id}/approve`, {
      fingerprint: details.body.fingerprint,
    });
    expect(approved.body.peer).toMatchObject({ status: "ACTIVE", link: "theirs" });
    // The other one's link hears it was declined the next time it asks, so it stops asking.
    const told = await fetch(`${reachable.base}/api/ap/link`, { headers: { Authorization: `Link ${elsewhere}` } });
    expect(told.status).toBe(410);
    expect(await told.json()).toEqual({ reason: "declined" });
    // Its yes went down the link.
    const partner = await until("the home instance connected", async () => {
      const found = (await call(home, "GET", "/federation/instances")).body.partners[0];
      return found?.status === "ACTIVE" && found;
    });
    expect(partner).toMatchObject({ origin: reachable.base, link: "ours", linkOpen: true });
    const homeThere = (await call(reachable, "GET", "/federation/instances")).body.partners[0];
    expect(homeThere).toMatchObject({ origin: home.origin, link: "theirs", linkOpen: true });

    // Rūta at home shares a model; the instance on the internet reads it, picture and file too, through the link.
    const ruta: Instance = { ...home, token: undefined };
    ruta.token = (
      await call(ruta, "POST", "/register", { displayName: "Rūta", email: "ruta@example.com", password: "password123" })
    ).body.token;
    const form = new FormData();
    form.append("files", new Blob(["solid bin endsolid"]), "gridfinity-bin.stl");
    const uploaded = await fetch(`${home.base}/api/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ruta.token}` },
      body: form,
    });
    const printId = (await uploaded.json()).prints[0].id;
    const collection = await call(ruta, "POST", "/collections", { name: "Tool wall", is_public: true });
    await call(ruta, "POST", `/collection/${collection.body.id}/items/${printId}`);
    const checked = await call(reachable, "POST", `/federation/peers/${homeThere.id}/check`);
    expect(checked.status).toBe(200);
    expect(checked.body.lastError).toBeNull();
    const explore = await until("Rūta on Explore there", async () => {
      const res = await call(reachable, "GET", "/explore");
      return res.body.elsewhere.people.some((person: { display_name: string }) => person.display_name === "Rūta")
        ? res.body
        : null;
    });
    const person = explore.elsewhere.people.find((item: { display_name: string }) => item.display_name === "Rūta");
    const avatar = await fetch(`${reachable.base}/api${person.avatar_url}`, {
      headers: { Authorization: `Bearer ${reachable.token}` },
    });
    expect(avatar.status).toBe(200);
    const modelId = explore.elsewhere.recent_models[0].id;
    const model = await call(reachable, "GET", `/explore/elsewhere/model/${modelId}`);
    const downloaded = await fetch(`${reachable.base}/api${model.body.files[0].url}`, {
      headers: { Authorization: `Bearer ${reachable.token}` },
    });
    expect(downloaded.status).toBe(200);
    expect(await downloaded.text()).toBe("solid bin endsolid");

    // Messages both ways: down the link to her, straight back.
    const found = await call(reachable, "GET", `/chats/people?q=${encodeURIComponent("Rūta")}`);
    const rutaThere = found.body.people.find((item: { remote: unknown }) => item.remote);
    expect(rutaThere).toMatchObject({ display_name: "Rūta", remote: { instance: { origin: home.origin } } });
    const direct = await call(reachable, "POST", "/chats/direct", { remote_person_id: rutaThere.id });
    expect(
      (await call(reachable, "POST", `/chats/${direct.body.id}/messages`, { body: "Hi from the club" })).status,
    ).toBe(200);
    const hers = await until("Rūta gets it at home", async () => {
      const chats = await call(ruta, "GET", "/chats");
      return chats.body.chats.find(
        (chat: { kind: string; last_message: { body: string } | null }) =>
          chat.kind === "direct" && chat.last_message?.body === "Hi from the club",
      );
    });
    expect((await call(ruta, "POST", `/chats/${hers.id}/messages`, { body: "Hello back" })).status).toBe(200);
    await until("her answer there", async () => {
      const page = await call(reachable, "GET", `/chats/${direct.body.id}/messages`);
      return page.body.messages.find((message: { body: string }) => message.body === "Hello back");
    });

    // Being reached down its own link proves nothing about the home instance being reachable.
    const homePartner = (await call(home, "GET", "/federation/instances")).body.partners[0];
    expect(homePartner.lastInboundAt).toBeNull();

    // Disconnected there: the home instance hears it the next time its link asks, and lets go.
    expect((await call(reachable, "POST", `/federation/peers/${homeThere.id}/disconnect`)).status).toBe(204);
    await until("gone at home too", async () => {
      const { partners, outgoing } = (await call(home, "GET", "/federation/instances")).body;
      return partners.length === 0 && outgoing.length === 0;
    });
  }, 180_000);
});
