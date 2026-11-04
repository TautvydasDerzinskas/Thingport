import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { setSocialSettings } from "../src/services/settingsService";

const app = createApp();

type Account = { token: string; id: string; email: string; name: string };

// Names are searched for and quoted in notifications, so each run's are its own.
const RUN = Date.now().toString(36);

async function register(first: string): Promise<Account> {
  const name = `${first} ${RUN}`;
  const email = `chats-${first.toLowerCase()}-${Date.now()}@example.com`;
  const res = await request(app).post("/api/register").send({ displayName: name, email, password: "password123" });
  if (res.status !== 200) throw new Error(`Couldn't register ${name}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token, id: res.body.user.id, email, name };
}

const auth = (account: Account) => ({ Authorization: `Bearer ${account.token}` });

/** Notifications are written after the message's request has answered. */
async function chatNotifications(account: Account, chatId: string, expected: number) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const rows = await prisma.notification.findMany({
      where: { userId: account.id, type: "chat", group: { path: ["chatId"], equals: chatId } },
    });
    if (rows.length >= expected) return rows;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return prisma.notification.findMany({
    where: { userId: account.id, type: "chat", group: { path: ["chatId"], equals: chatId } },
  });
}

/** Lets a message's notifications be written, for a test that checks none were. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

const send = (account: Account, chatId: string, body: string) =>
  request(app).post(`/api/chats/${chatId}/messages`).set(auth(account)).send({ body });

let ana: Account;
let ben: Account;
let cleo: Account;
let admin: Account;

beforeAll(async () => {
  ana = await register("Anastasia");
  ben = await register("Benediktas");
  cleo = await register("Cleopatra");
  admin = await register("Admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  await setSocialSettings({ enabled: false, chats: false });
});

afterAll(async () => {
  await setSocialSettings({ enabled: false, chats: false });
});

describe("chats switched off", () => {
  it("answer nothing, with social features off or on", async () => {
    const off = await request(app).get("/api/chats").set(auth(ana));
    expect([off.status, off.body.code]).toEqual([404, "chats_off"]);
    await setSocialSettings({ enabled: true });
    expect((await request(app).get("/api/chats").set(auth(ana))).status).toBe(404);
    expect((await request(app).get("/api/social").set(auth(ana))).body.chats).toBe(false);
  });

  it("are an admin's to switch on, and stay off without social features", async () => {
    const refused = await request(app).patch("/api/social/settings").set(auth(ana)).send({ chats: true });
    expect(refused.status).toBe(403);
    const switched = await request(app).patch("/api/social/settings").set(auth(admin)).send({ chats: true });
    expect(switched.body).toEqual({ enabled: true, chats: true });
    expect((await request(app).get("/api/social").set(auth(ana))).body.chats).toBe(true);

    await setSocialSettings({ enabled: false });
    expect((await request(app).get("/api/chats").set(auth(ana))).status).toBe(404);
    expect((await request(app).get("/api/social").set(auth(ana))).body.chats).toBe(false);
    await setSocialSettings({ enabled: true });
  });
});

describe("finding people", () => {
  beforeAll(() => setSocialSettings({ enabled: true, chats: true }));

  it("by part of a name, or by a whole email, never showing one", async () => {
    const byName = await request(app)
      .get("/api/chats/people")
      .query({ q: `nediktas ${RUN}` })
      .set(auth(ana));
    expect(byName.body.people.map((p: { id: string }) => p.id)).toEqual([ben.id]);
    expect(JSON.stringify(byName.body)).not.toContain("@example.com");

    const byEmail = await request(app).get("/api/chats/people").query({ q: ben.email.toUpperCase() }).set(auth(ana));
    expect(byEmail.body.people.map((p: { id: string }) => p.id)).toEqual([ben.id]);

    const partEmail = await request(app)
      .get("/api/chats/people")
      .query({ q: ben.email.slice(0, 12) })
      .set(auth(ana));
    expect(partEmail.body.people).toEqual([]);
  });

  it("leaves the viewer out", async () => {
    const res = await request(app).get("/api/chats/people").query({ q: ana.name }).set(auth(ana));
    expect(res.body.people).toEqual([]);
  });
});

describe("direct messages", () => {
  let chatId: string;
  beforeAll(() => setSocialSettings({ enabled: true, chats: true }));

  it("are one chat per pair, whoever starts it", async () => {
    const started = await request(app).post("/api/chats/direct").set(auth(ana)).send({ user_id: ben.id });
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ kind: "direct", joined: true, unread: 0, other: { id: ben.id } });
    chatId = started.body.id;
    const again = await request(app).post("/api/chats/direct").set(auth(ben)).send({ user_id: ana.id });
    expect(again.body.id).toBe(chatId);
    expect((await request(app).post("/api/chats/direct").set(auth(ana)).send({ user_id: ana.id })).status).toBe(400);
  });

  it("show the other person only once something is said", async () => {
    const before = await request(app).get("/api/chats").set(auth(ben));
    expect(before.body.chats.map((c: { id: string }) => c.id)).not.toContain(chatId);
    const own = await request(app).get("/api/chats").set(auth(ana));
    expect(own.body.chats.map((c: { id: string }) => c.id)).toContain(chatId);
  });

  it("count unread, notify once per chat, and are read by opening them", async () => {
    expect((await send(ana, chatId, "  Hi Ben  ")).body).toMatchObject({ body: "Hi Ben", sender: { id: ana.id } });
    await send(ana, chatId, "Got a minute?");

    const list = await request(app).get("/api/chats").set(auth(ben));
    const chat = list.body.chats.find((c: { id: string }) => c.id === chatId);
    expect(chat).toMatchObject({ unread: 2, last_message: { body: "Got a minute?" }, other: { id: ana.id } });

    const summary = await request(app).get("/api/chats/unread").set(auth(ben));
    expect(summary.body).toMatchObject({ unread: 2, latest: { chat_id: chatId, body: "Got a minute?" } });

    const notifications = await chatNotifications(ben, chatId, 1);
    await settle();
    const folded = await prisma.notification.findMany({ where: { userId: ben.id, type: "chat" } });
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ title: `2 new messages from ${ana.name}`, internalPath: `/chats/${chatId}` });
    expect(notifications[0].readAt).toBeNull();

    const page = await request(app).get(`/api/chats/${chatId}/messages`).query({ seen: "1" }).set(auth(ben));
    expect(page.body.messages.map((m: { body: string }) => m.body)).toEqual(["Hi Ben", "Got a minute?"]);
    expect((await request(app).get("/api/chats/unread").set(auth(ben))).body).toEqual({ unread: 0, latest: null });
    const read = await prisma.notification.findFirstOrThrow({ where: { id: folded[0].id } });
    expect(read.readAt).not.toBeNull();
  });

  it("don't notify someone reading the chat", async () => {
    await request(app).get(`/api/chats/${chatId}/messages`).query({ seen: "1" }).set(auth(ana));
    await prisma.notification.deleteMany({ where: { userId: ana.id, type: "chat" } });
    await send(ben, chatId, "Sure");
    await settle();
    expect(await prisma.notification.count({ where: { userId: ana.id, type: "chat" } })).toBe(0);
  });

  it("tell a poll what's new and what was deleted", async () => {
    const latest = await request(app).get(`/api/chats/${chatId}/messages`).set(auth(ana));
    const last = latest.body.messages.at(-1);
    const since = latest.body.now;
    const sent = await send(ana, chatId, "Oops, wrong chat");

    expect((await request(app).delete(`/api/chats/${chatId}/messages/${sent.body.id}`).set(auth(ben))).status).toBe(
      403,
    );
    expect((await request(app).delete(`/api/chats/${chatId}/messages/${sent.body.id}`).set(auth(ana))).status).toBe(
      200,
    );

    const poll = await request(app)
      .get(`/api/chats/${chatId}/messages`)
      .query({ after: last.id, since })
      .set(auth(ben));
    const polled = poll.body.messages.find((m: { id: string }) => m.id === sent.body.id);
    expect(polled).toMatchObject({ deleted: true, body: "" });
    expect(poll.body.deleted_ids).toContain(sent.body.id);
  });

  it("can be muted and favourited, by a member only", async () => {
    const muted = await request(app)
      .patch(`/api/chats/${chatId}/membership`)
      .set(auth(ben))
      .send({ muted: true, favorite: true });
    expect(muted.body).toMatchObject({ muted: true, favorite: true });
    await prisma.notification.deleteMany({ where: { userId: ben.id, type: "chat" } });
    await send(ana, chatId, "Still there?");
    await settle();
    expect(await prisma.notification.count({ where: { userId: ben.id, type: "chat" } })).toBe(0);
    expect((await request(app).get("/api/chats/unread").set(auth(ben))).body.unread).toBe(0);

    const outsider = await request(app).patch(`/api/chats/${chatId}/membership`).set(auth(cleo)).send({ muted: true });
    expect(outsider.status).toBe(404);
    expect((await request(app).get(`/api/chats/${chatId}/messages`).set(auth(cleo))).status).toBe(404);
  });

  it("can't be written to once the other person's account is gone", async () => {
    const gone = await register("Gone");
    const started = await request(app).post("/api/chats/direct").set(auth(ana)).send({ user_id: gone.id });
    await prisma.user.delete({ where: { id: gone.id } });
    const res = await send(ana, started.body.id, "Hello?");
    expect([res.status, res.body.code]).toEqual([409, "recipient_gone"]);
  });
});

describe("rooms", () => {
  beforeAll(() => setSocialSettings({ enabled: true, chats: true }));

  it("are made by admins only", async () => {
    const refused = await request(app).post("/api/chats/rooms").set(auth(ana)).send({ name: "Mine", is_public: true });
    expect(refused.status).toBe(403);
  });

  it("private: only its members see it, an admin manages it", async () => {
    const made = await request(app)
      .post("/api/chats/rooms")
      .set(auth(admin))
      .send({ name: "  Print farm  ", is_public: false, member_ids: [ana.id] });
    expect(made.body).toMatchObject({ kind: "room", name: "Print farm", is_public: false, member_count: 2 });
    const roomId = made.body.id;

    expect((await request(app).get(`/api/chats/${roomId}`).set(auth(ben))).status).toBe(404);
    const bensList = await request(app).get("/api/chats").set(auth(ben));
    expect(bensList.body.chats.map((c: { id: string }) => c.id)).not.toContain(roomId);
    expect((await send(ana, roomId, "Printer 2 is jammed")).status).toBe(200);

    // Ben in, Ana out: she loses it, and what told her about it.
    await request(app)
      .patch(`/api/chats/rooms/${roomId}`)
      .set(auth(admin))
      .send({ member_ids: [admin.id, ana.id] });
    await send(admin, roomId, "Noted");
    await chatNotifications(ana, roomId, 1);
    const changed = await request(app)
      .patch(`/api/chats/rooms/${roomId}`)
      .set(auth(admin))
      .send({ member_ids: [admin.id, ben.id] });
    expect(changed.body.member_count).toBe(2);
    expect((await request(app).get(`/api/chats/${roomId}`).set(auth(ana))).status).toBe(404);
    expect(
      await prisma.notification.count({
        where: { userId: ana.id, type: "chat", group: { path: ["chatId"], equals: roomId } },
      }),
    ).toBe(0);
    const detail = await request(app).get(`/api/chats/${roomId}`).set(auth(ben));
    expect(detail.body.members.map((m: { id: string }) => m.id).toSorted()).toEqual([admin.id, ben.id].toSorted());

    const deleted = await request(app).delete(`/api/chats/rooms/${roomId}`).set(auth(admin));
    expect(deleted.status).toBe(200);
    expect((await request(app).get(`/api/chats/${roomId}`).set(auth(ben))).status).toBe(404);
  });

  it("public: anyone reads it, and writes once they've joined", async () => {
    const made = await request(app)
      .post("/api/chats/rooms")
      .set(auth(admin))
      .send({ name: "General", is_public: true });
    const roomId = made.body.id;
    await send(admin, roomId, "Welcome");

    const seen = (await request(app).get("/api/chats").set(auth(cleo))).body.chats.find(
      (c: { id: string }) => c.id === roomId,
    );
    expect(seen).toMatchObject({ joined: false, readable: true, unread: 0 });
    const read = await request(app).get(`/api/chats/${roomId}/messages`).set(auth(cleo));
    expect(read.body.messages.map((m: { body: string }) => m.body)).toEqual(["Welcome"]);
    expect((await send(cleo, roomId, "Hi")).status).toBe(403);

    const joined = await request(app).post(`/api/chats/${roomId}/join`).set(auth(cleo));
    expect(joined.body).toMatchObject({ joined: true, unread: 0 });
    expect((await send(cleo, roomId, "Hi")).status).toBe(200);
    const [notification] = await chatNotifications(admin, roomId, 1);
    expect(notification).toMatchObject({ title: "New message in General", body: `${cleo.name}: Hi` });

    // An admin takes anyone's message out of a room.
    const own = await send(cleo, roomId, "spam");
    expect((await request(app).delete(`/api/chats/${roomId}/messages/${own.body.id}`).set(auth(admin))).status).toBe(
      200,
    );

    expect((await request(app).post(`/api/chats/${roomId}/leave`).set(auth(cleo))).status).toBe(200);
    expect((await send(cleo, roomId, "Back")).status).toBe(403);
    await request(app).delete(`/api/chats/rooms/${roomId}`).set(auth(admin));
  });
});

describe("an API token", () => {
  beforeAll(() => setSocialSettings({ enabled: true, chats: true }));

  it("reads chats only once its user ticks them, and never counts as them looking", async () => {
    const { body } = await request(app).post("/api/profile/api-token").set(auth(ana));
    const token = { Authorization: `Bearer ${body.token}` };
    const refused = await request(app).get("/api/chats").set(token);
    expect([refused.status, refused.body.scope]).toEqual([403, "chats"]);

    await request(app)
      .put("/api/profile/api-token/rest-scopes")
      .set(auth(ana))
      .send({ rest_scopes: [...body.rest_scopes, "chats"] });
    expect((await request(app).get("/api/chats").set(token)).status).toBe(200);

    await prisma.user.update({ where: { id: ana.id }, data: { lastSeenAt: null } });
    await request(app).get("/api/chats/unread").query({ seen: "1" }).set(token);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ana.id } })).lastSeenAt).toBeNull();
    await request(app).get("/api/chats/unread").query({ seen: "1" }).set(auth(ana));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ana.id } })).lastSeenAt).not.toBeNull();
  });
});
