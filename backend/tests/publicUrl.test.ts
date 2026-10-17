import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { getPublicUrl, seedPublicUrl, setPublicUrl } from "../src/services/settingsService";

const app = createApp();
const stamp = Date.now();
let admin: string;
let previous: string;

beforeAll(async () => {
  previous = await getPublicUrl();
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "URL admin", email: `public-url-${stamp}@example.com`, password: "password123" });
  admin = res.body.token;
  await prisma.user.update({ where: { id: res.body.user.id }, data: { role: "ADMIN" } });
});

afterAll(async () => {
  await setPublicUrl(previous || null);
});

describe("the public URL", () => {
  it("is seeded from the environment once, then managed in the app", async () => {
    await prisma.setting.deleteMany({ where: { key: "public_url" } });
    await seedPublicUrl("https://from-env.example.com/");
    expect(await getPublicUrl()).toBe("https://from-env.example.com");
    // A later env value doesn't override what's stored.
    await seedPublicUrl("https://changed-env.example.com");
    expect(await getPublicUrl()).toBe("https://from-env.example.com");

    const saved = await request(app)
      .patch("/api/settings/public-url")
      .set({ Authorization: `Bearer ${admin}` })
      .send({ public_url: "https://thingport.example.com/" });
    expect(saved.body).toEqual({ public_url: "https://thingport.example.com" });
    const read = await request(app)
      .get("/api/settings/public-url")
      .set({ Authorization: `Bearer ${admin}` });
    expect(read.body).toEqual({ public_url: "https://thingport.example.com" });

    // A later env value doesn't override an admin's change either.
    await seedPublicUrl("https://from-env.example.com");
    expect(await getPublicUrl()).toBe("https://thingport.example.com");
  });

  it("refuses something that isn't a web address", async () => {
    // Nor can it be emptied: emails and single sign-on need it.
    for (const bad of ["", "   ", null, "thingport.example.com", "ftp://x.example.com", "https://x.example.com/?a=1"]) {
      const res = await request(app)
        .patch("/api/settings/public-url")
        .set({ Authorization: `Bearer ${admin}` })
        .send({ public_url: bad });
      expect(res.status).toBe(400);
    }
  });
});
