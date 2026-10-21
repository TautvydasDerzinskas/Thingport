import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();
const stamp = Date.now();
let token: string;

const auth = () => ({ Authorization: `Bearer ${token}` });
const getTheme = async () => (await request(app).get("/api/settings/theme").set(auth())).body;
const patchTheme = (patch: unknown) => request(app).patch("/api/settings/theme").set(auth()).send(patch);

beforeAll(async () => {
  token = (
    await request(app)
      .post("/api/register")
      .send({ displayName: "Appearance", email: `appearance-${stamp}@example.com`, password: "password123" })
  ).body.token;
});

describe("render colour", () => {
  it("follows the accent until one is picked", async () => {
    expect(await getTheme()).toMatchObject({ accent: null, renderColor: null });
    expect((await patchTheme({ renderColor: "light" })).body).toMatchObject({ renderColor: "light" });
    expect(await getTheme()).toMatchObject({ renderColor: "light" });
  });

  it("goes back to following the accent when the accent changes", async () => {
    await patchTheme({ renderColor: "teal" });
    expect((await patchTheme({ accent: "graphite" })).body).toMatchObject({ accent: "graphite", renderColor: null });
  });

  it("keeps a render colour set alongside the accent", async () => {
    expect((await patchTheme({ accent: "blue", renderColor: "orange" })).body).toMatchObject({
      accent: "blue",
      renderColor: "orange",
    });
  });

  it("rejects an unknown colour", async () => {
    expect((await patchTheme({ renderColor: "sepia" })).status).toBe(400);
    // Light grey is a render colour only.
    expect((await patchTheme({ accent: "light" })).status).toBe(400);
  });
});

describe("hover slideshow", () => {
  const get = async () => (await request(app).get("/api/settings/hover-slideshow").set(auth())).body.enabled;
  const patch = (enabled: unknown) => request(app).patch("/api/settings/hover-slideshow").set(auth()).send({ enabled });

  it("starts on and keeps a change", async () => {
    expect(await get()).toBe(true);
    expect((await patch(false)).body.enabled).toBe(false);
    expect(await get()).toBe(false);
  });

  it("rejects a non-boolean", async () => {
    expect((await patch("off")).status).toBe(400);
  });
});
