import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { setSocialSettings } from "../src/services/settingsService";
import { blockedBy, sessionOf } from "./helpers/locks";

const app = createApp();

type Account = { token: string; id: string };

const RUN = Date.now();

async function register(name: string): Promise<Account> {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: name, email: `shared-${name.toLowerCase()}-${RUN}@example.com`, password: "password123" });
  if (res.status !== 200) throw new Error(`Couldn't register ${name}: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token, id: res.body.user.id };
}

const auth = (account: Account) => ({ Authorization: `Bearer ${account.token}` });

function tmpFile(name: string, contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-shared-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return file;
}

let alex: Account;
let bea: Account;
let carl: Account;
let collectionId: string;
let printId: string;

const sharing = (body: Record<string, unknown>, as: Account = alex) =>
  request(app).patch(`/api/collection/${collectionId}/sharing`).set(auth(as)).send(body);
/** Whether `account` may open the collection, or read its model: 200 or 404, and nothing else passes as either. */
async function allowed(url: string, account: Account): Promise<boolean> {
  const { status } = await request(app).get(url).set(auth(account));
  expect([200, 404]).toContain(status);
  return status === 200;
}
const canOpen = (account: Account) => allowed(`/api/collection/${collectionId}`, account);
const canRead = (account: Account) => allowed(`/api/print/${printId}`, account);
const sharedNotes = (account: Account) =>
  prisma.notification.count({
    where: { userId: account.id, type: "share", internalPath: `/explore/collections/${collectionId}` },
  });

beforeAll(async () => {
  alex = await register("Alex");
  bea = await register("Bea");
  carl = await register("Carl");
  await setSocialSettings({ enabled: true });
  const upload = await request(app)
    .post("/api/upload")
    .set(auth(alex))
    .attach("files", tmpFile("desk-tray.stl", "solid desk-tray endsolid"));
  printId = upload.body.prints[0].id;
  const created = await request(app)
    .post("/api/collections")
    .set(auth(alex))
    .send({ name: `Desk organisers ${RUN}` });
  collectionId = created.body.id;
  await request(app).post(`/api/collection/${collectionId}/items/${printId}`).set(auth(alex));
});

afterAll(async () => {
  await setSocialSettings({ enabled: false });
});

describe("a collection shared with picked people", () => {
  it("starts private, says so both ways, and nobody else sees it", async () => {
    const own = await request(app).get(`/api/collection/${collectionId}`).set(auth(alex));
    expect(own.body).toMatchObject({ visibility: "private", is_public: false, shared_with: null });
    expect(await canOpen(bea)).toBe(false);
    expect(await canRead(bea)).toBe(false);
  });

  it("is seen by the people it's shared with, as a public one is, and they're told", async () => {
    const res = await sharing({ visibility: "shared", add_user_ids: [bea.id, alex.id] });
    expect(res.status).toBe(200);
    // Its owner sees it anyway, so isn't on the list.
    expect(res.body).toMatchObject({ visibility: "shared", max_people: 100 });
    expect(res.body.people.map((person: { id: string }) => person.id)).toEqual([bea.id]);
    expect(res.body.people[0]).not.toHaveProperty("email");

    expect(await canOpen(bea)).toBe(true);
    expect(await canRead(bea)).toBe(true);
    expect(await sharedNotes(bea)).toBe(1);
    const theirs = await request(app).get(`/api/collection/${collectionId}`).set(auth(bea));
    // Whose it is, and not who else it's shared with: that's its owner's to know.
    expect(theirs.body).toMatchObject({ visibility: "shared", shared_with: null, owner: { id: alex.id } });

    expect(await canOpen(carl)).toBe(false);
    expect(await canRead(carl)).toBe(false);
    expect(await sharedNotes(carl)).toBe(0);
  });

  it("shows on its owner's list with who it's shared with", async () => {
    const list = await request(app).get("/api/collections").set(auth(alex));
    const mine = list.body.find((collection: { id: string }) => collection.id === collectionId);
    expect(mine).toMatchObject({ visibility: "shared", is_public: false, shared_with: { count: 1 } });
    expect(mine.shared_with.people.map((person: { id: string }) => person.id)).toEqual([bea.id]);
  });

  it("is in Shared with you on Explore for them, and on nobody's public Explore", async () => {
    const theirs = await request(app).get("/api/explore?scope=here").set(auth(bea));
    expect(theirs.body.shared_with_you.map((collection: { id: string }) => collection.id)).toContain(collectionId);
    expect(theirs.body.shared_with_you_total).toBeGreaterThanOrEqual(1);
    expect(theirs.body.shared_at.collections[collectionId]).toBeTruthy();
    expect(theirs.body.recent_collections.map((collection: { id: string }) => collection.id)).not.toContain(
      collectionId,
    );

    // Page by page, each one once: a second one shared with her, and a page of one at a time.
    const second = (
      await request(app)
        .post("/api/collections")
        .set(auth(carl))
        .send({ name: `Kitchen hooks ${RUN}` })
    ).body.id as string;
    await request(app)
      .patch(`/api/collection/${second}/sharing`)
      .set(auth(carl))
      .send({ visibility: "shared", add_user_ids: [bea.id] });
    const pages = await Promise.all(
      [0, 1].map((offset) => request(app).get(`/api/explore/shared?limit=1&offset=${offset}`).set(auth(bea))),
    );
    for (const page of pages) {
      expect(page.status).toBe(200);
      expect(page.body).toHaveLength(1);
      expect(page.headers["x-total-count"]).toBe("2");
      // With when, to order partners' people's beside it.
      expect(Date.parse(page.body[0].shared_at)).toBeGreaterThan(0);
    }
    expect(pages.map((page) => page.body[0].id).toSorted()).toEqual([collectionId, second].toSorted());
    await request(app).delete(`/api/collection/${second}`).set(auth(carl));

    const others = await request(app).get("/api/explore?scope=here").set(auth(carl));
    expect(others.body.shared_with_you.map((collection: { id: string }) => collection.id)).not.toContain(collectionId);
    expect(others.body.recent_collections.map((collection: { id: string }) => collection.id)).not.toContain(
      collectionId,
    );
  });

  it("keeps its list while private, and shares with the same people again", async () => {
    await sharing({ visibility: "private" });
    expect(await canOpen(bea)).toBe(false);
    const kept = await request(app).get(`/api/collection/${collectionId}/sharing`).set(auth(alex));
    expect(kept.body.visibility).toBe("private");
    expect(kept.body.people.map((person: { id: string }) => person.id)).toEqual([bea.id]);

    await sharing({ visibility: "shared" });
    expect(await canOpen(bea)).toBe(true);
    // Seeing it again is news again.
    expect(await sharedNotes(bea)).toBe(2);
  });

  it("is everyone's once public, and its list waits", async () => {
    await sharing({ visibility: "public" });
    expect(await canOpen(carl)).toBe(true);
    const own = await request(app).get(`/api/collection/${collectionId}`).set(auth(alex));
    expect(own.body).toMatchObject({ visibility: "public", is_public: true, shared_with: null });
    await sharing({ visibility: "shared" });
    expect(await canOpen(carl)).toBe(false);
    // Bea could see it all along: nothing new for her.
    expect(await sharedNotes(bea)).toBe(2);
  });

  it("stays shared when an older client saves the form with is_public false", async () => {
    const saved = await request(app)
      .patch(`/api/collection/${collectionId}`)
      .set(auth(alex))
      .send({ name: `Desk organisers ${RUN}`, is_public: false });
    expect(saved.body).toMatchObject({ visibility: "shared", is_public: false, shared_with: { count: 1 } });
    expect(await canOpen(bea)).toBe(true);
  });

  it("is gone for someone taken off the list, and the others stay", async () => {
    await sharing({ add_user_ids: [carl.id] });
    expect(await canOpen(carl)).toBe(true);
    const res = await sharing({ remove_user_ids: [bea.id] });
    expect(res.body.people.map((person: { id: string }) => person.id)).toEqual([carl.id]);
    expect(await canOpen(bea)).toBe(false);
    expect(await canRead(bea)).toBe(false);
    expect(await canOpen(carl)).toBe(true);
  });

  it("is its owner's alone to read and change", async () => {
    expect((await request(app).get(`/api/collection/${collectionId}/sharing`).set(auth(carl))).status).toBe(404);
    expect((await sharing({ add_user_ids: [bea.id] }, carl)).status).toBe(404);
    expect((await sharing({ add_user_ids: ["no-such-user"] })).body.code).toBe("unknown_person");
    expect((await sharing({ visibility: "everyone" })).status).toBe(400);
  });

  it("is nobody's but its owner's while social features are off", async () => {
    await setSocialSettings({ enabled: false });
    try {
      // Made private and shared again while they're off: nobody on its list is told of what they can't open.
      const told = await sharedNotes(carl);
      const save = (visibility: string) =>
        request(app)
          .patch(`/api/collection/${collectionId}`)
          .set(auth(alex))
          .send({ name: `Desk organisers ${RUN}`, visibility });
      expect((await save("private")).body.visibility).toBe("private");
      expect((await save("shared")).body.visibility).toBe("shared");
      expect(await sharedNotes(carl)).toBe(told);
      expect(await canOpen(carl)).toBe(false);
      expect(await canRead(carl)).toBe(false);
      const refused = await sharing({ add_user_ids: [bea.id] });
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe("social_off");
    } finally {
      await setSocialSettings({ enabled: true });
    }
    expect(await canOpen(carl)).toBe(true);
  });

  it("says who it's shared with when another collection is merged into it", async () => {
    const extra = (
      await request(app)
        .post("/api/collections")
        .set(auth(alex))
        .send({ name: `Spare trays ${RUN}` })
    ).body.id as string;
    const merged = await request(app)
      .post("/api/collections/merge")
      .set(auth(alex))
      .send({ primary_id: collectionId, ids: [extra] });
    expect(merged.status).toBe(200);
    expect(merged.body.collection).toMatchObject({ visibility: "shared", shared_with: { count: 1 } });
  });

  it("is shared with 100 people at most, and a change past that changes nothing", async () => {
    const crowd = Array.from({ length: 101 }, (_, n) => ({
      email: `shared-crowd-${n}-${RUN}@example.com`,
      displayName: `Crowd ${n}`,
    }));
    await prisma.user.createMany({ data: crowd });
    const ids = (
      await prisma.user.findMany({ where: { email: { in: crowd.map((user) => user.email) } }, select: { id: true } })
    ).map((user) => user.id);
    const big = (
      await request(app)
        .post("/api/collections")
        .set(auth(alex))
        .send({ name: `Big ${RUN}` })
    ).body.id as string;
    const share = (body: Record<string, unknown>) =>
      request(app).patch(`/api/collection/${big}/sharing`).set(auth(alex)).send(body);
    try {
      expect((await share({ add_user_ids: ids.slice(0, 100) })).body.people).toHaveLength(100);
      const refused = await share({ visibility: "shared", add_user_ids: ids.slice(100) });
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe("too_many_people");
      // Nothing of it was kept: not the person past the limit, and not the visibility asked with them.
      const kept = await request(app).get(`/api/collection/${big}/sharing`).set(auth(alex));
      expect(kept.body).toMatchObject({ visibility: "private" });
      expect(kept.body.people).toHaveLength(100);
    } finally {
      await request(app).delete(`/api/collection/${big}`).set(auth(alex));
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  });

  it("lets in only one of two people added at once to a list of 99", async () => {
    const crowd = Array.from({ length: 101 }, (_, n) => ({
      email: `shared-race-${n}-${RUN}@example.com`,
      displayName: `Race ${n}`,
    }));
    await prisma.user.createMany({ data: crowd });
    const ids = (
      await prisma.user.findMany({ where: { email: { in: crowd.map((user) => user.email) } }, select: { id: true } })
    ).map((user) => user.id);
    const full = (
      await request(app)
        .post("/api/collections")
        .set(auth(alex))
        .send({ name: `Nearly full ${RUN}` })
    ).body.id as string;
    const share = (body: Record<string, unknown>) =>
      request(app)
        .patch(`/api/collection/${full}/sharing`)
        .set(auth(alex))
        .send(body)
        .then((res) => res);
    // Both asked while its row is held, so each waits on it and they come in one after the other, whatever the pace.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let holding!: () => void;
    const holds = new Promise<void>((resolve) => (holding = resolve));
    let holder = 0;
    try {
      expect((await share({ add_user_ids: ids.slice(0, 99) })).body.people).toHaveLength(99);
      const held = prisma
        .$transaction(
          async (tx) => {
            holder = await sessionOf(tx);
            await tx.$queryRaw`SELECT id FROM "Collection" WHERE id = ${full} FOR UPDATE`;
            holding();
            await released;
          },
          { timeout: 20_000 },
        )
        .catch(() => {});
      await holds;
      const both = [share({ add_user_ids: [ids[99]] }), share({ add_user_ids: [ids[100]] })];
      try {
        await blockedBy(holder, 2);
      } finally {
        release();
        await held;
      }
      const statuses = (await Promise.all(both)).map((res) => res.status).toSorted();
      expect(statuses).toEqual([200, 422]);
      const kept = await request(app).get(`/api/collection/${full}/sharing`).set(auth(alex));
      expect(kept.body.people).toHaveLength(100);
    } finally {
      release();
      await request(app).delete(`/api/collection/${full}`).set(auth(alex));
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  });

  it("is made shared all the same when someone on its list is deleted as it's saved", async () => {
    const dana = await register("Dana");
    const listed = (
      await request(app)
        .post("/api/collections")
        .set(auth(alex))
        .send({ name: `Listed ${RUN}` })
    ).body.id as string;
    const patch = (body: Record<string, unknown>) =>
      request(app).patch(`/api/collection/${listed}/sharing`).set(auth(alex)).send(body);
    // On its list while it's private, so making it shared tells them.
    expect((await patch({ add_user_ids: [dana.id, carl.id] })).status).toBe(200);
    // Dana's account being deleted as it's made shared.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let changed!: () => void;
    const changing = new Promise<void>((resolve) => (changed = resolve));
    let holder = 0;
    const deleting = prisma
      .$transaction(
        async (tx) => {
          holder = await sessionOf(tx);
          await tx.user.delete({ where: { id: dana.id } });
          changed();
          await released;
        },
        { timeout: 20_000 },
      )
      .then(
        () => null,
        (err: Error) => err,
      );
    try {
      await changing;
      const saving = patch({ visibility: "shared" }).then((res) => res);
      try {
        await blockedBy(holder);
      } finally {
        release();
        await deleting;
      }
      const res = await saving;
      // Gone for good, not rolled back after the save waited on it.
      expect(await deleting).toBeNull();
      expect(await prisma.user.count({ where: { id: dana.id } })).toBe(0);
      expect(res.status).toBe(200);
      expect(res.body.visibility).toBe("shared");
      expect(
        await prisma.notification.count({
          where: { userId: carl.id, type: "share", internalPath: `/explore/collections/${listed}` },
        }),
      ).toBe(1);
    } finally {
      release();
      await request(app).delete(`/api/collection/${listed}`).set(auth(alex));
    }
  });

  it("is refused, with nobody told, when social features are turned off as it's shared", async () => {
    const quiet = (
      await request(app)
        .post("/api/collections")
        .set(auth(alex))
        .send({ name: `Quiet ${RUN}` })
    ).body.id as string;
    const told = () => prisma.notification.count({ where: { userId: carl.id, type: "share" } });
    const before = await told();
    // An admin turning them off, under way as it's shared: their row's held until that's done.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let changed!: () => void;
    const changing = new Promise<void>((resolve) => (changed = resolve));
    let holder = 0;
    const turningOff = prisma
      .$transaction(
        async (tx) => {
          holder = await sessionOf(tx);
          await tx.$executeRaw`UPDATE "Setting" SET value = value || '{"enabled": false}'::jsonb WHERE key = 'social'`;
          changed();
          await released;
        },
        { timeout: 20_000 },
      )
      .catch(() => {});
    try {
      await changing;
      const shared = request(app)
        .patch(`/api/collection/${quiet}/sharing`)
        .set(auth(alex))
        .send({ visibility: "shared", add_user_ids: [carl.id] })
        .then((res) => res);
      try {
        await blockedBy(holder);
      } finally {
        release();
        await turningOff;
      }
      const res = await shared;
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("social_off");
      expect(await prisma.collectionShare.count({ where: { collectionId: quiet } })).toBe(0);
      expect(await told()).toBe(before);
    } finally {
      release();
      await setSocialSettings({ enabled: true });
      await request(app).delete(`/api/collection/${quiet}`).set(auth(alex));
    }
  });

  it("can't be shared when it's a tool's, by any route", async () => {
    const tool = await prisma.tool.create({
      data: {
        source: "own",
        scope: alex.id,
        slug: `shared-${RUN}`,
        userId: alex.id,
        manifest: {},
        script: "",
        sha: "x",
      },
    });
    const name = `Tool parts ${RUN}`;
    const toolCollection = await prisma.collection.create({
      data: { userId: alex.id, name, nameNormalized: name.toLowerCase(), toolId: tool.id },
    });
    try {
      // The trailing slash gets past the tool lock in front of the route: the route itself refuses.
      const patched = await request(app)
        .patch(`/api/collection/${toolCollection.id}/`)
        .set(auth(alex))
        .send({ name, visibility: "shared" });
      expect(patched.status).toBe(403);
      const shared = await request(app)
        .patch(`/api/collection/${toolCollection.id}/sharing`)
        .set(auth(alex))
        .send({ visibility: "shared" });
      expect(shared.body.code).toBe("TOOL_OWNED");
      expect((await prisma.collection.findUniqueOrThrow({ where: { id: toolCollection.id } })).visibility).toBe(
        "PRIVATE",
      );
    } finally {
      await prisma.tool.delete({ where: { id: tool.id } });
    }
  });

  it("writes a visibility asked for over a change it waited for", async () => {
    await sharing({ visibility: "private" });
    // Another change holds the row, making it shared; a save asking for private waits for it, then writes private
    // rather than comparing with what it read before and finding nothing to change.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const other = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Collection" WHERE id = ${collectionId} FOR UPDATE`;
        await tx.collection.update({ where: { id: collectionId }, data: { visibility: "SHARED" } });
        locked();
        await held;
      },
      { timeout: 20_000 },
    );
    await lockTaken;
    const save = request(app)
      .patch(`/api/collection/${collectionId}`)
      .set(auth(alex))
      .send({ name: `Desk organisers ${RUN}`, visibility: "private" })
      .then((res) => res);
    // Released only once the save is waiting on the row, so it's the race being tested, whatever the machine's pace.
    for (let tries = 0; ; tries++) {
      const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
        SELECT COUNT(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FOR UPDATE%'`;
      if (waiting > 0) break;
      if (tries > 200) throw new Error("the save never waited on the row");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    release();
    await other;
    expect((await save).body.visibility).toBe("private");
    expect((await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })).visibility).toBe("PRIVATE");
  });

  it("finds people to share with by name, never by part of an email", async () => {
    const found = await request(app).get(`/api/social/people?q=Bea`).set(auth(alex));
    expect(found.body.people.map((person: { id: string }) => person.id)).toContain(bea.id);
    const partial = await request(app).get(`/api/social/people?q=shared-bea`).set(auth(alex));
    expect(partial.body.people.map((person: { id: string }) => person.id)).not.toContain(bea.id);
  });
});
