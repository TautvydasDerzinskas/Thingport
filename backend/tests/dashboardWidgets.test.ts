import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";

const app = createApp();
const stamp = Date.now();
let token: string;
let userId: string;

const auth = () => ({ Authorization: `Bearer ${token}` });
const get = async () => (await request(app).get("/api/settings/dashboard-widgets").set(auth())).body.widgets;
const patch = (widgets: unknown) => request(app).patch("/api/settings/dashboard-widgets").set(auth()).send({ widgets });

beforeAll(async () => {
  const registered = (
    await request(app)
      .post("/api/register")
      .send({ displayName: "Widgets", email: `widgets-${stamp}@example.com`, password: "password123" })
  ).body;
  token = registered.token;
  userId = registered.user.id;
});

describe("dashboard widget preferences", () => {
  it("starts with nothing changed", async () => {
    expect(await get()).toEqual({});
  });

  it("merges each change into what's saved", async () => {
    expect((await patch({ topViewed: false })).body.widgets).toEqual({ topViewed: false });
    expect((await patch({ topProviders: false, topViewed: true })).body.widgets).toEqual({
      topViewed: true,
      topProviders: false,
    });
    expect(await get()).toEqual({ topViewed: true, topProviders: false });
  });

  it("keeps both of two toggles sent at once", async () => {
    await Promise.all([patch({ modelCount: false }), patch({ authorCount: false })]);
    expect(await get()).toMatchObject({ modelCount: false, authorCount: false });
  });

  it("rejects an unknown widget or a non-boolean", async () => {
    expect((await patch({ horoscope: false })).status).toBe(400);
    expect((await patch({ topViewed: "no" })).status).toBe(400);
  });

  it("needs a signed-in user", async () => {
    expect((await request(app).get("/api/settings/dashboard-widgets")).status).toBe(401);
  });
});

describe("dashboard layout preference", () => {
  const getLayout = async () => (await request(app).get("/api/settings/dashboard-layout").set(auth())).body.layout;
  const setLayout = (layout: unknown) =>
    request(app).patch("/api/settings/dashboard-layout").set(auth()).send({ layout });

  it("starts on the default layout and keeps a chosen one", async () => {
    expect(await getLayout()).toBe("left");
    expect((await setLayout("top")).body.layout).toBe("top");
    expect(await getLayout()).toBe("top");
  });

  it("rejects an unknown layout", async () => {
    expect((await setLayout("diagonal")).status).toBe(400);
    expect(await getLayout()).toBe("top");
  });

  it("needs a signed-in user", async () => {
    expect((await request(app).get("/api/settings/dashboard-layout")).status).toBe(401);
  });
});

describe("weather location preference", () => {
  const getLocation = async () => (await request(app).get("/api/settings/weather-location").set(auth())).body.location;
  const setLocation = (location: unknown) =>
    request(app).patch("/api/settings/weather-location").set(auth()).send({ location });

  it("starts unset, keeps a chosen place, and forgets it", async () => {
    expect(await getLocation()).toBeNull();
    const vilnius = { lat: 54.69, lon: 25.28, name: "Vilnius", source: "manual" };
    expect((await setLocation(vilnius)).body.location).toEqual(vilnius);
    expect(await getLocation()).toEqual(vilnius);
    expect((await setLocation(null)).status).toBe(200);
    expect(await getLocation()).toBeNull();
  });

  it("rejects coordinates off the globe", async () => {
    expect((await setLocation({ lat: 91, lon: 0, name: null, source: "device" })).status).toBe(400);
    expect((await setLocation({ lat: 0, lon: 0, name: null, source: "elsewhere" })).status).toBe(400);
  });
});

describe("featured model", () => {
  const featured = async (date: string) =>
    (await request(app).get(`/api/dashboard/featured?date=${date}`).set(auth())).body.print;
  const createdPrints: string[] = [];

  async function model(filename: string) {
    const name = `Featured ${createdPrints.length} ${stamp}`;
    const row = await prisma.print.create({
      data: {
        userId,
        name,
        nameNormalized: name.toLowerCase(),
        plates: {
          create: {
            position: 0,
            filename,
            mime: "model/stl",
            storagePath: `featured-${stamp}-${createdPrints.length}`,
          },
        },
      },
    });
    createdPrints.push(row.id);
    return row;
  }

  afterAll(async () => {
    await prisma.print.deleteMany({ where: { id: { in: createdPrints } } });
  });

  it("has nothing to feature without a 3D model", async () => {
    await model("notes.pdf");
    expect(await featured("2026-10-10")).toBeNull();
  });

  it("features a 3D model, the same one all day", async () => {
    const models = [await model("cube.stl"), await model("plate.3mf"), await model("part.step")];
    const today = await featured("2026-10-10");
    expect(models.map((m) => m.id)).toContain(today.id);
    expect((await featured("2026-10-10")).id).toBe(today.id);
    // Over a month the pick moves between models. Thirty days all landing on one of three would be a
    // 1 in 10^14 chance, so this can't fail by bad luck.
    const days = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
    const picks = await Promise.all(days.map((day) => featured(day)));
    expect(new Set(picks.map((print) => print.id)).size).toBeGreaterThan(1);
  });

  it("rejects a malformed date", async () => {
    expect((await request(app).get("/api/dashboard/featured?date=yesterday").set(auth())).status).toBe(400);
  });
});
