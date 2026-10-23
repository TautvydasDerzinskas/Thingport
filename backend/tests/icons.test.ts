import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { parseManifest } from "../src/services/customWidgetsService";
import { MCP_TOOLS } from "../src/mcp/tools";

const app = createApp();
const stamp = Date.now();
let token: string;
let userId: string;
const auth = () => ({ Authorization: `Bearer ${token}` });

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>';

beforeAll(async () => {
  const registered = (
    await request(app)
      .post("/api/register")
      .send({ displayName: "Icons", email: `icons-${stamp}@example.com`, password: "password123" })
  ).body;
  token = registered.token;
  userId = registered.user.id;
});

afterAll(async () => {
  await prisma.userIcon.deleteMany({ where: { userId } });
});

describe("uploaded icons", () => {
  it("keeps a picture as a small PNG, served publicly", async () => {
    const big = await sharp({ create: { width: 1024, height: 512, channels: 4, background: "#ff0000" } })
      .jpeg()
      .toBuffer();
    const uploaded = await request(app).post("/api/icons").set(auth()).attach("file", big, "logo.jpg");
    expect(uploaded.status).toBe(200);
    expect(uploaded.body).toMatchObject({
      name: "logo",
      url: expect.stringMatching(/^\/api\/icons\/[a-f0-9]{32}\.png$/),
    });

    const served = await request(app).get(uploaded.body.url);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");
    const meta = await sharp(served.body).metadata();
    expect([meta.width, meta.height]).toEqual([256, 128]);

    const listed = await request(app).get("/api/icons").set(auth());
    expect(listed.body.icons.map((icon: { id: string }) => icon.id)).toContain(uploaded.body.id);
  });

  it("serves an SVG under a policy that stops its scripts", async () => {
    const uploaded = await request(app).post("/api/icons").set(auth()).attach("file", Buffer.from(SVG), "mark.svg");
    expect(uploaded.body.url).toMatch(/\.svg$/);
    const served = await request(app).get(uploaded.body.url);
    expect(served.headers["content-type"]).toContain("image/svg+xml");
    expect(served.headers["content-security-policy"]).toContain("sandbox");
  });

  it("refuses what isn't an image, and an upload without an account", async () => {
    const text = await request(app).post("/api/icons").set(auth()).attach("file", Buffer.from("hello"), "a.png");
    expect(text.status).toBe(400);
    const anonymous = await request(app).post("/api/icons").attach("file", Buffer.from(SVG), "mark.svg");
    expect(anonymous.status).toBe(401);
    expect((await request(app).get("/api/icons/not-an-icon.png")).status).not.toBe(200);
  });

  it("deletes only the user's own, and its file with it", async () => {
    const uploaded = await request(app).post("/api/icons").set(auth()).attach("file", Buffer.from(SVG), "x.svg");
    const other = await request(app)
      .post("/api/register")
      .send({ displayName: "Other", email: `icons-other-${stamp}@example.com`, password: "password123" });
    const foreign = await request(app)
      .delete(`/api/icons/${uploaded.body.id}`)
      .set({ Authorization: `Bearer ${other.body.token}` });
    expect(foreign.status).toBe(404);
    expect((await request(app).delete(`/api/icons/${uploaded.body.id}`).set(auth())).status).toBe(204);
    expect((await request(app).get(uploaded.body.url)).status).toBe(404);
  });
});

describe("a custom widget's icon", () => {
  it("may be a built-in or uploaded icon, but no other path", () => {
    const manifest = (iconUrl: string) => JSON.stringify({ name: "W", iconUrl });
    expect(parseManifest(manifest("builtin:providers/printables")).iconUrl).toBe("builtin:providers/printables");
    expect(parseManifest(manifest(`/api/icons/${"a".repeat(32)}.svg`)).iconUrl).toMatch(/^\/api\/icons\//);
    expect(() => parseManifest(manifest("/etc/passwd"))).toThrow(/iconUrl/);
    expect(() => parseManifest(manifest("javascript:alert(1)"))).toThrow(/iconUrl/);
  });
});

describe("icons over MCP", () => {
  const tool = (name: string) => MCP_TOOLS.find((t) => t.name === name)!;
  const ctx = () => ({ userId, publicUrl: "" });

  it("finds Thingport's own icons by name or keyword", async () => {
    expect(tool("list_icons").readOnly).toBe(true);
    const { icons } = (await tool("list_icons").run(ctx(), { query: "countdown" })) as { icons: { value: string }[] };
    expect(icons.map((icon) => icon.value)).toContain("builtin:thingport/hourglass");
  });

  it("uploads an SVG, which list_icons then finds among the user's", async () => {
    expect(tool("upload_icon").readOnly).toBe(false);
    const uploaded = (await tool("upload_icon").run(ctx(), { name: "print farm", svg: SVG })) as { value: string };
    expect(uploaded.value).toMatch(/^\/api\/icons\/[a-f0-9]{32}\.svg$/);
    expect(parseManifest(JSON.stringify({ name: "W", iconUrl: uploaded.value })).iconUrl).toBe(uploaded.value);
    const { icons } = (await tool("list_icons").run(ctx(), { query: "farm" })) as {
      icons: { value: string; group: string }[];
    };
    expect(icons).toContainEqual(expect.objectContaining({ value: uploaded.value, group: "uploaded" }));
  });

  it("takes a picture as base64, and refuses both forms at once or neither", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#00b800" } })
      .png()
      .toBuffer();
    const uploaded = (await tool("upload_icon").run(ctx(), { name: "dot", base64: png.toString("base64") })) as {
      value: string;
    };
    expect(uploaded.value).toMatch(/\.png$/);
    await expect(tool("upload_icon").run(ctx(), { name: "x" })).rejects.toThrow(/svg|base64/);
    await expect(tool("upload_icon").run(ctx(), { name: "x", svg: SVG, base64: "AA==" })).rejects.toThrow(/svg|base64/);
  });
});
