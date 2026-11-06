// Two real instances pairing, end to end: each its own server process and database, talking ActivityPub over plain
// HTTP. Opt-in, since it needs two empty, migrated databases of its own:
//   FEDERATION_E2E_DB_A=postgresql://.../fed_a FEDERATION_E2E_DB_B=postgresql://.../fed_b \
//     npx vitest run tests/federationPairing.e2e.test.ts
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_A = process.env.FEDERATION_E2E_DB_A;
const DB_B = process.env.FEDERATION_E2E_DB_B;

type Instance = { base: string; process: ChildProcess; token?: string };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(label: string, fn: () => Promise<T | null | undefined | false>, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out: ${label}`);
    await wait(300);
  }
}

function start(database: string, port: number, secret: string): Instance {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-fed-e2e-"));
  const child = spawn(path.resolve("node_modules/.bin/tsx"), ["src/server.ts"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      DATABASE_URL: database,
      FILE_STORAGE: storage,
      FLARESOLVERR_URL: "",
      API_PORT: String(port),
      AUTH_SECRET: secret,
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      // Both on this machine, which is otherwise never an instance to talk to.
      FEDERATION_ALLOW_LOOPBACK: "1",
    },
    stdio: "ignore",
  });
  return { base: `http://127.0.0.1:${port}`, process: child };
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

describe.skipIf(!DB_A || !DB_B)("two instances pairing", () => {
  let a: Instance;
  let b: Instance;

  beforeAll(async () => {
    a = start(DB_A!, 8041, "e2e-secret-a");
    b = start(DB_B!, 8042, "e2e-secret-b");
    for (const [instance, name] of [
      [a, "Alex"],
      [b, "Bea"],
    ] as const) {
      await until(`${name}'s instance up`, async () => (await fetch(`${instance.base}/api/health`)).ok);
      const registered = await call(instance, "POST", "/register", {
        displayName: name,
        email: `${name.toLowerCase()}@example.com`,
        password: "password123",
      });
      instance.token = registered.body.token;
      await call(instance, "PATCH", "/social/settings", { enabled: true });
      const on = await call(instance, "PATCH", "/federation/settings", { enabled: true });
      if (on.body?.enabled !== true || on.body?.reachability?.kind !== "local") {
        throw new Error(`${name}'s instance didn't turn on: ${JSON.stringify(on.body)}`);
      }
    }
  }, 120_000);

  afterAll(() => {
    a?.process.kill();
    b?.process.kill();
  });

  it("asks, approves, connects, and disconnects", async () => {
    const lookup = await call(a, "GET", `/federation/lookup?address=${encodeURIComponent(b.base)}`);
    const bSettings = await call(b, "GET", "/federation/settings");
    expect(lookup.body.fingerprint).toBe(bSettings.body.fingerprint);

    const wrong = await call(a, "POST", "/federation/connect", {
      address: b.base,
      fingerprint: "0000 0000 0000 0000 0000 0000",
    });
    expect(wrong.body.code).toBe("key_changed");
    const asked = await call(a, "POST", "/federation/connect", {
      address: b.base,
      fingerprint: lookup.body.fingerprint,
      note: "Hi from Alex",
    });
    expect(asked.body.peer.status).toBe("OUTGOING");

    const incoming = await until(
      "B gets the request",
      async () => (await call(b, "GET", "/federation/instances")).body.incoming[0],
    );
    expect(incoming).toMatchObject({ origin: a.base, note: "Hi from Alex" });
    const details = await call(b, "GET", `/federation/requests/${incoming.id}`);
    const aSettings = await call(a, "GET", "/federation/settings");
    expect(details.body).toMatchObject({ verified: true, fingerprint: aSettings.body.fingerprint });

    const approved = await call(b, "POST", `/federation/requests/${incoming.id}/approve`, {
      fingerprint: details.body.fingerprint,
    });
    expect(approved.body.peer.status).toBe("ACTIVE");
    const partner = await until(
      "A sees B as a partner",
      async () => (await call(a, "GET", "/federation/instances")).body.partners[0],
    );
    expect(partner).toMatchObject({ origin: b.base, status: "ACTIVE" });
    const notices = await call(a, "GET", "/notifications");
    expect(JSON.stringify(notices.body)).toContain("Connected with");

    expect((await call(a, "POST", `/federation/peers/${partner.id}/disconnect`)).status).toBe(204);
    // Gone altogether: a peer left blocked or waiting would stand in the way of connecting again.
    await until("B sees it gone", async () => {
      const { partners, outgoing, blocked } = (await call(b, "GET", "/federation/instances")).body;
      return partners.length === 0 && outgoing.length === 0 && blocked.length === 0;
    });
  }, 120_000);

  it("won't approve a request its sender withdrew", async () => {
    const lookup = await call(a, "GET", `/federation/lookup?address=${encodeURIComponent(b.base)}`);
    const asked = await call(a, "POST", "/federation/connect", {
      address: b.base,
      fingerprint: lookup.body.fingerprint,
    });
    const incoming = await until(
      "B gets the request",
      async () => (await call(b, "GET", "/federation/instances")).body.incoming[0],
    );
    // Withdrawn before B's admin answered: B isn't a partner of A's, so its goodbye doesn't get through.
    expect((await call(a, "POST", `/federation/peers/${asked.body.peer.id}/disconnect`)).status).toBe(204);
    const details = await call(b, "GET", `/federation/requests/${incoming.id}`);
    expect(details.body.code).toBe("withdrawn");
    const after = (await call(b, "GET", "/federation/instances")).body;
    expect(after.incoming).toEqual([]);
    expect(after.partners).toEqual([]);
  }, 120_000);

  it("connects for someone who asked to reach a person elsewhere", async () => {
    // Sam on A wants to reach Bob on B; neither is an admin.
    const sam: Instance = { ...a, token: undefined };
    sam.token = (
      await call(sam, "POST", "/register", { displayName: "Sam", email: "sam@example.com", password: "password123" })
    ).body.token;
    const bob: Instance = { ...b, token: undefined };
    bob.token = (
      await call(bob, "POST", "/register", { displayName: "Bob", email: "bob@example.com", password: "password123" })
    ).body.token;
    const bHost = new URL(b.base).host;

    const asked = await call(sam, "POST", "/me/connection-requests", {
      handle: `bob@${bHost}`,
      note: "Gridfinity bins",
    });
    expect(asked.status).toBe(201);
    expect(asked.body).toMatchObject({ handle: `bob@${bHost}`, status: "waiting_admin" });

    // A's admin sees it under their people's requests, and connects for Sam.
    const local = (await call(a, "GET", "/federation/instances")).body.local[0];
    expect(local).toMatchObject({ userName: "Sam", targetHandle: `bob@${bHost}`, note: "Gridfinity bins" });
    const lookup = await call(a, "GET", `/federation/lookup?address=${encodeURIComponent(local.origin)}`);
    const sent = await call(a, "POST", "/federation/connect", {
      address: local.origin,
      fingerprint: lookup.body.fingerprint,
      requestId: local.id,
    });
    expect(sent.body.peer.status).toBe("OUTGOING");
    expect((await call(sam, "GET", "/me/connection-requests")).body[0].status).toBe("waiting_them");

    // B's admin sees who asked for whom, and that Bob is one of theirs.
    const incoming = await until(
      "B gets the request",
      async () => (await call(b, "GET", "/federation/instances")).body.incoming[0],
    );
    const aHost = new URL(a.base).host;
    expect(incoming).toMatchObject({ requesterHandle: `sam@${aHost}`, targetHandle: `bob@${bHost}` });
    const details = await call(b, "GET", `/federation/requests/${incoming.id}`);
    expect(details.body.target).toEqual({ username: "bob", displayName: "Bob" });
    await call(b, "POST", `/federation/requests/${incoming.id}/approve`, { fingerprint: details.body.fingerprint });

    // Bob hears who asked; Sam hears it's connected.
    await until("Sam's request connected", async () => {
      const mine = await call(sam, "GET", "/me/connection-requests");
      return mine.body[0].status === "connected";
    });
    expect(JSON.stringify((await call(bob, "GET", "/notifications")).body)).toContain(
      `sam@${aHost} asked to reach you`,
    );
    expect(JSON.stringify((await call(sam, "GET", "/notifications")).body)).toContain("Connected with");
  }, 120_000);

  it("shows what a partner's people share on Explore, and forgets it on disconnecting", async () => {
    // Rūta on B shares a collection with a model in it; A and B are partners from the test before.
    const ruta: Instance = { ...b, token: undefined };
    ruta.token = (
      await call(ruta, "POST", "/register", { displayName: "Rūta", email: "ruta@example.com", password: "password123" })
    ).body.token;
    const form = new FormData();
    form.append("files", new Blob(["solid bin endsolid"]), "gridfinity-bin.stl");
    const uploaded = await fetch(`${b.base}/api/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ruta.token}` },
      body: form,
    });
    const printId = (await uploaded.json()).prints[0].id;
    const collection = await call(ruta, "POST", "/collections", { name: "Tool wall", is_public: true });
    await call(ruta, "POST", `/collection/${collection.body.id}/items/${printId}`);

    // A's admin checks the connection, which reads what B shares again.
    const partner = (await call(a, "GET", "/federation/instances")).body.partners[0];
    expect((await call(a, "POST", `/federation/peers/${partner.id}/check`)).status).toBe(200);
    const explore = await until("A's Explore shows Rūta", async () => {
      const res = await call(a, "GET", "/explore");
      return (
        res.body.elsewhere.people.some((person: { display_name: string }) => person.display_name === "Rūta") && res.body
      );
    });
    const person = explore.elsewhere.people.find((item: { display_name: string }) => item.display_name === "Rūta");
    expect(person).toMatchObject({ model_count: 1, collection_count: 1, instance: { id: partner.id } });
    expect(explore.elsewhere.recent_models[0]).toMatchObject({ title: "gridfinity-bin", file_count: 1 });
    expect(explore.elsewhere.recent_collections[0]).toMatchObject({ name: "Tool wall", item_count: 1 });

    // Her avatar comes through A, which fetched it signed from B.
    const avatar = await fetch(`${a.base}/api${person.avatar_url}`, {
      headers: { Authorization: `Bearer ${a.token}` },
    });
    expect(avatar.status).toBe(200);
    expect(avatar.headers.get("content-type")).toMatch(/^image\//);
    // B answers no one else.
    expect((await fetch(`${b.base}/api/ap/directory`)).status).toBe(401);

    expect((await call(a, "POST", `/federation/peers/${partner.id}/disconnect`)).status).toBe(204);
    const after = await call(a, "GET", "/explore");
    expect(after.body.elsewhere.people).toEqual([]);
    expect((await call(a, "GET", `/explore/elsewhere/person/${person.id}`)).status).toBe(404);
  }, 120_000);
});
