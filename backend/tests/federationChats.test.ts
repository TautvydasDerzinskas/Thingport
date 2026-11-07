import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { invalidateAllowlist } from "../src/federation/allowlist";
import {
  deletionFrom,
  leavingFrom,
  placeNote,
  RetryLater,
  roomChanged,
  roomFrom,
  type IncomingNote,
} from "../src/federation/chats";
import { resetRuntime } from "../src/federation/runtime";
import { clearFederationSettingsCache, updateFederationSettings } from "../src/federation/settings";
import { messageArrived, messageDeletedThere } from "../src/services/chatService";
import { getSocialSettings, setSocialSettings } from "../src/services/settingsService";

const app = createApp();
const ORIGIN = "http://192.0.2.70:8000";
const PARTNER = "http://203.0.113.90";
const OTHER = "http://203.0.113.91";
const KEYS = ["federation", "public_url"];

type Account = { token: string; id: string };
async function register(name: string): Promise<Account> {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: name, email: `fc-${name.toLowerCase()}-${Date.now()}@example.com`, password: "password123" });
  if (res.status !== 200) throw new Error(`Couldn't register ${name}: ${res.status}`);
  return { token: res.body.token, id: res.body.user.id };
}
const auth = (account: Account) => ({ Authorization: `Bearer ${account.token}` });
const actorOf = (origin: string) => new URL(`${origin}/api/ap/actors/instance`);
const person = (origin: string, name: string) => ({
  id: `${origin}/api/ap/actors/${name.toLowerCase()}`,
  name,
  preferredUsername: name.toLowerCase(),
  icon: null,
});
let counter = 0;
const note = (fields: Partial<IncomingNote> & Pick<IncomingNote, "to">): IncomingNote => ({
  id: `${PARTNER}/api/ap/messages/n${++counter}-${Date.now()}`,
  attributedTo: person(PARTNER, "Ruta"),
  context: null,
  text: "Hi there",
  attachments: [],
  ...fields,
});
const deliveries = async (origin: string) =>
  (await prisma.federationDelivery.findMany({ where: { origin }, orderBy: { createdAt: "asc" } })).map(
    (row) => row.activity as Record<string, unknown> & { object: Record<string, unknown> },
  );
/** Sending is started and not waited for, as in the app. */
const until = async <T>(fn: () => Promise<T | null | false | undefined>): Promise<T> => {
  for (let n = 0; n < 50; n++) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out");
};

let savedSocial: Awaited<ReturnType<typeof getSocialSettings>>;
let savedSettings: { key: string; value: Prisma.JsonValue }[];
let admin: Account;
let local: Account;
let partnerId: string;
let otherId: string;
let rutaId: string;
let tomasId: string;
const localActor = () => `${ORIGIN}/api/ap/actors/${local.id}`;

beforeAll(async () => {
  savedSocial = await getSocialSettings();
  savedSettings = await prisma.setting.findMany({ where: { key: { in: KEYS } } });
  admin = await register("ChatAdmin");
  local = await register("Linas");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  await setSocialSettings({ enabled: true, chats: true });
  await prisma.setting.upsert({
    where: { key: "public_url" },
    create: { key: "public_url", value: ORIGIN },
    update: { value: ORIGIN },
  });
  await updateFederationSettings({ enabled: true });
  resetRuntime();
  await prisma.peer.deleteMany({ where: { origin: { in: [PARTNER, OTHER] } } });
  const peer = (origin: string, name: string) =>
    prisma.peer.create({
      data: {
        origin,
        name,
        status: "ACTIVE",
        actorUrl: actorOf(origin).href,
        inboxUrl: `${origin}/api/ap/inbox`,
        connectedAt: new Date(),
      },
    });
  partnerId = (await peer(PARTNER, "Makerspace")).id;
  otherId = (await peer(OTHER, "Print club")).id;
  invalidateAllowlist();
  // Listed: they share something, so Explore and the people picker know them.
  const listed = (peerId: string, origin: string, name: string) =>
    prisma.remotePerson.create({
      data: { peerId, apId: person(origin, name).id, username: name.toLowerCase(), displayName: name, listed: true },
    });
  rutaId = (await listed(partnerId, PARTNER, "Ruta")).id;
  tomasId = (await listed(otherId, OTHER, "Tomas")).id;
});

afterAll(async () => {
  await prisma.chat.deleteMany({ where: { members: { some: { userId: { in: [admin.id, local.id] } } } } });
  await prisma.federationDelivery.deleteMany({ where: { origin: { in: [PARTNER, OTHER] } } });
  await prisma.peer.deleteMany({ where: { origin: { in: [PARTNER, OTHER] } } });
  await setSocialSettings(savedSocial);
  await prisma.setting.deleteMany({ where: { key: { in: KEYS } } });
  for (const row of savedSettings) {
    await prisma.setting.create({ data: { key: row.key, value: row.value as Prisma.InputJsonValue } });
  }
  clearFederationSettingsCache();
  invalidateAllowlist();
  resetRuntime();
});

describe("direct messages with partners' people", () => {
  it("keeps a message from someone elsewhere once, and tells the person it's for", async () => {
    const newbie = person(PARTNER, "Newbie");
    const message = note({
      attributedTo: newbie,
      to: [localActor()],
      attachments: [{ href: `${PARTNER}/api/ap/models/x1`, name: "Bin" }],
    });
    const placed = await placeNote(actorOf(PARTNER), message, false);
    expect(placed).toMatchObject({ hostedHere: false });
    await messageArrived({ ...placed!, peerId: placed!.peer.id });
    // A retried delivery isn't kept twice.
    await messageArrived({ ...placed!, peerId: placed!.peer.id });
    expect(await prisma.chatMessage.count({ where: { apId: message.id } })).toBe(1);

    const chats = await request(app).get("/api/chats").set(auth(local));
    const chat = chats.body.chats.find((item: { id: string }) => item.id === placed!.chatId);
    expect(chat.other).toMatchObject({
      display_name: "Newbie",
      remote: { handle: "newbie@203.0.113.90", instance: { name: "Makerspace", origin: PARTNER }, profile_id: null },
    });
    const messages = await request(app).get(`/api/chats/${placed!.chatId}/messages`).set(auth(local));
    expect(messages.body.messages).toEqual([
      expect.objectContaining({
        body: "Hi there",
        sender: expect.objectContaining({
          display_name: "Newbie",
          remote: expect.objectContaining({ handle: "newbie@203.0.113.90" }),
        }),
        // Not in the index yet: named, not opened.
        attachments: [expect.objectContaining({ name: "Bin", model: null })],
      }),
    ]);
    await until(async () =>
      prisma.notification.findFirst({
        where: { userId: local.id, type: "chat", internalPath: `/chats/${placed!.chatId}` },
      }),
    );
    // Known from a chat only: not on Explore.
    const explore = await request(app).get("/api/explore").set(auth(local));
    expect(explore.body.elsewhere.people.map((item: { display_name: string }) => item.display_name)).not.toContain(
      "Newbie",
    );
  });

  it("has a partner try again what can't be taken yet, rather than lose it", async () => {
    // Chats off here for now: kept there and sent again.
    await setSocialSettings({ enabled: true, chats: false });
    try {
      await expect(placeNote(actorOf(PARTNER), note({ to: [localActor()] }), false)).rejects.toBeInstanceOf(RetryLater);
    } finally {
      await setSocialSettings({ enabled: true, chats: true });
    }
    // A message of a room of theirs before the room itself.
    const room = `${PARTNER}/api/ap/rooms/not-yet-${Date.now()}`;
    await expect(placeNote(actorOf(PARTNER), note({ to: [room], context: room }), true)).rejects.toBeInstanceOf(
      RetryLater,
    );
  });

  it("believes a partner only of its own people", async () => {
    const to = [localActor()];
    // Someone on another partner, sent by this one.
    expect(await placeNote(actorOf(PARTNER), note({ to, attributedTo: person(OTHER, "Tomas") }), false)).toBeNull();
    // Passed on by someone, for direct messages.
    expect(await placeNote(actorOf(PARTNER), note({ to }), true)).toBeNull();
    // To nobody here, or to two people at once.
    expect(await placeNote(actorOf(PARTNER), note({ to: [`${ORIGIN}/api/ap/actors/instance`] }), false)).toBeNull();
    expect(
      await placeNote(actorOf(PARTNER), note({ to: [localActor(), `${ORIGIN}/api/ap/actors/${admin.id}`] }), false),
    ).toBeNull();
    // Not a partner now.
    await prisma.peer.update({ where: { id: partnerId }, data: { status: "PAUSED" } });
    try {
      expect(await placeNote(actorOf(PARTNER), note({ to }), false)).toBeNull();
    } finally {
      await prisma.peer.update({ where: { id: partnerId }, data: { status: "ACTIVE" } });
    }
  });

  it("writes back to their instance, with only models shared on Explore", async () => {
    const opened = await request(app).post("/api/chats/direct").set(auth(local)).send({ remote_person_id: rutaId });
    expect(opened.status).toBe(200);
    expect(opened.body.other.remote.profile_id).toBe(rutaId);
    const sent = await request(app)
      .post(`/api/chats/${opened.body.id}/messages`)
      .set(auth(local))
      .send({ body: "Hello Rūta" });
    expect(sent.status).toBe(200);
    const create = await until(async () =>
      (await deliveries(PARTNER)).find((item) => item.type === "Create" && item.object.content === "<p>Hello Rūta</p>"),
    );
    expect(create).toMatchObject({
      actor: `${ORIGIN}/api/ap/actors/instance`,
      to: [person(PARTNER, "Ruta").id],
      object: { type: "Note", attributedTo: expect.objectContaining({ id: localActor(), name: "Linas" }) },
    });
    // A model that isn't shared couldn't be opened there.
    const upload = await request(app)
      .post("/api/upload")
      .set(auth(local))
      .attach("files", tmpFile("private.stl", "solid p endsolid"));
    const unshared = await request(app)
      .post(`/api/chats/${opened.body.id}/messages`)
      .set(auth(local))
      .send({ body: "", print_ids: [upload.body.prints[0].id] });
    expect(unshared.status).toBe(400);
    expect(unshared.body.code).toBe("not_shared_model");
    // Their instance paused: nothing's written that would be read here only.
    await prisma.peer.update({ where: { id: partnerId }, data: { status: "PAUSED" } });
    try {
      const paused = await request(app)
        .post(`/api/chats/${opened.body.id}/messages`)
        .set(auth(local))
        .send({ body: "?" });
      expect(paused.status).toBe(409);
      expect(paused.body.code).toBe("partner_unavailable");
    } finally {
      await prisma.peer.update({ where: { id: partnerId }, data: { status: "ACTIVE" } });
    }
    // Connected instances off: nothing's written that would never reach them.
    await updateFederationSettings({ enabled: false });
    try {
      const off = await request(app).post(`/api/chats/${opened.body.id}/messages`).set(auth(local)).send({ body: "?" });
      expect(off.status).toBe(409);
      expect(off.body.code).toBe("federation_off");
    } finally {
      await updateFederationSettings({ enabled: true });
    }
  });

  it("lists partners' people to write to, after this instance's", async () => {
    const res = await request(app).get("/api/chats/people?q=tom").set(auth(local));
    expect(res.body.people).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: tomasId, remote: expect.objectContaining({ handle: "tomas@203.0.113.91" }) }),
      ]),
    );
  });
});

describe("rooms with partners' people", () => {
  it("hosts a room with them: their instances told who's in it, and passed what the others say", async () => {
    const created = await request(app)
      .post("/api/chats/rooms")
      .set(auth(admin))
      .send({ name: "Print farm", is_public: false, member_ids: [local.id], remote_member_ids: [rutaId, tomasId] });
    expect(created.status).toBe(200);
    const roomId = created.body.id;
    expect(created.body).toMatchObject({ member_count: 4, instances: 3, hosted_by: null });
    const room = `${ORIGIN}/api/ap/rooms/${roomId}`;
    const told = await until(async () =>
      (await deliveries(OTHER)).find((item) => item.type === "Update" && item.object.id === room),
    );
    expect((told.object.attachment as { id: string }[]).map((member) => member.id)).toEqual(
      expect.arrayContaining([localActor(), person(PARTNER, "Ruta").id, person(OTHER, "Tomas").id]),
    );
    const detail = await request(app).get(`/api/chats/${roomId}`).set(auth(local));
    expect(detail.body.members.filter((member: { remote: unknown }) => member.remote)).toHaveLength(2);

    // Rūta writes from her instance: kept, and passed on to the other partner, not back to hers.
    const said = note({ to: [room], context: room, text: "Baseplates tonight" });
    const placed = await placeNote(actorOf(PARTNER), said, false);
    expect(placed).toMatchObject({ chatId: roomId, hostedHere: true });
    await messageArrived({ ...placed!, peerId: placed!.peer.id });
    await until(async () =>
      (await deliveries(OTHER)).find((item) => item.type === "Announce" && item.object.id === said.id),
    );
    expect((await deliveries(PARTNER)).some((item) => item.type === "Announce" && item.object.id === said.id)).toBe(
      false,
    );
    // Someone there who isn't in it.
    expect(
      await placeNote(
        actorOf(PARTNER),
        note({ to: [room], context: room, attributedTo: person(PARTNER, "Stranger") }),
        false,
      ),
    ).toBeNull();

    // A partner paused meanwhile: what's said waits for it, in order, rather than being skipped.
    await prisma.peer.update({ where: { id: otherId }, data: { status: "PAUSED" } });
    try {
      const posted = await request(app)
        .post(`/api/chats/${roomId}/messages`)
        .set(auth(admin))
        .send({ body: "While away" });
      expect(posted.status).toBe(200);
      expect(
        (await deliveries(OTHER)).some((item) => item.type === "Create" && item.object.content === "<p>While away</p>"),
      ).toBe(true);
    } finally {
      await prisma.peer.update({ where: { id: otherId }, data: { status: "ACTIVE" } });
    }

    // Rūta leaves: the others are told.
    const before = (await deliveries(OTHER)).length;
    expect(await leavingFrom(actorOf(PARTNER), person(PARTNER, "Ruta").id, room)).toBe(roomId);
    await roomChanged(roomId);
    const after = await deliveries(OTHER);
    expect(after.length).toBeGreaterThan(before);
    expect(((after.at(-1)!.object.attachment as { id: string }[]) ?? []).map((member) => member.id)).not.toContain(
      person(PARTNER, "Ruta").id,
    );
  });

  it("keeps a copy of a partner's room, with this instance's people it names", async () => {
    const group = {
      id: `${PARTNER}/api/ap/rooms/r${Date.now()}`,
      name: "Makerspace crew",
      summary: "Tool wall",
      updated: new Date(Date.now() - 60_000),
      members: [
        { id: localActor(), name: "Linas", preferredUsername: null, icon: null },
        person(PARTNER, "Ruta"),
        person("http://198.51.100.40", "Faraway"),
      ],
    };
    const copy = await roomFrom(actorOf(PARTNER), group);
    expect(copy?.chatId).toBeTruthy();
    const detail = await request(app).get(`/api/chats/${copy!.chatId}`).set(auth(local));
    expect(detail.body).toMatchObject({
      name: "Makerspace crew",
      hosted_by: { name: "Makerspace", origin: PARTNER },
      can_manage: false,
      joined: true,
    });
    expect(detail.body.members.map((member: { display_name: string }) => member.display_name)).toEqual(
      expect.arrayContaining(["Ruta", "Faraway"]),
    );
    // Someone else's room: not this instance's to edit.
    expect(
      (await request(app).patch(`/api/chats/rooms/${copy!.chatId}`).set(auth(admin)).send({ name: "x" })).status,
    ).toBe(404);

    // An older update, tried again late, changes nothing.
    expect(
      await roomFrom(actorOf(PARTNER), { ...group, name: "Old name", updated: new Date(Date.now() - 120_000) }),
    ).toBeNull();
    expect((await prisma.chat.findUniqueOrThrow({ where: { id: copy!.chatId } })).name).toBe("Makerspace crew");

    // Its host passes on what anyone in it says.
    const relayed = note({
      id: `http://198.51.100.40/api/ap/messages/far-${Date.now()}`,
      to: [group.id],
      context: group.id,
      attributedTo: person("http://198.51.100.40", "Faraway"),
    });
    const placed = await placeNote(actorOf(PARTNER), relayed, true);
    expect(placed).toMatchObject({ chatId: copy!.chatId, hostedHere: false });
    // Not from another instance than its host.
    expect(await placeNote(actorOf(OTHER), { ...relayed, id: `${relayed.id}-2` }, true)).toBeNull();

    // Writing in it goes to its host.
    const sent = await request(app)
      .post(`/api/chats/${copy!.chatId}/messages`)
      .set(auth(local))
      .send({ body: "On my way" });
    expect(sent.status).toBe(200);
    await until(async () =>
      (await deliveries(PARTNER)).find((item) => item.type === "Create" && item.object.context === group.id),
    );

    // Taken out of it: the copy goes.
    expect(
      await roomFrom(actorOf(PARTNER), { ...group, updated: new Date(), members: [person(PARTNER, "Ruta")] }),
    ).toMatchObject({
      removed: [local.id],
    });
    expect(await prisma.chat.count({ where: { remoteApId: group.id } })).toBe(0);
  });

  it("deletes a message only for the partner it was its to delete", async () => {
    const message = note({ to: [localActor()] });
    const placed = await placeNote(actorOf(PARTNER), message, false);
    await messageArrived({ ...placed!, peerId: placed!.peer.id });
    expect(await deletionFrom(actorOf(OTHER), message.id)).toBeNull();
    const gone = await deletionFrom(actorOf(PARTNER), message.id);
    expect(gone).toMatchObject({ kind: "message", chatId: placed!.chatId });
    if (gone?.kind === "message") {
      await messageDeletedThere(gone.chatId, gone.messageId, { hostedHere: gone.hostedHere, peerId: gone.peer.id });
    }
    expect((await prisma.chatMessage.findUniqueOrThrow({ where: { apId: message.id } })).deletedAt).not.toBeNull();

    // Deleted before it came (it was tried again later): when it comes, it's not kept.
    const late = note({ to: [localActor()] });
    expect(await deletionFrom(actorOf(PARTNER), late.id)).toBeNull();
    expect(await placeNote(actorOf(PARTNER), late, false)).toBeNull();
    expect(await prisma.chatMessage.count({ where: { apId: late.id } })).toBe(0);
  });
});

function tmpFile(name: string, contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-fc-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return file;
}
