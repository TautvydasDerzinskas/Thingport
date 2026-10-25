import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { seedProviderCategoryIds } from "../src/services/categorySiteIds";

// A provider added after users signed up gets its ids onto their starter categories once, at startup.

const app = createApp();
const KEY = "provider_category_seed:thangs";

const thangsIds = async (categoryId: string) =>
  (
    await prisma.categorySiteId.findMany({
      where: { categoryId, provider: "thangs" },
      orderBy: { position: "asc" },
    })
  ).map((row) => row.siteId);

describe("seedProviderCategoryIds", () => {
  it("fills a provider's ids into starter categories that have none, once, by their path of names", async () => {
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Seed Test", email: `category-seed-${Date.now()}@example.com`, password: "password123" });
    expect(res.status).toBe(200);
    const userId: string = res.body.user.id;
    const named = (name: string) => prisma.category.findFirstOrThrow({ where: { userId, name, kind: "category" } });
    const art = await named("Art");
    const wallArt = await named("2D Art");
    const tools = await named("Tools");
    const renamed = await named("Miniatures");

    // As if Thangs were new: this user's starter categories don't have its ids yet.
    await prisma.categorySiteId.deleteMany({ where: { category: { userId }, provider: "thangs" } });
    await prisma.setting.deleteMany({ where: { key: KEY } });
    await prisma.categorySiteId.create({ data: { categoryId: tools.id, provider: "thangs", siteId: "Mine" } });
    await prisma.category.update({ where: { id: renamed.id }, data: { name: "My Minis" } });

    await seedProviderCategoryIds();

    expect(await thangsIds(art.id)).toEqual(["Art & Decor"]);
    expect(await thangsIds(wallArt.id)).toEqual(["Art & Decor/Wall Art"]);
    // Ids the user gave are kept, and a renamed category is no longer the starter one.
    expect(await thangsIds(tools.id)).toEqual(["Mine"]);
    expect(await thangsIds(renamed.id)).toEqual([]);
    expect(await prisma.setting.findUnique({ where: { key: KEY } })).not.toBeNull();

    // Once only: ids cleared after it ran stay cleared.
    await prisma.categorySiteId.deleteMany({ where: { categoryId: art.id } });
    await seedProviderCategoryIds();
    expect(await thangsIds(art.id)).toEqual([]);
  });
});
