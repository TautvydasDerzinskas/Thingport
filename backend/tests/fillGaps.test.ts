import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// No pacing or DNS here. config.ts reads the pace on load, so it's hoisted.
vi.hoisted(() => {
  process.env.IMPORT_MAKERWORLD_CALL_DELAY_MS = "0";
});
vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { getThingiverseAccessToken, setThingiverseAccessToken } from "../src/providers/thingiverse/token";

const app = createApp();
const stamp = Date.now();
let token: string;
const auth = () => ({ Authorization: `Bearer ${token}` });
const originalFetch = global.fetch;

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
let previousThingiverseToken: string | null = null;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

function pngResponse(): Response {
  return new Response(Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"), {
    headers: { "content-type": "image/png" },
  });
}

const DESIGNER = { uid: 1692606088, name: "Deus Cat" };
/** Mutable so a re-import can see an updated page: what the source offers changes over time. */
const currentDesign = new Map<string, Record<string, unknown>>();
const currentThingFiles = new Map<string, string>(); // name -> file contents
let coverAvailable = true;

function setDesign(designId: string, overrides: Partial<Record<string, unknown>> = {}) {
  currentDesign.set(designId, {
    id: Number(designId),
    modelId: `US${designId}`,
    title: `Phoenix ${designId}`,
    summary: "<p>A phoenix.</p>",
    tags: ["phoenix"],
    coverUrl: "https://makerworld.bblmw.com/cover.jpg",
    designCreator: DESIGNER,
    defaultInstanceId: 2,
    instances: [
      { id: 1, profileId: 101, title: "Single-colour version", instanceCreator: DESIGNER },
      { id: 2, profileId: 102, title: "multi-colored version", instanceCreator: DESIGNER },
    ],
    ...overrides,
  });
}

const THING_ID = "8880001";

function mockFetch() {
  global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
    const url = String(input);
    const model = url.match(/^https:\/\/api\.bambulab\.com\/v1\/design-service\/design\/(\d+)/);
    if (model) return json(currentDesign.get(model[1]) ?? {});
    const profile = url.match(/^https:\/\/api\.bambulab\.com\/v1\/iot-service\/api\/user\/profile\/(\d+)/);
    if (profile)
      return json({
        message: "success",
        url: `https://s3.example.com/phoenix-${profile[1]}.stl`,
        filename: `phoenix-${profile[1]}.stl`,
      });
    const file = url.match(/^https:\/\/s3\.example\.com\/phoenix-(\d+)\.stl$/);
    if (file)
      return new Response(`solid phoenix-${file[1]}\nendsolid\n`, {
        headers: { "content-type": "application/octet-stream" },
      });
    if (url === "https://makerworld.bblmw.com/cover.jpg") {
      return coverAvailable ? pngResponse() : new Response("gone", { status: 404 });
    }
    if (url.startsWith(`https://api.thingiverse.com/things/${THING_ID}`)) {
      return json({
        id: Number(THING_ID),
        name: "Test Widget",
        description: "A widget.",
        tags: [{ name: "Widget" }],
        thumbnail: "https://cdn.thingiverse.com/assets/test/thumb.jpg",
        default_image: { url: "https://cdn.thingiverse.com/assets/test/preview.jpg" },
        categories_url: `https://api.thingiverse.com/things/${THING_ID}/categories`,
        creator: { id: 42, name: "TestCreator" },
        zip_data: {
          files: [...currentThingFiles.keys()].map((name) => ({
            name,
            url: `https://cdn.thingiverse.com/assets/test/${name}`,
          })),
          images: [{ name: "render.png", url: "https://cdn.thingiverse.com/renders/test/render.png" }],
        },
      });
    }
    if (url.startsWith(`https://api.thingiverse.com/things/${THING_ID}/categories`)) {
      return json([{ id: 129, name: "3D Printing Tests" }]);
    }
    const thingFile = url.match(/^https:\/\/cdn\.thingiverse\.com\/assets\/test\/(.+)$/);
    if (thingFile && currentThingFiles.has(thingFile[1])) {
      return new Response(currentThingFiles.get(thingFile[1]), {
        headers: { "content-type": "application/sla" },
      });
    }
    if (url.endsWith(".png") || url.endsWith(".jpg")) return pngResponse();
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

async function importMakerworldModel(designId: string, scope?: "url" | "designer" | "all") {
  const payload = {
    url: `https://makerworld.com/en/models/${designId}-phoenix`,
    makerworld_cookie: "token=test-bearer",
    ...(scope && scope !== "url" ? { scope } : {}),
  };
  const res =
    scope && scope !== "url"
      ? await request(app).post("/api/import/makerworld-profiles").set(auth()).send(payload)
      : await request(app).post("/api/import").set(auth()).send(payload);
  if (res.status === 202) {
    let job = (await request(app).get(`/api/import/jobs/${res.body.job_id}`).set(auth())).body;
    for (let i = 0; i < 100 && job.status === "RUNNING"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      job = (await request(app).get(`/api/import/jobs/${res.body.job_id}`).set(auth())).body;
    }
    return (await request(app).get(`/api/print/${job.result_print_id}`).set(auth())).body;
  }
  return res.body;
}

async function fillGaps(printId: string) {
  return request(app).post(`/api/print/${printId}/fill-gaps`).set(auth()).send({});
}

async function sourceGaps(printId: string): Promise<string[] | null> {
  return (await request(app).get(`/api/print/${printId}`).set(auth())).body.source_gaps;
}

describe("filling a model's missing details from its source", () => {
  beforeAll(async () => {
    const res = await request(app)
      .post("/api/register")
      .send({
        displayName: "Fill Gaps Test",
        email: `fillgaps-${stamp}@example.com`,
        password: "password123",
      });
    token = res.body.token;
    await request(app).patch("/api/settings/makerworld").set(auth()).send({ cookie: "token=test-bearer" });
    previousThingiverseToken = await getThingiverseAccessToken();
    await setThingiverseAccessToken("test-access-token");
    mockFetch();
  });

  afterAll(async () => {
    // Files share one database; leave the token as this file found it.
    await setThingiverseAccessToken(previousThingiverseToken);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mockFetch();
  });

  it("fills only the empty fields, never overwriting an edit", async () => {
    const designId = String(stamp % 1_000_000_000);
    setDesign(designId);
    const print = await importMakerworldModel(designId);

    // The user edits by hand, and the source later changes its own title, notes and tags.
    await prisma.print.update({
      where: { id: print.id },
      data: { title: "My own title", notes: null, tags: ["mine"] },
    });
    setDesign(designId, {
      title: "Phoenix Deluxe",
      summary: "<p>An updated description.</p>",
      tags: ["phoenix", "articulated"],
    });
    expect(await sourceGaps(print.id)).toContain("description");

    const res = await fillGaps(print.id);
    expect(res.status).toBe(200);
    expect(res.body.filled).toContain("description");

    const updated = await prisma.print.findUniqueOrThrow({ where: { id: print.id } });
    expect(updated.title).toBe("My own title"); // the edit wins
    expect(updated.notes).toBe("An updated description."); // the empty one is filled
    expect(updated.tags).toEqual(["mine"]); // tags aren't a gap while there are any
    expect(updated.creator).toBe("Deus Cat");
    expect(updated.authorId).not.toBeNull();
  });

  it("fills empty tags, in the casing an import gives them", async () => {
    const designId = String((stamp % 1_000_000_000) + 1);
    setDesign(designId, { tags: ["phoenix", "articulated"] });
    const print = await importMakerworldModel(designId);
    await prisma.print.update({ where: { id: print.id }, data: { tags: [] } });
    setDesign(designId, { tags: ["phoenix", "ARTICULATED", "Phoenix"] });

    const res = await fillGaps(print.id);
    expect(res.body.filled).toContain("tags");
    const updated = await prisma.print.findUniqueOrThrow({ where: { id: print.id } });
    expect(updated.tags.toSorted()).toEqual(["Articulated", "Phoenix"]);
  });

  it("stops offering gaps the source can't fill, until a new gap appears", async () => {
    const designId = String((stamp % 1_000_000_000) + 2);
    setDesign(designId);
    const print = await importMakerworldModel(designId);
    // The test user has no categories, so the source can never fill that one.
    expect(await sourceGaps(print.id)).toContain("category");

    const res = await fillGaps(print.id);
    expect(res.body.remaining).toContain("category");
    expect(await sourceGaps(print.id)).toEqual([]);
    const status = await request(app)
      .get(`/api/import/status?url=${encodeURIComponent(`https://makerworld.com/en/models/${designId}`)}`)
      .set(auth());
    expect(status.body.gaps).toEqual([]);
    const batch = await request(app)
      .post("/api/import/status/batch")
      .set(auth())
      .send({ provider: "makerworld", external_ids: [designId, "0"] });
    expect(batch.body.print_ids).toEqual({ [designId]: print.id });

    // Clearing a field the source does have opens a gap again.
    await prisma.print.update({ where: { id: print.id }, data: { notes: null } });
    expect(await sourceGaps(print.id)).toEqual(["description"]);
  });

  it("fills the image slots only while they are empty", async () => {
    const designId = String((stamp % 1_000_000_000) + 3);
    coverAvailable = false;
    setDesign(designId);
    const print = await importMakerworldModel(designId);
    expect(await prisma.previewImage.count({ where: { printId: print.id } })).toBe(0);
    expect(await sourceGaps(print.id)).toContain("images");

    coverAvailable = true;
    const res = await fillGaps(print.id);
    expect(res.body.filled).toContain("images");

    const count = await prisma.previewImage.count({ where: { printId: print.id } });
    expect(count).toBeGreaterThan(0);
    await fillGaps(print.id);
    expect(await prisma.previewImage.count({ where: { printId: print.id } })).toBe(count);
  });

  it("never adds files: the print profiles a model holds are the user's choice", async () => {
    const designId = String((stamp % 1_000_000_000) + 4);
    setDesign(designId);
    const print = await importMakerworldModel(designId);
    expect(print.plates).toHaveLength(1);
    await prisma.print.update({ where: { id: print.id }, data: { notes: null } });

    await fillGaps(print.id);
    expect(await prisma.plate.count({ where: { printId: print.id } })).toBe(1);
  });

  it("doesn't ask the source when there's nothing to fill", async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { email: `fillgaps-${stamp}@example.com` } });
    const print = await prisma.print.create({
      data: {
        userId: user.id,
        name: `complete-${stamp}`,
        nameNormalized: `complete-${stamp}`,
        title: "Complete",
        notes: "Has everything.",
        tags: ["done"],
        creator: "Someone",
        sourceProvider: "makerworld",
        sourceExternalId: String((stamp % 1_000_000_000) + 5),
        unfillableGaps: ["author", "category", "images"],
      },
    });
    const fetchSpy = vi.mocked(global.fetch);
    fetchSpy.mockClear();
    expect(await sourceGaps(print.id)).toEqual([]);
    const res = await fillGaps(print.id);
    expect(res.status).toBe(200);
    expect(res.body.filled).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still answers to the old reimport route used by older extensions", async () => {
    const designId = String((stamp % 1_000_000_000) + 6);
    setDesign(designId);
    const print = await importMakerworldModel(designId);
    await prisma.print.update({ where: { id: print.id }, data: { notes: null } });
    const res = await request(app)
      .post(`/api/print/${print.id}/reimport`)
      .set(auth())
      .send({ metadata: true, files: true, images: true });
    expect(res.status).toBe(200);
    expect(res.body.filled).toContain("description");
  });

  it("refuses a model with no recorded source", async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { email: `fillgaps-${stamp}@example.com` } });
    const print = await prisma.print.create({
      data: { userId: user.id, name: `no-source-${stamp}`, nameNormalized: `no-source-${stamp}` },
    });
    expect(await sourceGaps(print.id)).toEqual([]);
    const res = await fillGaps(print.id);
    expect(res.status).toBe(400);
  });
});
