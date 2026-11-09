// Two real instances pairing, end to end: each its own server process and database, talking ActivityPub over plain
// HTTP. Opt-in, since it needs two empty, migrated databases of its own:
//   FEDERATION_E2E_DB_A=postgresql://.../fed_a FEDERATION_E2E_DB_B=postgresql://.../fed_b \
//     npx vitest run tests/federationPairing.e2e.test.ts
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
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
      await call(instance, "PATCH", "/social/settings", { enabled: true, chats: true });
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

  it("isn't kept from an instance by requests someone else sent in its name", async () => {
    // Anyone can send a request naming B's address, one keeping a link among them: none is checked until it's answered.
    for (const [n, extra] of [
      [1, {}],
      [2, { "thingport:link": crypto.randomBytes(32).toString("base64url") }],
    ] as const) {
      const forged = await fetch(`${a.base}/api/ap/inbox`, {
        method: "POST",
        headers: {
          "Content-Type": "application/activity+json",
          Signature: `keyId="${b.base}/api/ap/actors/instance#main-key",signature="x"`,
        },
        body: JSON.stringify({
          type: "Follow",
          id: `${b.base}/api/ap/follows/forged-${n}`,
          actor: `${b.base}/api/ap/actors/instance`,
          object: `${a.base}/api/ap/actors/instance`,
          ...extra,
        }),
      });
      expect(forged.status).toBe(202);
    }
    // A still reaches B itself, and asks it rather than approving one of those.
    const lookup = await call(a, "GET", `/federation/lookup?address=${encodeURIComponent(b.base)}`);
    const bSettings = await call(b, "GET", "/federation/settings");
    expect(lookup.body.fingerprint).toBe(bSettings.body.fingerprint);
    const asked = await call(a, "POST", "/federation/connect", {
      address: b.base,
      fingerprint: lookup.body.fingerprint,
    });
    expect(asked.body.peer?.status).toBe("OUTGOING");
    const incoming = await until(
      "B gets the request",
      async () => (await call(b, "GET", "/federation/instances")).body.incoming[0],
    );
    const details = await call(b, "GET", `/federation/requests/${incoming.id}`);
    await call(b, "POST", `/federation/requests/${incoming.id}/approve`, { fingerprint: details.body.fingerprint });
    const partner = await until("A connected with B", async () => {
      const found = (await call(a, "GET", "/federation/instances")).body.partners[0];
      return found?.status === "ACTIVE" && found;
    });

    // The one with a link is still waiting; declining it leaves B reachable.
    const waiting = (await call(a, "GET", "/federation/instances")).body.incoming;
    expect(waiting).toMatchObject([{ origin: b.base, link: true }]);
    expect((await call(a, "POST", `/federation/requests/${waiting[0].id}/decline`)).status).toBe(204);
    const again = await call(a, "GET", `/federation/lookup?address=${encodeURIComponent(b.base)}`);
    expect(again.body.fingerprint).toBe(bSettings.body.fingerprint);

    expect((await call(a, "POST", `/federation/peers/${partner.id}/disconnect`)).status).toBe(204);
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
    // Tom asks for Bea there too, before A's admin gets to it: one request goes, naming both.
    const tom: Instance = { ...a, token: undefined };
    tom.token = (
      await call(tom, "POST", "/register", { displayName: "Tom", email: "tom@example.com", password: "password123" })
    ).body.token;
    expect((await call(tom, "POST", "/me/connection-requests", { handle: `bea@${bHost}` })).status).toBe(201);

    // A's admin sees it under their people's requests, and connects for Sam.
    const local = (await call(a, "GET", "/federation/instances")).body.local.find(
      (item: { userName: string }) => item.userName === "Sam",
    );
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
    expect(incoming.asks).toEqual([
      { requesterHandle: `sam@${aHost}`, targetHandle: `bob@${bHost}` },
      { requesterHandle: `tom@${aHost}`, targetHandle: `bea@${bHost}` },
    ]);
    const details = await call(b, "GET", `/federation/requests/${incoming.id}`);
    expect(details.body.target).toEqual({ username: "bob", displayName: "Bob" });
    expect(details.body.request.asks.map((ask: { target: unknown }) => ask.target)).toEqual([
      { username: "bob", displayName: "Bob" },
      { username: "bea", displayName: "Bea" },
    ]);
    await call(b, "POST", `/federation/requests/${incoming.id}/approve`, { fingerprint: details.body.fingerprint });

    // Bob hears who asked; Sam hears it's connected.
    await until("Sam's request connected", async () => {
      const mine = await call(sam, "GET", "/me/connection-requests");
      return mine.body[0].status === "connected";
    });
    expect(JSON.stringify((await call(bob, "GET", "/notifications")).body)).toContain(
      `sam@${aHost} asked to reach you`,
    );
    expect(JSON.stringify((await call(b, "GET", "/notifications")).body)).toContain(`tom@${aHost} asked to reach you`);
    await until("Tom's request connected", async () => {
      const mine = await call(tom, "GET", "/me/connection-requests");
      return mine.body[0].status === "connected";
    });
    await until("Sam hears it's connected", async () =>
      JSON.stringify((await call(sam, "GET", "/notifications")).body).includes("Connected with"),
    );
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
    // Sorted and tagged as she has it: a copy is the same model, in the copier's own category of the same names.
    const testModels = async (instance: Instance) => {
      const categories: { id: string; name: string; parent_id: string | null }[] = (
        await call(instance, "GET", "/categories")
      ).body;
      const printer = categories.find((category) => category.name === "3D Printer" && !category.parent_id)!;
      return categories.find((category) => category.name === "Test Models" && category.parent_id === printer.id)!.id;
    };
    await call(ruta, "POST", `/print/${printId}/category`, { category_id: await testModels(ruta) });
    await call(ruta, "POST", `/print/${printId}/tags`, { tags: ["Gridfinity", "Bin"] });
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

    // Her model's file comes through A as well: downloaded, handed to a slicer with the token in the path, zipped.
    const modelId = explore.elsewhere.recent_models[0].id;
    const model = await call(a, "GET", `/explore/elsewhere/model/${modelId}`);
    const [file] = model.body.files;
    expect(file).toMatchObject({
      name: "gridfinity-bin.stl",
      url: expect.stringMatching(
        new RegExp(`^/explore/elsewhere/model/${modelId}/files/[0-9a-f]{16}/gridfinity-bin\\.stl$`),
      ),
    });
    const signedIn = { Authorization: `Bearer ${a.token}` };
    const downloaded = await fetch(`${a.base}/api${file.url}`, { headers: signedIn });
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-disposition")).toBe('attachment; filename="gridfinity-bin.stl"');
    expect(await downloaded.text()).toBe("solid bin endsolid");
    const forSlicer = await fetch(`${a.base}/api/t/${encodeURIComponent(a.token!)}${file.url}`);
    expect(await forSlicer.text()).toBe("solid bin endsolid");
    const zip = await fetch(`${a.base}/api/explore/elsewhere/model/${modelId}/files.zip`, { headers: signedIn });
    expect(zip.status).toBe(200);
    expect(
      Buffer.from(await zip.arrayBuffer())
        .subarray(0, 2)
        .toString(),
    ).toBe("PK");
    // B's own address for it answers only partners.
    const plate = (await call(ruta, "GET", `/print/${printId}`)).body.plates[0];
    expect((await fetch(`${b.base}/api/ap/files/plate/${plate.id}/gridfinity-bin.stl`)).status).toBe(401);

    // Copied into Alex's library, where it says whose it was and links back.
    expect((await call(a, "POST", `/explore/elsewhere/model/${modelId}/copy`)).status).toBe(200);
    const copied = await until("A's copy is made", async () => {
      const status = await call(a, "GET", `/explore/elsewhere/model/${modelId}/copy`);
      if (status.body.state === "failed") throw new Error(status.body.error);
      return status.body.state === "done" && status.body;
    });
    expect(copied.files).toEqual([{ name: "gridfinity-bin.stl", size: 18, received: 18, done: true }]);
    const copy = await call(a, "GET", `/print/${copied.copy_id}`);
    expect(copy.body).toMatchObject({
      title: "gridfinity-bin",
      tags: ["Gridfinity", "Bin"],
      category_id: await testModels(a),
      category_source: "rule",
      plates: [expect.objectContaining({ filename: "gridfinity-bin.stl" })],
      copied_from_remote: {
        instance: { origin: b.base },
        owner_name: "Rūta",
        original_id: modelId,
      },
    });
    expect((await call(a, "GET", `/explore/elsewhere/model/${modelId}`)).body.library_copy_id).toBe(copied.copy_id);
    expect((await call(a, "POST", `/explore/elsewhere/model/${modelId}/copy`)).body).toMatchObject({
      state: "done",
      copy_id: copied.copy_id,
    });

    // Alex writes to Rūta, found among the people to write to; it reaches her on B, and her answer him on A.
    const found = await call(a, "GET", `/chats/people?q=${encodeURIComponent("Rūta")}`);
    const rutaThere = found.body.people.find((item: { remote: unknown }) => item.remote);
    expect(rutaThere).toMatchObject({ display_name: "Rūta", remote: { instance: { origin: b.base } } });
    const direct = await call(a, "POST", "/chats/direct", { remote_person_id: rutaThere.id });
    expect((await call(a, "POST", `/chats/${direct.body.id}/messages`, { body: "Hi Rūta! Supports?" })).status).toBe(
      200,
    );
    const hers = await until("Rūta has Alex's message", async () => {
      const chats = await call(ruta, "GET", "/chats");
      return chats.body.chats.find(
        (chat: { kind: string; last_message: { body: string } | null }) =>
          chat.kind === "direct" && chat.last_message?.body === "Hi Rūta! Supports?",
      );
    });
    expect(hers.other).toMatchObject({ display_name: "Alex", remote: { instance: { origin: a.base } } });
    expect((await call(ruta, "POST", `/chats/${hers.id}/messages`, { body: "None needed" })).status).toBe(200);
    const answer = await until("Alex has Rūta's answer", async () => {
      const page = await call(a, "GET", `/chats/${direct.body.id}/messages`);
      return page.body.messages.find((message: { body: string }) => message.body === "None needed");
    });
    expect(answer.sender).toMatchObject({ display_name: "Rūta", remote: { instance: { origin: b.base } } });

    // A room hosted on A with Rūta in it: B keeps a copy for her, and what's said goes both ways.
    const room = await call(a, "POST", "/chats/rooms", {
      name: "Print farm",
      is_public: false,
      remote_member_ids: [rutaThere.id],
    });
    expect(room.status).toBe(200);
    const copyThere = await until("B has the room for Rūta", async () => {
      const chats = await call(ruta, "GET", "/chats");
      return chats.body.chats.find((chat: { name: string | null }) => chat.name === "Print farm");
    });
    expect(copyThere).toMatchObject({ kind: "room", hosted_by: { origin: a.base }, joined: true, can_manage: false });
    expect((await call(ruta, "POST", `/chats/${copyThere.id}/messages`, { body: "Baseplates tonight" })).status).toBe(
      200,
    );
    const inRoom = await until("Alex has Rūta's room message", async () => {
      const page = await call(a, "GET", `/chats/${room.body.id}/messages`);
      return page.body.messages.find((message: { body: string }) => message.body === "Baseplates tonight");
    });
    expect(inRoom.sender).toMatchObject({ display_name: "Rūta" });
    expect((await call(a, "POST", `/chats/${room.body.id}/messages`, { body: "Loading PETG" })).status).toBe(200);
    await until("Rūta has Alex's room message", async () => {
      const page = await call(ruta, "GET", `/chats/${copyThere.id}/messages`);
      return page.body.messages.some((message: { body: string }) => message.body === "Loading PETG");
    });
    // She leaves: the room on A no longer has her.
    expect((await call(ruta, "POST", `/chats/${copyThere.id}/leave`)).status).toBe(200);
    await until("A's room without Rūta", async () => {
      const detail = await call(a, "GET", `/chats/${room.body.id}`);
      return !detail.body.members.some((member: { remote: unknown }) => member.remote) && detail.body;
    });

    // Alex shares a collection with Rūta alone: B is told, reads it from A, and keeps it for her, not for Bea.
    const deskForm = new FormData();
    deskForm.append("files", new Blob(["solid tray endsolid"]), "desk-tray.stl");
    const deskUpload = await fetch(`${a.base}/api/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${a.token}` },
      body: deskForm,
    });
    const deskPrintId = (await deskUpload.json()).prints[0].id;
    const desk = await call(a, "POST", "/collections", { name: "Desk organisers" });
    await call(a, "POST", `/collection/${desk.body.id}/items/${deskPrintId}`);
    const shared = await call(a, "PATCH", `/collection/${desk.body.id}/sharing`, {
      visibility: "shared",
      add_remote_person_ids: [rutaThere.id],
    });
    expect(shared.status).toBe(200);
    expect(shared.body.people[0]).toMatchObject({ display_name: "Rūta", remote: { instance: { origin: b.base } } });
    const sharedThere = await until("B keeps Alex's collection for Rūta", async () => {
      const res = await call(ruta, "GET", "/explore");
      return res.body.elsewhere.shared_with_you.find((item: { name: string }) => item.name === "Desk organisers");
    });
    expect(sharedThere).toMatchObject({ item_count: 1, owner: { display_name: "Alex" } });
    expect((await call(b, "GET", "/explore")).body.elsewhere.shared_with_you).toEqual([]);
    expect((await call(b, "GET", `/explore/elsewhere/collection/${sharedThere.id}`)).status).toBe(404);
    const deskPage = await call(ruta, "GET", `/explore/elsewhere/collection/${sharedThere.id}`);
    expect(deskPage.body.models[0]).toMatchObject({ title: "desk-tray" });
    const deskModel = await call(ruta, "GET", `/explore/elsewhere/model/${deskPage.body.models[0].id}`);
    const deskFile = await fetch(`${b.base}/api${deskModel.body.files[0].url}`, {
      headers: { Authorization: `Bearer ${ruta.token}` },
    });
    expect(deskFile.status).toBe(200);
    expect(await deskFile.text()).toBe("solid tray endsolid");
    expect((await call(b, "GET", `/explore/elsewhere/model/${deskPage.body.models[0].id}`)).status).toBe(404);

    // Rūta finds Alex by his handle, though he shares nothing openly: B asks A for him.
    const alexHandle = `${(await call(a, "GET", "/me")).body.user.username}@${new URL(a.base).host}`;
    const alexThere = await call(ruta, "GET", `/social/people?q=${encodeURIComponent(alexHandle)}`);
    expect(alexThere.body.people.find((item: { remote: unknown }) => item.remote)).toMatchObject({
      display_name: "Alex",
      remote: { handle: alexHandle },
    });

    // Taken off the list, it's gone for her on B.
    await call(a, "PATCH", `/collection/${desk.body.id}/sharing`, { remove_remote_person_ids: [rutaThere.id] });
    await until("B lets Alex's collection go", async () => {
      const res = await call(ruta, "GET", "/explore");
      return res.body.elsewhere.shared_with_you.length === 0;
    });

    expect((await call(a, "POST", `/federation/peers/${partner.id}/disconnect`)).status).toBe(204);
    const after = await call(a, "GET", "/explore");
    expect(after.body.elsewhere.people).toEqual([]);
    expect((await call(a, "GET", `/explore/elsewhere/person/${person.id}`)).status).toBe(404);
    // The copy is Alex's to keep, still saying where it came from.
    const kept = await call(a, "GET", `/print/${copied.copy_id}`);
    expect(kept.body.copied_from_remote).toMatchObject({ owner_name: "Rūta", original_id: null, owner_id: null });
  }, 120_000);
});
