import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import {
  deliverSystemNotifications,
  matchesVersion,
  parseSystemNotifications,
  type SystemNotificationEntry,
} from "../src/services/systemNotificationService";

const app = createApp();
const DAY_MS = 24 * 60 * 60 * 1000;
const run = Date.now();
let admin: { id: string; token: string };
let member: { id: string; token: string };

async function register(name: string, role: "ADMIN" | "MEMBER") {
  const email = `system-${name}-${run}@example.com`;
  const res = await request(app).post("/api/register").send({ displayName: name, email, password: "password123" });
  await prisma.user.update({ where: { id: res.body.user.id }, data: { role } });
  const login = await request(app).post("/api/login").send({ email, password: "password123" });
  return { id: res.body.user.id as string, token: login.body.token as string };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const entry = (id: string, daysAgo: number, extra: Partial<SystemNotificationEntry> = {}): SystemNotificationEntry => ({
  id: `${id}-${run}`,
  title: `Title ${id}`,
  published_at: new Date(Date.now() - daysAgo * DAY_MS),
  audience: "admins",
  ...extra,
});
const systemOf = (userId: string) =>
  prisma.notification.findMany({ where: { userId, type: "system" }, orderBy: { createdAt: "desc" } });

beforeAll(async () => {
  admin = await register("Admin", "ADMIN");
  member = await register("Member", "MEMBER");
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, member.id] } } });
});

describe("system notifications", () => {
  it("skips malformed entries without dropping the rest", () => {
    const parsed = parseSystemNotifications({
      notifications: [
        { id: "ok", title: "Fine", published_at: "2026-10-01T00:00:00Z", url: "https://example.com" },
        { id: "no-title", published_at: "2026-10-01T00:00:00Z" },
        { id: "bad-url", title: "x", published_at: "2026-10-01T00:00:00Z", url: "not a url" },
        { id: "plain-http", title: "x", published_at: "2026-10-01T00:00:00Z", url: "http://example.com" },
        { id: "bad-audience", title: "x", published_at: "2026-10-01T00:00:00Z", audience: "everyone" },
        { id: "bad-version", title: "x", published_at: "2026-10-01T00:00:00Z", version: "~1.0" },
        { id: "off-site-path", title: "x", published_at: "2026-10-01T00:00:00Z", path: "//evil.example" },
        { id: "for-old", title: "x", published_at: "2026-10-01T00:00:00Z", version: "<1.0.0" },
      ],
    });
    expect(parsed.map((e) => e.id)).toEqual(["ok", "for-old"]);
    expect(parsed[0].audience).toBe("admins");
    expect(parseSystemNotifications({ nope: true })).toEqual([]);
    const both = parseSystemNotifications({
      notifications: [{ id: "legacy", title: "x", published_at: "2026-10-01T00:00:00Z" }],
      entries: [{ id: "new", title: "x", published_at: "2026-10-01T00:00:00Z", version: "1.0.0" }],
    });
    expect(both.map((e) => e.id)).toEqual(["legacy", "new"]);
  });

  it("sends due entries to admins only, dated when they were posted", async () => {
    const posted = entry("bug", 2, { body: "Imports fail on 1.2", url: "https://example.com/issue" });
    await deliverSystemNotifications([posted, entry("future", -3), entry("stale", 120)]);

    const [notification, ...rest] = await systemOf(admin.id);
    expect(rest).toHaveLength(0);
    expect(notification).toMatchObject({
      title: "Title bug",
      body: "Imports fail on 1.2",
      externalUrl: "https://example.com/issue",
      readAt: null,
    });
    expect(notification.createdAt.getTime()).toBe(posted.published_at.getTime());
    expect(await systemOf(member.id)).toHaveLength(0);
  });

  it("sends an entry for everyone to members too", async () => {
    await deliverSystemNotifications([entry("everyone", 1, { audience: "all" })]);
    expect((await systemOf(member.id)).map((n) => n.title)).toEqual(["Title everyone"]);
    expect((await systemOf(admin.id)).some((n) => n.title === "Title everyone")).toBe(true);
  });

  it("matches version ranges", () => {
    expect(matchesVersion(undefined, null)).toBe(true);
    expect(matchesVersion("<1.0.0", "0.9.12")).toBe(true);
    expect(matchesVersion("<1.0.0", "1.0.0")).toBe(false);
    expect(matchesVersion("1.0.0", "1.0.0")).toBe(true);
    expect(matchesVersion("=1.0.0", "1.0.1")).toBe(false);
    expect(matchesVersion(">1.0.0", "1.10.0")).toBe(true);
    expect(matchesVersion(">=1.0.0", "1.0.0")).toBe(true);
    expect(matchesVersion("<=1.0.0", "1.0.1")).toBe(false);
    expect(matchesVersion("1.0.0", null)).toBe(false);
  });

  it("sends a version-targeted entry only once the instance is in range", async () => {
    const targeted = entry("v1", 1, { version: "1.0.0", path: "/admin" });
    await deliverSystemNotifications([targeted], new Date(), "0.9.0");
    expect((await systemOf(admin.id)).some((n) => n.title === "Title v1")).toBe(false);
    await deliverSystemNotifications([targeted], new Date(), "1.0.0");
    const sent = (await systemOf(admin.id)).filter((n) => n.title === "Title v1");
    expect(sent).toHaveLength(1);
    expect(sent[0].internalPath).toBe("/admin");
  });

  it("never sends the same entry twice, even after it was deleted", async () => {
    const once = entry("once", 1);
    await deliverSystemNotifications([once]);
    await deliverSystemNotifications([once]);
    const sent = (await systemOf(admin.id)).filter((n) => n.title === "Title once");
    expect(sent).toHaveLength(1);

    await request(app).delete(`/api/notifications/${sent[0].id}`).set(auth(admin.token));
    await deliverSystemNotifications([once]);
    expect((await systemOf(admin.id)).some((n) => n.title === "Title once")).toBe(false);
  });

  it("filters by tab, keeps what was new when opened in Unread, and clears only the chosen tab", async () => {
    await prisma.notification.deleteMany({ where: { userId: admin.id } });
    await prisma.notification.create({
      data: { userId: admin.id, type: "import", title: "Seen before", readAt: new Date(Date.now() - DAY_MS) },
    });
    await prisma.notification.create({ data: { userId: admin.id, type: "import", title: "Imported" } });
    await deliverSystemNotifications([entry("tabs", 0)]);

    const list = async (query: string) =>
      (await request(app).get(`/api/notifications?${query}`).set(auth(admin.token))).body.items
        .map((n: { title: string }) => n.title)
        .toSorted();
    expect(await list("filter=system")).toEqual(["Title tabs"]);

    // Opening the list marks everything read; Unread still shows what was new at that moment.
    const opened = await request(app).post("/api/notifications/read-all").set(auth(admin.token));
    const since = encodeURIComponent(opened.body.read_at);
    expect(await list("filter=unread")).toEqual([]);
    expect(await list(`filter=unread&since=${since}`)).toEqual(["Imported", "Title tabs"]);

    await request(app).delete("/api/notifications?filter=system").set(auth(admin.token));
    expect(await list("filter=all")).toEqual(["Imported", "Seen before"]);
    await request(app).delete(`/api/notifications?filter=unread&since=${since}`).set(auth(admin.token));
    expect(await list("filter=all")).toEqual(["Seen before"]);
  });
});
