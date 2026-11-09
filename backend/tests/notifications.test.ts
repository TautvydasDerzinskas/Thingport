import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { pruneNotifications } from "../src/services/notificationService";

const app = createApp();
const DAY_MS = 24 * 60 * 60 * 1000;
let token: string;
let userId: string;
let otherToken: string;
let otherId: string;

async function register(name: string) {
  const email = `notifications-${name}-${Date.now()}@example.com`;
  const res = await request(app).post("/api/register").send({ displayName: name, email, password: "password123" });
  return { token: res.body.token as string, id: res.body.user.id as string };
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** `count` notifications a minute apart, newest last, titled "N 0".."N count-1". */
async function seed(count: number) {
  const start = Date.now() - count * 60_000;
  await prisma.notification.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      userId,
      type: "import",
      title: `N ${i}`,
      createdAt: new Date(start + i * 60_000),
    })),
  });
}

beforeAll(async () => {
  ({ token, id: userId } = await register("Owner"));
  ({ token: otherToken, id: otherId } = await register("Other"));
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
});

describe("notifications", () => {
  it("pages newest first with a cursor, and includes each one's type", async () => {
    await prisma.notification.deleteMany({ where: { userId } });
    await seed(5);
    const first = await request(app).get("/api/notifications?limit=2").set(auth(token));
    expect(first.body.items.map((n: { title: string }) => n.title)).toEqual(["N 4", "N 3"]);
    expect(first.body.items[0].type).toBe("import");
    expect(first.body.unread_count).toBe(5);

    // Deleting an item already seen mustn't shift the next page.
    await request(app).delete(`/api/notifications/${first.body.items[0].id}`).set(auth(token));
    const second = await request(app)
      .get(`/api/notifications?limit=2&before=${encodeURIComponent(first.body.next_cursor)}`)
      .set(auth(token));
    expect(second.body.items.map((n: { title: string }) => n.title)).toEqual(["N 2", "N 1"]);

    const last = await request(app)
      .get(`/api/notifications?limit=2&before=${encodeURIComponent(second.body.next_cursor)}`)
      .set(auth(token));
    expect(last.body.items.map((n: { title: string }) => n.title)).toEqual(["N 0"]);
    expect(last.body.next_cursor).toBeNull();
  });

  it("sends the title's message to translate, and none for one written without, or with a broken one", async () => {
    await prisma.notification.deleteMany({ where: { userId } });
    const at = Date.now();
    await prisma.notification.createMany({
      data: [
        {
          userId,
          type: "import",
          title: 'Imported "Cube"',
          message: { key: "imported", values: { name: "Cube" } },
          createdAt: new Date(at - 2000),
        },
        { userId, type: "import", title: "Plain", createdAt: new Date(at - 1000) },
        { userId, type: "import", title: "Broken", message: { values: [1] }, createdAt: new Date(at) },
      ],
    });
    const res = await request(app).get("/api/notifications").set(auth(token));
    expect(res.body.items.map((n: { title: string; message: unknown }) => [n.title, n.message])).toEqual([
      ["Broken", null],
      ["Plain", null],
      ['Imported "Cube"', { key: "imported", values: { name: "Cube" } }],
    ]);
  });

  it("deletes one, but not someone else's, and then all", async () => {
    await prisma.notification.deleteMany({ where: { userId } });
    await seed(3);
    const [newest] = (await request(app).get("/api/notifications").set(auth(token))).body.items;

    expect((await request(app).delete(`/api/notifications/${newest.id}`).set(auth(otherToken))).status).toBe(404);
    expect((await request(app).delete(`/api/notifications/${newest.id}`).set(auth(token))).status).toBe(200);
    expect((await request(app).get("/api/notifications").set(auth(token))).body.items).toHaveLength(2);

    expect((await request(app).delete("/api/notifications").set(auth(token))).status).toBe(200);
    const after = (await request(app).get("/api/notifications").set(auth(token))).body;
    expect(after).toMatchObject({ items: [], unread_count: 0, next_cursor: null });
  });

  it("prunes read ones after 30 days and unread ones after 90", async () => {
    await prisma.notification.deleteMany({ where: { userId } });
    const ago = (days: number) => new Date(Date.now() - days * DAY_MS);
    await prisma.notification.createMany({
      data: [
        { userId, title: "read, 10 days", createdAt: ago(10), readAt: ago(9) },
        { userId, title: "read, 40 days", createdAt: ago(40), readAt: ago(39) },
        { userId, title: "unread, 40 days", createdAt: ago(40) },
        { userId, title: "unread, 100 days", createdAt: ago(100) },
      ],
    });
    await pruneNotifications();
    const left = await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    expect(left.map((n) => n.title)).toEqual(["read, 10 days", "unread, 40 days"]);
  });
});
