import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { AVATARS, COVERS } from "../src/config";
import { COVER_PRESETS, defaultCoverPreset } from "../src/services/publicProfileService";
import { randomAvatarStyle } from "../src/services/avatarArt";
import { linkAuthorToUser, upsertAuthorFromImport } from "../src/services/authorService";
import { getSocialSettings, setSocialSettings } from "../src/services/settingsService";

const app = createApp();
const stamp = Date.now();
let seq = 0;

type Account = { id: string; token: string };
async function register(name: string): Promise<Account> {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: name, email: `cover-${name}-${stamp}-${seq++}@example.com`, password: "password123" });
  return { id: res.body.user.id, token: res.body.token };
}
const as = (who: Account) => ({ Authorization: `Bearer ${who.token}` });
const picture = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#3366ff" } })
    .jpeg()
    .toBuffer();
const fileOf = (url: string) => path.join(COVERS, path.basename(url));
const upload = (who: Account, file: Buffer, positionY?: string) => {
  const req = request(app).post("/api/me/cover").set(as(who)).attach("file", file, "cover.jpg");
  return positionY === undefined ? req : req.field("position_y", positionY);
};
const patch = (who: Account, body: object) => request(app).patch("/api/me/public-profile").set(as(who)).send(body);

let me: Account;
let socialBefore: Awaited<ReturnType<typeof getSocialSettings>>;

beforeAll(async () => {
  me = await register("me");
  socialBefore = await getSocialSettings();
});

afterAll(async () => {
  await setSocialSettings(socialBefore);
  const user = await prisma.user.findUnique({ where: { id: me.id } });
  if (user?.backgroundUrl?.startsWith("/api/covers/")) fs.rmSync(fileOf(user.backgroundUrl), { force: true });
});

describe("a user's cover", () => {
  it("is one of the drawn ones until they choose, the same every time", async () => {
    const res = await request(app).get("/api/me").set(as(me));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: me.id,
      background_url: null,
      cover_preset: defaultCoverPreset(me.id),
      cover_position_y: 50,
    });
    expect(COVER_PRESETS).toContain(res.body.user.cover_preset);
  });

  it("spreads the drawn covers evenly across users", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 1000; i++) {
      const preset = defaultCoverPreset(`cm${(i * 7919).toString(36)}${stamp.toString(36)}`);
      counts.set(preset, (counts.get(preset) ?? 0) + 1);
    }
    expect([...counts.keys()].toSorted()).toEqual([...COVER_PRESETS].toSorted());
    for (const count of counts.values()) expect(count).toBeGreaterThan(140);
  });

  it("can be another drawn one, and refuses a name it doesn't have", async () => {
    const res = await patch(me, { cover_preset: "pixel" });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ background_url: null, cover_preset: "pixel" });
    expect((await patch(me, { cover_preset: "neon" })).status).toBe(400);
  });

  it("can be a picture: scaled down, served without a token, and deleted when another replaces it", async () => {
    const first = await upload(me, await picture(4000, 1000), "30");
    expect(first.status).toBe(200);
    const url: string = first.body.user.background_url;
    expect(url).toMatch(/^\/api\/covers\/[a-f0-9]{32}\.webp$/);
    expect(first.body.user).toMatchObject({ cover_preset: null, cover_position_y: 30 });

    const served = await request(app).get(url).buffer(true);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/webp");
    expect((await sharp(served.body as Buffer).metadata()).width).toBe(2560);

    const second = await upload(me, await picture(800, 300));
    expect(second.status).toBe(200);
    expect(second.body.user.cover_position_y).toBe(50);
    expect(fs.existsSync(fileOf(url))).toBe(false);
    expect((await request(app).get(url)).status).toBe(404);

    const secondUrl: string = second.body.user.background_url;
    const back = await patch(me, { cover_preset: "ascii" });
    expect(back.body.user).toMatchObject({ background_url: null, cover_preset: "ascii" });
    expect(fs.existsSync(fileOf(secondUrl))).toBe(false);
  });

  it("refuses what isn't a picture, and a crop outside it", async () => {
    expect((await upload(me, Buffer.from("not a picture at all"))).status).toBe(400);
    expect((await upload(me, await picture(400, 200), "101")).status).toBe(400);
    expect((await patch(me, { cover_position_y: 150 })).status).toBe(400);
    expect((await patch(me, { cover_position_y: 12 })).body.user.cover_position_y).toBe(12);
  });

  it("can be the picture of an author linked to the account, and of no other", async () => {
    const author = await upsertAuthorFromImport({
      provider: "printables",
      externalId: `cover-${stamp}`,
      name: `Cover Author ${stamp}`,
      handle: null,
      bio: null,
      bioTranslated: null,
      links: [],
      avatarUrl: null,
      backgroundUrl: "https://media.printables.com/cover.jpg",
    });
    const stranger = await upsertAuthorFromImport({
      provider: "thingiverse",
      externalId: `cover-stranger-${stamp}`,
      name: `Stranger ${stamp}`,
      handle: null,
      bio: null,
      bioTranslated: null,
      links: [],
      avatarUrl: null,
      backgroundUrl: "https://cdn.thingiverse.com/cover.jpg",
    });
    // Linking fills in a cover only where there's none of the user's own; a drawn one they picked isn't a picture.
    await linkAuthorToUser(me.id, author!.id);
    await patch(me, { cover_preset: "retro" });

    const taken = await patch(me, { cover_author_id: author!.id });
    expect(taken.status).toBe(200);
    expect(taken.body.user).toMatchObject({
      background_url: "https://media.printables.com/cover.jpg",
      cover_preset: null,
    });
    expect((await patch(me, { cover_author_id: stranger!.id })).status).toBe(404);
    expect((await patch(me, { cover_author_id: author!.id, cover_preset: "mosaic" })).status).toBe(400);
  });

  it("shows on the user's Explore page", async () => {
    await setSocialSettings({ enabled: true });
    const res = await request(app).get(`/api/explore/user/${me.id}`).set(as(me));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      background_url: "https://media.printables.com/cover.jpg",
      cover_preset: null,
      cover_position_y: 12,
    });
  });
});

describe("a user's bio", () => {
  it("is kept trimmed, and an empty one cleared", async () => {
    expect((await patch(me, { bio: "  Prints **dragons**.\n " })).body.user.bio).toBe("Prints **dragons**.");
    expect((await patch(me, { bio: "   " })).body.user.bio).toBeNull();
    expect((await patch(me, { bio: "Back" })).body.user.bio).toBe("Back");
    expect((await patch(me, { bio: null })).body.user.bio).toBeNull();
  });

  it("is refused over 1000 characters", async () => {
    expect((await patch(me, { bio: "x".repeat(1001) })).status).toBe(400);
  });
});

describe("deleting the account", () => {
  it("deletes the cover it uploaded", async () => {
    const admin = await register("admin");
    await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    const leaving = await register("leaving");
    const url: string = (await upload(leaving, await picture(600, 200))).body.user.background_url;
    await request(app)
      .post("/api/me/avatar")
      .set(as(leaving))
      .attach("file", await picture(300, 300), "me.jpg");
    const avatar = (await prisma.user.findUniqueOrThrow({ where: { id: leaving.id } })).avatarUrl!;
    const avatarFile = path.join(AVATARS, path.basename(avatar));
    expect(fs.existsSync(fileOf(url))).toBe(true);
    expect(fs.existsSync(avatarFile)).toBe(true);
    expect((await request(app).delete(`/api/admin/users/${leaving.id}`).set(as(admin))).status).toBe(200);
    expect(fs.existsSync(fileOf(url))).toBe(false);
    expect(fs.existsSync(avatarFile)).toBe(false);
  });
});

describe("a user's links", () => {
  it("are kept, each once", async () => {
    const res = await patch(me, {
      links: ["https://www.printables.com/@alex", " https://example.com/a ", "https://example.com/a"],
    });
    expect(res.status).toBe(200);
    expect(res.body.user.links).toEqual(["https://www.printables.com/@alex", "https://example.com/a"]);
    expect((await patch(me, { links: [] })).body.user.links).toEqual([]);
  });

  it("are refused past five, and when one isn't a web address", async () => {
    const six = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`);
    expect((await patch(me, { links: six })).status).toBe(400);
    for (const link of ["javascript:alert(1)", "not a link", "ftp://example.com/file"]) {
      expect((await patch(me, { links: [link] })).status).toBe(400);
    }
  });
});

describe("a user's own models, made public", () => {
  let owner: Account;
  let viewer: Account;
  let other: Account;
  const ids = {} as Record<"upload" | "design" | "imported" | "copy" | "othersImport", string>;
  const model = async (userId: string, label: string, data: object = {}) =>
    (
      await prisma.print.create({
        data: { userId, name: `${label} ${stamp}`, nameNormalized: `${label} ${stamp}`.toLowerCase(), ...data },
      })
    ).id;
  const listed = async (who: Account) => {
    const res = await request(app).get(`/api/explore/user/${owner.id}/models`).set(as(who));
    return { status: res.status, ids: res.status === 200 ? (res.body as { id: string }[]).map((m) => m.id) : [] };
  };
  const read = (who: Account, id: string) => request(app).get(`/api/print/${id}`).set(as(who));

  beforeAll(async () => {
    owner = await register("owner");
    viewer = await register("viewer");
    other = await register("other");
    await setSocialSettings({ enabled: true });
    const own = await upsertAuthorFromImport({
      provider: "printables",
      externalId: `own-${stamp}`,
      name: `Owner On Printables ${stamp}`,
      handle: null,
      bio: null,
      bioTranslated: null,
      links: [],
      avatarUrl: null,
      backgroundUrl: null,
    });
    const someoneElse = await upsertAuthorFromImport({
      provider: "makerworld",
      externalId: `else-${stamp}`,
      name: `Someone Else ${stamp}`,
      handle: null,
      bio: null,
      bioTranslated: null,
      links: [],
      avatarUrl: null,
      backgroundUrl: null,
    });
    await linkAuthorToUser(owner.id, own!.id);
    ids.upload = await model(owner.id, "uploaded");
    ids.design = await model(owner.id, "designed", {
      authorId: own!.id,
      sourceProvider: "printables",
      sourceExternalId: `design-${stamp}`,
    });
    ids.imported = await model(owner.id, "imported", {
      authorId: someoneElse!.id,
      sourceProvider: "makerworld",
      sourceExternalId: `imported-${stamp}`,
    });
    // Collected from the viewer: keeps its original's (empty) author, so it once listed as the owner's own.
    const viewersUpload = await model(viewer.id, "viewers upload");
    ids.copy = await model(owner.id, "collected", { copiedFromId: viewersUpload, originalId: viewersUpload });
    // The owner's design, imported by someone else: theirs, private as everything of theirs.
    ids.othersImport = await model(other.id, "others import", {
      authorId: own!.id,
      sourceProvider: "printables",
      sourceExternalId: `design-${stamp}`,
    });
  });

  it("leave out of My models a copy of someone else's model", async () => {
    const res = await request(app).get("/api/prints?author_id=self").set(as(owner));
    expect((res.body as { id: string }[]).map((m) => m.id).toSorted()).toEqual([ids.upload, ids.design].toSorted());
  });

  it("are private until their owner makes them public", async () => {
    expect((await listed(viewer)).status).toBe(404);
    expect((await read(viewer, ids.upload)).status).toBe(404);
    expect((await request(app).get(`/api/explore/user/${owner.id}`).set(as(viewer))).status).toBe(404);
    expect((await request(app).get(`/api/me`).set(as(owner))).body.user.models_public).toBe(false);
  });

  it("once public, are listed as My models lists them, and nothing else", async () => {
    expect((await patch(owner, { models_public: true })).body.user.models_public).toBe(true);
    const res = await request(app).get(`/api/explore/user/${owner.id}/models?limit=10`).set(as(viewer));
    expect(res.status).toBe(200);
    expect(res.headers["x-total-count"]).toBe("2");
    expect((res.body as { id: string }[]).map((m) => m.id).toSorted()).toEqual([ids.upload, ids.design].toSorted());
    expect(res.body[0].owner).toMatchObject({ id: owner.id });
  });

  it("can be opened by the others, but changed only by their owner", async () => {
    expect((await read(viewer, ids.upload)).status).toBe(200);
    expect((await read(viewer, ids.design)).status).toBe(200);
    expect((await read(viewer, ids.imported)).status).toBe(404);
    expect((await read(viewer, ids.copy)).status).toBe(404);
    const renamed = await request(app).post(`/api/print/${ids.upload}/meta`).set(as(viewer)).send({ name: "Mine now" });
    expect(renamed.status).toBe(404);
    expect((await request(app).delete(`/api/print/${ids.upload}`).set(as(viewer))).status).toBe(404);
    expect((await prisma.print.findUnique({ where: { id: ids.upload } }))?.name).toBe(`uploaded ${stamp}`);
  });

  it("don't make another user's import of the same design public", async () => {
    expect((await read(viewer, ids.othersImport)).status).toBe(404);
  });

  it("put their owner on Explore, with their models", async () => {
    const overview = await request(app).get("/api/explore").set(as(viewer));
    expect(overview.status).toBe(200);
    const person = (overview.body.people as { id: string; model_count: number }[]).find((p) => p.id === owner.id);
    expect(person?.model_count).toBe(2);
    const recent = (overview.body.recent_models as { id: string }[]).map((m) => m.id);
    expect(recent).toEqual(expect.arrayContaining([ids.upload, ids.design]));

    const page = await request(app).get(`/api/explore/user/${owner.id}`).set(as(viewer));
    expect(page.status).toBe(200);
    expect(page.body.user).toMatchObject({ models_public: true, model_count: 2, collection_count: 0 });
    expect(page.body.collections).toEqual([]);
  });

  it("go private again", async () => {
    await patch(owner, { models_public: false });
    expect((await listed(viewer)).status).toBe(404);
    expect((await read(viewer, ids.upload)).status).toBe(404);
    const overview = await request(app).get("/api/explore").set(as(viewer));
    expect((overview.body.people as { id: string }[]).some((p) => p.id === owner.id)).toBe(false);
  });
});

describe("a user's avatar", () => {
  const userOf = (who: Account) =>
    request(app)
      .get("/api/me")
      .set(as(who))
      .then((res) => res.body.user);
  // The body as bytes, whatever its type.
  const get = (url: string) =>
    request(app)
      .get(url)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });
  const gravatar = (answer: () => Promise<Response>) => vi.spyOn(globalThis, "fetch").mockImplementation(answer);
  const style = { hair: 3, hair_color: 2, glasses: -1, mouth: 4, background: 1 };

  afterEach(() => vi.restoreAllMocks());

  it("is a Thingport one picked for them while Gravatar has none, and Gravatar is asked once", async () => {
    const who = await register("no-gravatar");
    const fetched = gravatar(async () => new Response(null, { status: 404 }));
    const user = await userOf(who);
    expect(user).toMatchObject({
      avatar_source: "auto",
      avatar_style: null,
      avatar_picked_style: randomAvatarStyle(who.id),
    });
    expect(user.avatar_url).toMatch(new RegExp(`^/api/avatars/user/${who.id}\\?v=[a-f0-9]{12}$`));
    const served = await get(user.avatar_url);
    expect(served.headers["content-type"]).toContain("image/svg+xml");
    expect((served.body as Buffer).toString()).toContain("<svg");
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: who.id } })).email;
    const hash = crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
    expect(String(fetched.mock.calls[0][0])).toContain(`gravatar.com/avatar/${hash}`);
    await get(user.avatar_url);
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("is their Gravatar when they have one, served from here", async () => {
    const who = await register("gravatar");
    const png = await sharp({ create: { width: 80, height: 80, channels: 3, background: "#ff8800" } })
      .png()
      .toBuffer();
    gravatar(async () => new Response(new Uint8Array(png), { status: 200, headers: { "Content-Type": "image/png" } }));
    const served = await get((await userOf(who)).avatar_url);
    expect(served.headers["content-type"]).toBe("image/webp");
    expect((await sharp(served.body as Buffer).metadata()).width).toBe(256);
  });

  it("falls back to the one picked for them when Gravatar can't be reached", async () => {
    const who = await register("offline");
    gravatar(async () => {
      throw new TypeError("fetch failed");
    });
    const served = await get((await userOf(who)).avatar_url);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toContain("image/svg+xml");
  });

  it("can be designed, and any design previewed", async () => {
    const who = await register("designer");
    const before = (await userOf(who)).avatar_url;
    const res = await patch(who, { avatar_style: style });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ avatar_source: "thingport", avatar_style: style });
    expect(res.body.user.avatar_url).not.toBe(before);
    expect((await get(res.body.user.avatar_url)).headers["content-type"]).toContain("image/svg+xml");
    expect((await patch(who, { avatar_style: { ...style, mouth: 9 } })).status).toBe(400);
    expect((await patch(who, { avatar_style: style, avatar_auto: true })).status).toBe(400);

    const preview = await get("/api/avatars/thingport.svg?hair=-1&hair_color=0&glasses=4&mouth=2&background=7");
    expect(preview.status).toBe(200);
    expect((preview.body as Buffer).toString()).toContain("<svg");
    expect((await get("/api/avatars/thingport.svg?hair=12&hair_color=0&glasses=0&mouth=0&background=0")).status).toBe(
      400,
    );
  });

  it("can be a picture, cut square, which keeps their design for later and deletes the one it replaces", async () => {
    const who = await register("picture");
    await patch(who, { avatar_style: style });
    const first = await request(app)
      .post("/api/me/avatar")
      .set(as(who))
      .attach("file", await picture(800, 400), "a.jpg");
    expect(first.status).toBe(200);
    expect(first.body.user).toMatchObject({ avatar_source: "picture", avatar_style: style });
    const served = await get(first.body.user.avatar_url);
    expect(served.headers["content-type"]).toBe("image/webp");
    expect(await sharp(served.body as Buffer).metadata()).toMatchObject({ width: 512, height: 512 });
    const firstFile = path.join(
      AVATARS,
      path.basename((await prisma.user.findUniqueOrThrow({ where: { id: who.id } })).avatarUrl!),
    );

    await request(app)
      .post("/api/me/avatar")
      .set(as(who))
      .attach("file", await picture(300, 300), "b.jpg");
    expect(fs.existsSync(firstFile)).toBe(false);
    const secondFile = path.join(
      AVATARS,
      path.basename((await prisma.user.findUniqueOrThrow({ where: { id: who.id } })).avatarUrl!),
    );

    const back = await patch(who, { avatar_style: style });
    expect(back.body.user.avatar_source).toBe("thingport");
    expect(fs.existsSync(secondFile)).toBe(false);
    expect(
      (await request(app).post("/api/me/avatar").set(as(who)).attach("file", Buffer.from("no"), "x.jpg")).status,
    ).toBe(400);

    const auto = await patch(who, { avatar_auto: true });
    expect(auto.body.user).toMatchObject({ avatar_source: "auto", avatar_style: null });
  });

  it("is a linked author's picture once linked, unless they chose one, and only theirs", async () => {
    const who = await register("linked");
    const author = await upsertAuthorFromImport({
      provider: "printables",
      externalId: `avatar-${stamp}`,
      name: `Avatar Author ${stamp}`,
      handle: null,
      bio: null,
      bioTranslated: null,
      links: [],
      avatarUrl: "https://media.printables.com/avatar.jpg",
      backgroundUrl: null,
    });
    await linkAuthorToUser(who.id, author!.id);
    const linked = await userOf(who);
    expect(linked.avatar_source).toBe("picture");
    const served = await request(app).get(linked.avatar_url).redirects(0);
    expect(served.status).toBe(302);
    expect(served.headers.location).toBe("https://media.printables.com/avatar.jpg");

    await patch(who, { avatar_auto: true });
    const chosen = await patch(who, { avatar_author_id: author!.id });
    expect(chosen.body.user.avatar_source).toBe("picture");
    const stranger = await register("stranger");
    expect((await patch(stranger, { avatar_author_id: author!.id })).status).toBe(404);

    // A design of their own isn't overwritten by a later link.
    const designer = await register("keeps-design");
    await patch(designer, { avatar_style: style });
    const another = await upsertAuthorFromImport({
      provider: "makerworld",
      externalId: `avatar-2-${stamp}`,
      name: `Avatar Author Two ${stamp}`,
      handle: null,
      bio: null,
      bioTranslated: null,
      links: [],
      avatarUrl: "https://public-cdn.bblmw.com/avatar.jpg",
      backgroundUrl: null,
    });
    await linkAuthorToUser(designer.id, another!.id);
    expect((await userOf(designer)).avatar_source).toBe("thingport");
  });

  it("is what the others see of them, without their email", async () => {
    const who = await register("seen");
    const viewer = await register("seer");
    await setSocialSettings({ enabled: true });
    await patch(who, { models_public: true });
    await prisma.print.create({ data: { userId: who.id, name: `Seen ${stamp}`, nameNormalized: `seen ${stamp}` } });
    const page = await request(app).get(`/api/explore/user/${who.id}`).set(as(viewer));
    expect(page.status).toBe(200);
    expect(page.body.user.avatar_url).toBe((await userOf(who)).avatar_url);
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: who.id } })).email;
    expect(JSON.stringify(page.body)).not.toContain(email);
  });
});
