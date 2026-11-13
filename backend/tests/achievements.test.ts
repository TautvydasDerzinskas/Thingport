import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { checkAchievementsNow, creditEveryone } from "../src/services/achievementService";
import {
  getAchievementSettings,
  getSocialSettings,
  setAchievementSettings,
  setSocialSettings,
  type AchievementSettings,
  type SocialSettings,
} from "../src/services/settingsService";

const app = createApp();
const stamp = Date.now();
const STL =
  "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n";
const DAY_MS = 24 * 60 * 60 * 1000;

type Account = { id: string; token: string };
type Own = { id: string; tier: number; count: number | null; next: number | null; seen: boolean; expired?: boolean };

let admin: Account;
let member: Account;
let savedAchievements: AchievementSettings;
let savedSocial: SocialSettings;
let toolId: string | null = null;

const auth = (account: Account) => ({ Authorization: `Bearer ${account.token}` });

async function register(name: string): Promise<Account> {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: name, email: `ach-${name.toLowerCase()}-${stamp}@example.com`, password: "password123" });
  return { id: res.body.user.id, token: res.body.token };
}

async function own(account: Account): Promise<Own[]> {
  const res = await request(app).get("/api/me/achievements").set(auth(account));
  expect(res.status).toBe(200);
  return res.body as Own[];
}

const badge = async (account: Account, id: string) => (await own(account)).find((item) => item.id === id);

/** Waits for what something fire-and-forget writes, failing if it isn't there within `timeoutMs`. */
async function eventually(condition: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("Not there within the timeout");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function downloads(account: Account, count: number) {
  await prisma.activity.createMany({
    data: Array.from({ length: count }, () => ({ userId: account.id, kind: "download" })),
  });
}

async function upload(account: Account, fields: Record<string, string> = {}) {
  let req = request(app).post("/api/upload").set(auth(account));
  for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
  const res = await req.attach("files", Buffer.from(STL), `part-${Math.random()}.stl`);
  expect(res.status).toBe(200);
  return res.body.prints[0].id as string;
}

beforeAll(async () => {
  savedAchievements = await getAchievementSettings();
  savedSocial = await getSocialSettings();
  await setAchievementSettings({ enabled: false });
  admin = await register("Admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  member = await register("Member");
});

afterAll(async () => {
  await setAchievementSettings(savedAchievements);
  await setSocialSettings(savedSocial);
  if (toolId) await prisma.tool.delete({ where: { id: toolId } }).catch(() => undefined);
});

describe("achievements switch", () => {
  it("is off by default, and an admin's alone to change", async () => {
    expect((await request(app).get("/api/achievements/settings").set(auth(admin))).body).toEqual({ enabled: false });
    expect((await request(app).get("/api/achievements/settings").set(auth(member))).status).toBe(403);
    expect(
      (await request(app).patch("/api/achievements/settings").set(auth(member)).send({ enabled: true })).status,
    ).toBe(403);
    expect((await request(app).get("/api/social").set(auth(member))).body.achievements).toBe(false);
  });

  it("is absent while off", async () => {
    const res = await request(app).get("/api/me/achievements").set(auth(member));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("achievements_off");
    expect(
      (await request(app).post("/api/me/achievements/secret").set(auth(member)).send({ secret: "weather-scene/guest" }))
        .status,
    ).toBe(404);
  });

  it("credits what was earned before on turning on, in one notification and without toasts", async () => {
    await downloads(member, 3);
    const printId = await upload(member);
    await prisma.print.update({
      where: { id: printId },
      data: { sourceProvider: "makerworld", sourceExternalId: `${stamp}` },
    });

    // Someone whose badges are checked while everyone is being credited: theirs are told with the rest.
    const busy = await register("Busy");
    await downloads(busy, 3);

    const res = await request(app).patch("/api/achievements/settings").set(auth(admin)).send({ enabled: true });
    expect(res.body).toEqual({ enabled: true });
    // Crediting runs in the background; this waits for it to be done.
    await Promise.all([creditEveryone(), checkAchievementsNow(busy.id)]);
    const busyNotes = await prisma.notification.findMany({ where: { userId: busy.id, type: "achievement" } });
    expect(busyNotes.map((note) => note.message)).toEqual([{ key: "achievementsCredited", values: { count: 1 } }]);
    expect(await badge(busy, "downloads")).toMatchObject({ tier: 0, seen: true });

    const list = await own(member);
    expect(list.find((item) => item.id === "downloads")).toMatchObject({ tier: 0, count: 3, next: 10, seen: true });
    expect(list.find((item) => item.id === "site:makerworld")).toMatchObject({ tier: 0, count: 1, seen: true });
    expect(list.find((item) => item.id === "imports")).toMatchObject({ tier: 0, seen: true });
    const notes = await prisma.notification.findMany({ where: { userId: member.id, type: "achievement" } });
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toMatchObject({ key: "achievementsCredited" });
    expect((await request(app).get("/api/social").set(auth(member))).body.achievements).toBe(true);
  });

  describe("switched off while crediting", () => {
    let first: Account;
    let second: Account;
    let made = 0;
    const credits = (account: Account) =>
      prisma.notification.count({ where: { userId: account.id, type: "achievement" } });

    beforeEach(async () => {
      // Checks the tests above left waiting would read the setting at a moment of their own.
      await Promise.all([checkAchievementsNow(admin.id), checkAchievementsNow(member.id)]);
      made += 1;
      first = await register(`First${made}`);
      second = await register(`Second${made}`);
      await downloads(first, 3);
      await downloads(second, 3);
      await setAchievementSettings({ enabled: true });
      // Credited in this order, `first`'s notification switching achievements off.
      vi.spyOn(prisma.user, "findMany").mockResolvedValue([{ id: first.id }, { id: second.id }] as never);
      const create = prisma.notification.create.bind(prisma.notification);
      vi.spyOn(prisma.notification, "create").mockImplementation(((args: { data: { userId: string } }) =>
        create(args as never).then(async (row) => {
          if (args.data.userId === first.id) await setAchievementSettings({ enabled: false });
          return row;
        })) as never);
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await setAchievementSettings({ enabled: true });
    });

    it("credits no one else", async () => {
      await creditEveryone();
      expect(await credits(first)).toBe(1);
      expect(await credits(second)).toBe(0);
      expect(await prisma.userAchievement.count({ where: { userId: second.id } })).toBe(0);
    });

    it("goes over everyone again, switched back on before the run is done", async () => {
      let switchedOff = false;
      const read = prisma.setting.findUnique.bind(prisma.setting);
      vi.spyOn(prisma.setting, "findUnique").mockImplementation(((args: { where: { key: string } }) =>
        read(args as never).then(async (row) => {
          // The run reads "off" for `second`, and an admin switches achievements on again before it has stopped.
          if (args.where.key === "achievements" && !switchedOff && (await credits(first))) {
            switchedOff = true;
            await setAchievementSettings({ enabled: true });
            void creditEveryone();
          }
          return row;
        })) as never);
      await creditEveryone();
      expect(switchedOff).toBe(true);
      expect(await credits(first)).toBe(1);
      expect(await prisma.notification.findMany({ where: { userId: second.id, type: "achievement" } })).toMatchObject([
        { message: { key: "achievementsCredited", values: { count: 1 } } },
      ]);
    });
  });
});

describe("earning", () => {
  beforeAll(async () => {
    await setAchievementSettings({ enabled: true });
  });

  it("raises a tier when its threshold is reached, unseen until the app says it showed it", async () => {
    await downloads(member, 7);
    await checkAchievementsNow(member.id);
    expect(await badge(member, "downloads")).toMatchObject({ tier: 1, count: 10, next: 100, seen: false });
    const note = await prisma.notification.findFirst({
      where: { userId: member.id, type: "achievement" },
      orderBy: { createdAt: "desc" },
    });
    expect(note?.message).toEqual({ key: "achievementUnlocked", values: { badge: "downloads", tier: 1 } });
    expect(note?.internalPath).toBe("/authors/self?achievement=downloads");

    const unseen = await request(app).get("/api/me/achievements?unseen=1").set(auth(member));
    expect(unseen.body.map((item: { id: string }) => item.id)).toEqual(["downloads"]);
    expect(unseen.body[0]).not.toHaveProperty("count");

    // Shown at the tier before, as when it was raised again after the app looked: that one hasn't been seen.
    const stale = await request(app)
      .post("/api/me/achievements/seen")
      .set(auth(member))
      .send({ badges: [{ id: "downloads", tier: 0 }] });
    expect(stale.status).toBe(204);
    expect(await badge(member, "downloads")).toMatchObject({ seen: false });

    const seen = await request(app)
      .post("/api/me/achievements/seen")
      .set(auth(member))
      .send({ badges: [{ id: "downloads", tier: 1 }] });
    expect(seen.status).toBe(204);
    expect(await badge(member, "downloads")).toMatchObject({ seen: true });
  });

  it("counts downloads only, not opening a model in a slicer", async () => {
    const before = (await badge(member, "downloads"))!.count!;
    const printId = await upload(member);
    await request(app).post(`/api/print/${printId}/download`).set(auth(member)).send({ kind: "slicer" });
    await request(app).post(`/api/print/${printId}/download`).set(auth(member));
    await eventually(async () => (await badge(member, "downloads"))!.count === before + 1);
    // And no more than that, the slicer's not counted however long it takes.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await badge(member, "downloads"))!.count).toBe(before + 1);
  });

  it("never takes a tier back", async () => {
    await prisma.activity.deleteMany({ where: { userId: member.id, kind: "download" } });
    await checkAchievementsNow(member.id);
    expect(await badge(member, "downloads")).toMatchObject({ tier: 1, count: 0 });
  });

  it("counts what a tool made by the tool, and only a tool the user has", async () => {
    const tool = await prisma.tool.upsert({
      where: { scope_slug: { scope: "repo", slug: "keyring-generator" } },
      create: { source: "repo", scope: "repo", slug: "keyring-generator", manifest: {}, script: "", sha: "test" },
      update: {},
    });
    if (tool.sha === "test") toolId = tool.id;

    const made = await upload(member, { origin: "created", created_with_tool: "keyring-generator" });
    const unknown = await upload(member, { origin: "created", created_with_tool: "no-such-tool" });
    const picked = await upload(member, { created_with_tool: "keyring-generator" });
    const rows = await prisma.print.findMany({
      where: { id: { in: [made, unknown, picked] } },
      select: { id: true, createdWith: true, createdWithRef: true },
    });
    const of = (id: string) => rows.find((row) => row.id === id);
    expect(of(made)).toMatchObject({ createdWith: "tool", createdWithRef: "keyring-generator" });
    // An unknown tool, or a file the user picked, is a model all the same, made by nothing in particular.
    expect(of(unknown)).toMatchObject({ createdWith: null, createdWithRef: null });
    expect(of(picked)).toMatchObject({ createdWith: null, createdWithRef: null });

    await checkAchievementsNow(member.id);
    expect(await badge(member, "tool:keyring-generator")).toMatchObject({ tier: 0, count: 1, next: 10 });
  });

  it("counts Studio's models by what made them", async () => {
    await prisma.print.update({
      where: { id: await upload(member) },
      data: { createdWith: "studio", createdWithRef: "d1" },
    });
    await checkAchievementsNow(member.id);
    expect(await badge(member, "studio")).toMatchObject({ tier: 0, count: 1 });
  });

  it("gives a secret a widget asks for, once, and no other", async () => {
    const claim = (secret: string) =>
      request(app).post("/api/me/achievements/secret").set(auth(member)).send({ secret });
    expect((await claim("weather-scene/guest")).status).toBe(204);
    expect((await claim("weather-scene/guest")).status).toBe(204);
    expect((await claim("weather-scene/nothing")).status).toBe(404);
    expect(await badge(member, "secret:weather-scene/guest")).toMatchObject({ tier: 0, count: null, seen: false });
    const notes = await prisma.notification.count({
      where: { userId: member.id, message: { path: ["values", "badge"], equals: "secret:weather-scene/guest" } },
    });
    expect(notes).toBe(1);
    // Last in the list, whatever else there is.
    expect((await own(member)).at(-1)?.id).toBe("secret:weather-scene/guest");
  });

  it("earns Regular on more than 20 of the last 30 days, and shows it lapsed after", async () => {
    // One clock for the days written here and the service's window, at noon: a day can't turn over meanwhile.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const today = Date.UTC(2026, 5, 15);
    const days = (count: number) =>
      Array.from({ length: count }, (_, n) => ({ userId: member.id, day: new Date(today - n * DAY_MS) }));
    await prisma.userActiveDay.deleteMany({ where: { userId: member.id } });
    await prisma.userActiveDay.createMany({ data: days(20), skipDuplicates: true });
    await checkAchievementsNow(member.id);
    expect(await badge(member, "regular")).toBeUndefined();

    await prisma.userActiveDay.createMany({ data: days(21), skipDuplicates: true });
    await checkAchievementsNow(member.id);
    expect(await badge(member, "regular")).toMatchObject({ tier: 0, expired: false });

    await prisma.userActiveDay.deleteMany({ where: { userId: member.id, day: { lt: new Date(today - 4 * DAY_MS) } } });
    expect(await badge(member, "regular")).toMatchObject({ tier: 0, expired: true, count: 5 });
  });

  it("notes the days someone uses Thingport", async () => {
    // Someone who hasn't been in yet today: the first request of each day is the one written.
    const fresh = await register("Fresh");
    await request(app).get("/api/social").set(auth(fresh));
    await request(app).get("/api/social").set(auth(fresh));
    await eventually(async () => (await prisma.userActiveDay.count({ where: { userId: fresh.id } })) > 0);
    expect(await prisma.userActiveDay.count({ where: { userId: fresh.id } })).toBe(1);
  });
});

describe("on someone's profile", () => {
  it("shows their badges while achievements are on, and nothing while off", async () => {
    await setSocialSettings({ enabled: true });
    await setAchievementSettings({ enabled: true });
    const page = await request(app).get(`/api/explore/user/${member.id}`).set(auth(member));
    expect(page.status).toBe(200);
    const shown = page.body.user.achievements as { id: string; count?: number }[];
    expect(shown.map((item) => item.id)).toContain("downloads");
    // Others see the badge, not the counts behind it.
    expect(shown[0]).not.toHaveProperty("count");

    await setAchievementSettings({ enabled: false });
    expect(
      (await request(app).get(`/api/explore/user/${member.id}`).set(auth(member))).body.user.achievements,
    ).toBeNull();
  });
});
