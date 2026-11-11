import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { pruneNotifications } from "../src/services/notificationService";
import {
  bridgeVersionFromUserAgent,
  latestBridgeVersion,
  notifyOutdatedBridge,
} from "../src/services/bridgeUpdateService";

// config.ts reads RELEASE_NOTES_URL on load, so it's hoisted: a folder standing in for the repo, whose
// bridge/package.json each test sets. A file:// one is read afresh every time.
const repo = vi.hoisted(() => {
  const dir = `${(process.env.TMPDIR || "/tmp").replace(/\/+$/, "")}/thingport-bridge-repo-${process.pid}`;
  process.env.RELEASE_NOTES_URL = `file://${dir}`;
  return dir;
});

// Fails the next notification to be saved, when set.
const failing = vi.hoisted(() => ({ next: false }));
vi.mock("../src/services/notificationService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/services/notificationService")>();
  return {
    ...real,
    createNotification: async (...args: Parameters<typeof real.createNotification>) => {
      if (failing.next) {
        failing.next = false;
        throw new Error("couldn't save the notification");
      }
      return real.createNotification(...args);
    },
  };
});

beforeAll(() => {
  fs.mkdirSync(path.join(repo, "bridge"), { recursive: true });
});

const app = createApp();
const users: string[] = [];
const DAY_MS = 24 * 60 * 60 * 1000;

function setLatest(contents: string | { version: string }) {
  const text = typeof contents === "string" ? contents : JSON.stringify(contents);
  fs.writeFileSync(path.join(repo, "bridge", "package.json"), text);
}

async function register(name: string) {
  const email = `bridge-update-${name}-${Date.now()}@example.com`;
  const res = await request(app).post("/api/register").send({ displayName: name, email, password: "password123" });
  users.push(res.body.user.id);
  return { token: res.body.token as string, id: res.body.user.id as string };
}

const bridgeNotices = (userId: string) =>
  prisma.notification.findMany({ where: { userId, type: "system" }, orderBy: { createdAt: "asc" } });
const eventually = (check: () => unknown) => vi.waitFor(check, { timeout: 5_000, interval: 20 });
// What's checked runs after the response, so give a notice that shouldn't come the time to come anyway.
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("the Bridge's version", () => {
  it("comes from its User-Agent", () => {
    expect(bridgeVersionFromUserAgent("Thingport-Bridge/1.0.2 (darwin)")).toBe("1.0.2");
    expect(bridgeVersionFromUserAgent("Thingport-Bridge/12.0.10")).toBe("12.0.10");
    expect(bridgeVersionFromUserAgent("Thingport-Bridge/dev (linux)")).toBeNull();
    expect(bridgeVersionFromUserAgent("Mozilla/5.0 (Macintosh)")).toBeNull();
    expect(bridgeVersionFromUserAgent(undefined)).toBeNull();
  });

  it("counts 1.0.1 and older, which send Go's own User-Agent, as 1.0.1", () => {
    expect(bridgeVersionFromUserAgent("Go-http-client/1.1")).toBe("1.0.1");
  });
});

describe("the newest Bridge", () => {
  it("is the version in bridge/package.json", async () => {
    setLatest({ version: "1.0.4" });
    expect(await latestBridgeVersion()).toBe("1.0.4");
  });

  it("is unknown when the file is unreadable or the fetching is off", async () => {
    setLatest("not json");
    expect(await latestBridgeVersion()).toBeNull();
    setLatest({ version: "next" });
    expect(await latestBridgeVersion()).toBeNull();
    expect(await latestBridgeVersion("")).toBeNull();
  });
});

describe("the update notice", () => {
  it("comes once per newer version", async () => {
    const { id } = await register("once");
    expect(await notifyOutdatedBridge(id, "1.0.1", "1.0.2")).toBe(true);
    expect(await notifyOutdatedBridge(id, "1.0.1", "1.0.2")).toBe(false);
    expect(await notifyOutdatedBridge(id, "1.0.2", "1.0.2")).toBe(false);
    expect(await notifyOutdatedBridge(id, "1.0.1", "1.0.3")).toBe(true);
    expect(await notifyOutdatedBridge(id, "1.0.10", "1.0.9")).toBe(false);
    expect(await notifyOutdatedBridge(id, "1.0.1", null)).toBe(false);

    const notices = await bridgeNotices(id);
    expect(notices.map((n) => n.title)).toEqual([
      "Thingport Bridge 1.0.2 is available",
      "Thingport Bridge 1.0.3 is available",
    ]);
    expect(notices[1]).toMatchObject({
      internalPath: "/downloads",
      message: { key: "bridgeUpdate", values: { version: "1.0.3" } },
    });
  });

  it("comes once when two files download at the same time", async () => {
    const { id } = await register("together");
    const sent = await Promise.all([
      notifyOutdatedBridge(id, "1.0.0", "1.1.0"),
      notifyOutdatedBridge(id, "1.0.0", "1.1.0"),
    ]);
    expect(sent.filter(Boolean)).toHaveLength(1);
    expect(await bridgeNotices(id)).toHaveLength(1);
  });

  it("is tried again when the notification couldn't be saved", async () => {
    const { id } = await register("retry");
    failing.next = true;
    await expect(notifyOutdatedBridge(id, "1.0.1", "4.0.0")).rejects.toThrow("couldn't save the notification");
    expect(await prisma.systemReceipt.count({ where: { userId: id } })).toBe(0);

    expect(await notifyOutdatedBridge(id, "1.0.1", "4.0.0")).toBe(true);
    expect((await bridgeNotices(id)).map((n) => n.title)).toEqual(["Thingport Bridge 4.0.0 is available"]);
  });

  it("comes when an older Bridge downloads through a slicer link", async () => {
    setLatest({ version: "2.0.0" });
    const { token, id } = await register("link");
    const res = await request(app)
      .get(`/api/t/${token}/settings/slicer`)
      .set("User-Agent", "Thingport-Bridge/1.9.0 (darwin)");
    expect(res.status).toBe(200);
    await eventually(async () => expect(await bridgeNotices(id)).toHaveLength(1));

    await request(app).get(`/api/t/${token}/settings/slicer`).set("User-Agent", "Thingport-Bridge/1.9.0 (darwin)");
    await settle();
    expect(await bridgeNotices(id)).toHaveLength(1);
  });

  it("comes to someone on Bridge 1.0.1 or older", async () => {
    setLatest({ version: "2.0.0" });
    const { token, id } = await register("old");
    await request(app).get(`/api/t/${token}/settings/slicer`).set("User-Agent", "Go-http-client/1.1");
    await eventually(async () =>
      expect((await bridgeNotices(id)).map((n) => n.title)).toEqual(["Thingport Bridge 2.0.0 is available"]),
    );
  });

  it("doesn't come for the newest Bridge, a browser, or a request that isn't a slicer link", async () => {
    setLatest({ version: "2.0.0" });
    const { token, id } = await register("quiet");
    await request(app).get(`/api/t/${token}/settings/slicer`).set("User-Agent", "Thingport-Bridge/2.0.0 (linux)");
    await request(app).get(`/api/t/${token}/settings/slicer`).set("User-Agent", "Mozilla/5.0");
    await request(app)
      .get("/api/settings/slicer")
      .set({ Authorization: `Bearer ${token}`, "User-Agent": "Thingport-Bridge/1.0.0 (linux)" });
    await settle();
    expect(await bridgeNotices(id)).toHaveLength(0);
  });

  it("isn't sent again once its receipt is past the notification retention", async () => {
    const { id } = await register("kept");
    const old = new Date(Date.now() - 200 * DAY_MS);
    await prisma.systemReceipt.createMany({
      data: [
        { userId: id, systemId: "bridge-update-3.0.0", createdAt: old },
        { userId: id, systemId: "some-old-announcement", createdAt: old },
      ],
    });
    await pruneNotifications();
    const left = await prisma.systemReceipt.findMany({ where: { userId: id } });
    expect(left.map((r) => r.systemId)).toEqual(["bridge-update-3.0.0"]);
    expect(await notifyOutdatedBridge(id, "2.0.0", "3.0.0")).toBe(false);
  });
});
