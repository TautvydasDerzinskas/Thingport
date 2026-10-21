import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import request from "supertest";
import sharp from "sharp";
import JSZip from "jszip";

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
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";
import { selectMakerworldProfiles } from "../src/services/makerworldCloudApi";
import { plateThumbPath } from "../src/services/printService";
import { plateAssetHome } from "../src/services/modelAssets";
import { createAiConnection } from "../src/services/aiConnectionService";
import { DEFAULT_AI_DESCRIPTION_PREFS, setAiDescriptionPrefs } from "../src/services/settingsService";

const app = createApp();
const stamp = Date.now();
let token: string;
const auth = () => ({ Authorization: `Bearer ${token}` });
const originalFetch = global.fetch;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

const DESIGNER = { uid: 1692606088, name: "Deus Cat" };
/** Two designer profiles and two community ones. */
function design(designId: string) {
  return {
    id: Number(designId),
    modelId: `US${designId}`,
    title: "Articulated Phoenix",
    summary: "<p>A phoenix.</p>",
    tags: ["phoenix"],
    coverUrl: "https://makerworld.bblmw.com/phoenix/cover.jpg",
    designCreator: DESIGNER,
    defaultInstanceId: 2,
    instances: [
      {
        id: 1,
        profileId: 101,
        title: "Single-colour version",
        instanceCreator: DESIGNER,
        cover: "https://makerworld.bblmw.com/phoenix/101/instance/red.png",
      },
      {
        id: 2,
        profileId: 102,
        title: "multi-colored version",
        instanceCreator: DESIGNER,
        // No cover of its own: the first of its pictures stands in.
        pictures: [{ url: "https://makerworld.bblmw.com/phoenix/102/instance/blue.png" }],
      },
      { id: 3, profileId: 103, title: "Tail Color", instanceCreator: { uid: 740193827, name: "BlomsD" } },
      { id: 4, profileId: 104, title: "0.16mm layer", instanceCreator: { uid: 356629145, name: "gekkoace" } },
    ],
  };
}

const solid = (r: number, g: number, b: number) =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
const PROFILE_COVERS: Record<string, Promise<Buffer>> = {
  "https://makerworld.bblmw.com/phoenix/101/instance/red.png": solid(255, 0, 0),
  "https://makerworld.bblmw.com/phoenix/102/instance/blue.png": solid(0, 0, 255),
};

/** The thumbnail's average colour, which survives the JPEG re-encode. */
async function thumbColour(plateId: string): Promise<[number, number, number]> {
  const { channels } = await sharp(plateThumbPath(plateId, await plateAssetHome(plateId))).stats();
  return [channels[0].mean, channels[1].mean, channels[2].mean].map(Math.round) as [number, number, number];
}

describe("selectMakerworldProfiles", () => {
  const d = design("1");
  it("takes the link's profile, else the default -- a plain single import", () => {
    expect(selectMakerworldProfiles(d, "url", "3")).toEqual(["3"]);
    expect(selectMakerworldProfiles(d, "url", null)).toEqual(["2"]);
    expect(selectMakerworldProfiles(d, "url", "999")).toEqual(["2"]);
  });

  it("takes the designer's own profiles, the link's (or default) one first", () => {
    expect(selectMakerworldProfiles(d, "designer", null)).toEqual(["2", "1"]);
    // The link's profile comes first even when it's a community one.
    expect(selectMakerworldProfiles(d, "designer", "4")).toEqual(["4", "1", "2"]);
  });

  it("takes every profile", () => {
    expect(selectMakerworldProfiles(d, "all", null)).toEqual(["2", "1", "3", "4"]);
  });
});

describe("importing several MakerWorld print profiles", () => {
  beforeAll(async () => {
    const res = await request(app)
      .post("/api/register")
      .send({
        displayName: "Profiles Import Test",
        email: `mw-profiles-${stamp}@example.com`,
        password: "password123",
      });
    token = res.body.token;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  /** `sameName`: every profile's file comes named alike, as MakerWorld often does. */
  function mockMakerworld(designId: string, { sameName = false } = {}) {
    const fetched: string[] = [];
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      fetched.push(url);
      if (url === `https://api.bambulab.com/v1/design-service/design/${designId}`) return json(design(designId));
      const profile = url.match(/^https:\/\/api\.bambulab\.com\/v1\/iot-service\/api\/user\/profile\/(\d+)/);
      if (profile)
        return json({
          message: "success",
          url: `https://s3.example.com/phoenix-${profile[1]}.stl`,
          filename: sameName ? "phoenix.stl" : `phoenix-${profile[1]}.stl`,
        });
      const file = url.match(/^https:\/\/s3\.example\.com\/phoenix-(\d+)\.stl$/);
      if (file)
        return new Response(`solid phoenix-${file[1]}\nendsolid\n`, {
          headers: { "content-type": "application/octet-stream" },
        });
      if (PROFILE_COVERS[url]) {
        return new Response(await PROFILE_COVERS[url], { headers: { "content-type": "image/png" } });
      }
      if (url === "https://makerworld.bblmw.com/phoenix/cover.jpg") {
        return new Response(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            "base64",
          ),
          {
            headers: { "content-type": "image/png" },
          },
        );
      }
      return new Response("not found", { status: 404 }); // e.g. the author profile, behind Cloudflare
    }) as unknown as typeof fetch;
    return fetched;
  }

  async function runJob(designId: string, scope: "designer" | "all") {
    const start = await request(app)
      .post("/api/import/makerworld-profiles")
      .set(auth())
      .send({
        url: `https://makerworld.com/en/models/${designId}-articulated-phoenix`,
        scope,
        makerworld_cookie: "token=test-bearer",
      });
    expect(start.status).toBe(202);
    let job = (await request(app).get(`/api/import/jobs/${start.body.job_id}`).set(auth())).body;
    for (let i = 0; i < 100 && job.status === "RUNNING"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      job = (await request(app).get(`/api/import/jobs/${start.body.job_id}`).set(auth())).body;
    }
    return job;
  }

  it("imports every designer profile as one model with a file per profile", async () => {
    const designId = String(stamp % 1_000_000_000);
    mockMakerworld(designId);
    const job = await runJob(designId, "designer");
    expect(job).toMatchObject({
      status: "DONE",
      type: "PROFILES",
      total: 2,
      imported: 2,
      failed_count: 0,
      source_label: "Articulated Phoenix",
    });

    const print = await prisma.print.findUniqueOrThrow({
      where: { id: job.result_print_id },
      include: { plates: { orderBy: { position: "asc" } } },
    });
    // The default profile created the model, then the designer's other one.
    expect(print.plates.map((p) => [p.sourceInstanceId, p.filename])).toEqual([
      ["2", "phoenix-102.stl"],
      ["1", "phoenix-101.stl"],
    ]);
    // Each profile's file shows that profile's own picture, not the model's cover.
    const [blue, red] = await Promise.all(print.plates.map((p) => thumbColour(p.id)));
    expect(blue[2]).toBeGreaterThan(200);
    expect(blue[0]).toBeLessThan(60);
    expect(red[0]).toBeGreaterThan(200);
    expect(red[2]).toBeLessThan(60);
  });

  it("adds the community profiles to a model that already has the designer's", async () => {
    const designId = String(stamp % 1_000_000_000);
    mockMakerworld(designId);
    const job = await runJob(designId, "all");
    expect(job).toMatchObject({ status: "DONE", total: 4, imported: 2, already_in_library: 2, failed_count: 0 });
    const plates = await prisma.plate.findMany({ where: { printId: job.result_print_id } });
    expect(plates.map((p) => p.sourceInstanceId).toSorted()).toEqual(["1", "2", "3", "4"]);
  });

  it("names profile files that come named alike after their profiles", async () => {
    const designId = String((stamp % 1_000_000_000) + 1);
    mockMakerworld(designId, { sameName: true });
    await runJob(designId, "designer");
    const job = await runJob(designId, "all");
    expect(job).toMatchObject({ status: "DONE", failed_count: 0 });
    const plates = await prisma.plate.findMany({
      where: { printId: job.result_print_id },
      orderBy: { position: "asc" },
    });
    expect(plates.map((p) => [p.sourceInstanceId, p.filename])).toEqual([
      ["2", "phoenix - multi-colored version.stl"],
      ["1", "phoenix - Single-colour version.stl"],
      ["3", "phoenix - Tail Color.stl"],
      ["4", "phoenix - 0.16mm layer.stl"],
    ]);
    // The renamed first file moved on disk with its new name.
    expect(plates.every((p) => fs.existsSync(path.join(STORAGE, p.storagePath)))).toBe(true);
    expect(plates[0].storagePath.endsWith("phoenix - multi-colored version.stl")).toBe(true);
  });

  it("refuses a link that isn't a MakerWorld model", async () => {
    const res = await request(app)
      .post("/api/import/makerworld-profiles")
      .set(auth())
      .send({ url: "https://www.printables.com/model/1-x", scope: "all" });
    expect(res.status).toBe(400);
  });
});

describe("adding a profile the extension already resolved", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fetches just the file, not the MakerWorld model page again", async () => {
    const designId = String((stamp % 1_000_000_000) + 50);
    const fetched: string[] = [];
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      fetched.push(url);
      if (url.startsWith(`https://makerworld.com/en/models/${designId}`)) {
        return new Response("<html><head><title>Phoenix</title></head><body></body></html>", {
          headers: { "content-type": "text/html" },
        });
      }
      const file = url.match(/^https:\/\/s3\.example\.com\/ext-(\d+)\.stl$/);
      if (file)
        return new Response(`solid ext-${file[1]}\nendsolid\n`, {
          headers: { "content-type": "application/octet-stream" },
        });
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const importProfile = (instanceId: string) =>
      request(app)
        .post("/api/import")
        .set({ ...auth(), "X-Thingport-Client": "grab" })
        .send({
          url: `https://makerworld.com/en/models/${designId}-phoenix`,
          resolved_download_url: `https://s3.example.com/ext-${instanceId}.stl`,
          resolved_instance_id: instanceId,
        });
    expect((await importProfile("11")).status).toBe(200);
    const pageFetchesAfterFirst = fetched.filter((u) => u.startsWith("https://makerworld.com/en/models/")).length;
    const second = await importProfile("12");
    expect(second.status).toBe(200);
    expect(second.body.import_outcome).toBe("profile_added");
    expect(fetched.filter((u) => u.startsWith("https://makerworld.com/en/models/")).length).toBe(pageFetchesAfterFirst);
  });
});

describe("a MakerWorld model with no print profiles", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  /** Its raw files, as MakerWorld zips them: in the designer's folders, two of them holding a file named alike. */
  async function rawFilesZip(): Promise<Buffer> {
    const zip = new JSZip();
    zip.file("Holder_Top.stl", "solid top\nendsolid\n");
    zip.file("2x2 Version/Holder_Bottom.stl", "solid bottom 2x2\nendsolid\n");
    zip.file("3x2 Version/Holder_Bottom.stl", "solid bottom 3x2\nendsolid\n");
    zip.file("readme.txt", "not a model");
    return zip.generateAsync({ type: "nodebuffer" });
  }

  function mockRawFiles(designId: string) {
    const zipUrl = `https://makerworld.bblmw.com/makerworld/model/${designId}/mszipfile/all.zip`;
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url === `https://api.bambulab.com/v1/design-service/design/${designId}`) {
        return json({
          ...design(designId),
          title: "Paint Bottle Holder",
          modelId: "",
          defaultInstanceId: 0,
          instances: [],
        });
      }
      if (url.startsWith(`https://api.bambulab.com/v1/design-service/design/${designId}/model?`)) {
        return json({ name: "", url: zipUrl, highCompression: "" });
      }
      if (url === zipUrl) {
        return new Response(await rawFilesZip(), {
          headers: {
            "content-type": "application/zip",
            "content-disposition": "attachment;filename=Paint+Bottle+Holder.zip",
          },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    return zipUrl;
  }

  const EXPECTED_FILES = ["Holder_Top.stl", "2x2 Version - Holder_Bottom.stl", "3x2 Version - Holder_Bottom.stl"];

  async function filenamesOf(printId: string): Promise<string[]> {
    const plates = await prisma.plate.findMany({ where: { printId }, orderBy: { position: "asc" } });
    expect(plates.every((p) => p.sourceInstanceId === null)).toBe(true);
    return plates.map((p) => p.filename);
  }

  it("imports its raw files, unpacked, one file each", async () => {
    const designId = String((stamp % 1_000_000_000) + 100);
    mockRawFiles(designId);
    const res = await request(app)
      .post("/api/import")
      .set(auth())
      .send({ url: `https://makerworld.com/en/models/${designId}-paint-holder`, makerworld_cookie: "token=t" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Paint Bottle Holder");
    expect(await filenamesOf(res.body.id)).toEqual(EXPECTED_FILES);
  });

  it("unpacks the zip Grab resolved from the page's own download button too", async () => {
    const designId = String((stamp % 1_000_000_000) + 101);
    const zipUrl = mockRawFiles(designId);
    const res = await request(app)
      .post("/api/import")
      .set({ ...auth(), "X-Thingport-Client": "grab" })
      .send({
        url: `https://makerworld.com/en/models/${designId}-paint-holder`,
        resolved_download_url: zipUrl,
        resolved_instance_id: null,
        makerworld_design: { ...design(designId), title: "Paint Bottle Holder", instances: [] },
      });
    expect(res.status).toBe(200);
    expect(await filenamesOf(res.body.id)).toEqual(EXPECTED_FILES);
  });

  it("imports its raw files from an every-profile import instead of failing", async () => {
    const designId = String((stamp % 1_000_000_000) + 102);
    mockRawFiles(designId);
    const start = await request(app)
      .post("/api/import/makerworld-profiles")
      .set(auth())
      .send({
        url: `https://makerworld.com/en/models/${designId}-paint-holder`,
        scope: "all",
        makerworld_cookie: "token=t",
      });
    expect(start.status).toBe(202);
    let job = (await request(app).get(`/api/import/jobs/${start.body.job_id}`).set(auth())).body;
    for (let i = 0; i < 100 && job.status === "RUNNING"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      job = (await request(app).get(`/api/import/jobs/${start.body.job_id}`).set(auth())).body;
    }
    expect(job).toMatchObject({ status: "DONE", total: 1, imported: 1, failed_count: 0 });
    expect(await filenamesOf(job.result_print_id)).toEqual(EXPECTED_FILES);
  });
});

describe("Improved descriptions on import", () => {
  let provider: http.Server | null = null;
  const prompts: string[] = [];

  afterEach(async () => {
    global.fetch = originalFetch;
    await setAiDescriptionPrefs({ ...DEFAULT_AI_DESCRIPTION_PREFS });
    await prisma.aiConnection.deleteMany();
    provider?.closeAllConnections?.();
    await new Promise<void>((resolve) => (provider ? provider.close(() => resolve()) : resolve()));
    provider = null;
  });

  /** An AI provider that tidies the description, keeping the image it was given. */
  async function startProvider(): Promise<string> {
    prompts.length = 0;
    provider = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        messages: { content: { type: string; text?: string }[] }[];
      };
      const prompt = body.messages[0].content.find((part) => part.type === "text")?.text ?? "";
      prompts.push(prompt);
      const image = prompt.match(/\/description-image\/[a-z0-9]+|https:\/\/makerworld\.bblmw\.com\/[^\s)]+/)?.[0];
      const description = `A tidied phoenix. ![photo](${image})`;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ changed: true, description }) }, finish_reason: "stop" }],
        }),
      );
    });
    await new Promise<void>((resolve) => provider!.listen(0, "127.0.0.1", resolve));
    const address = provider.address();
    if (!address || typeof address === "string") throw new Error("Provider did not bind a TCP port");
    return `http://127.0.0.1:${address.port}/v1`;
  }

  it("checks the description once the import is done, with its images stored locally", async () => {
    const baseUrl = await startProvider();
    await createAiConnection({
      baseUrl,
      apiKey: null,
      model: "local",
      timeoutMs: 2000,
      concurrency: 1,
      reasoningEffort: null,
    });
    await setAiDescriptionPrefs({ ...DEFAULT_AI_DESCRIPTION_PREFS, enabled: true, onImport: true, mode: "suggest" });

    const designId = String((stamp % 1_000_000_000) + 200);
    const photoUrl = "https://makerworld.bblmw.com/phoenix/summary.png";
    const png = await solid(0, 128, 0);
    global.fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:")) return originalFetch(input, init);
      if (url === `https://api.bambulab.com/v1/design-service/design/${designId}`) {
        return json({
          ...design(designId),
          summary: `<p>A phoenix.</p><p><img src="${photoUrl}"></p>`,
          instances: [design(designId).instances[0]],
          defaultInstanceId: 1,
        });
      }
      if (url.startsWith("https://api.bambulab.com/v1/iot-service/api/user/profile/")) {
        return json({ message: "success", url: "https://s3.example.com/phoenix.stl", filename: "phoenix.stl" });
      }
      if (url === "https://s3.example.com/phoenix.stl") {
        return new Response("solid phoenix\nendsolid\n", { headers: { "content-type": "application/octet-stream" } });
      }
      if (url === photoUrl) return new Response(png, { headers: { "content-type": "image/png" } });
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const res = await request(app)
      .post("/api/import")
      .set(auth())
      .send({ url: `https://makerworld.com/en/models/${designId}-phoenix`, makerworld_cookie: "token=t" });
    expect(res.status).toBe(200);

    let suggestion: { notes?: string } | null = null;
    for (let i = 0; i < 100 && !suggestion; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const print = await prisma.print.findUniqueOrThrow({ where: { id: res.body.id } });
      suggestion = print.aiDescriptionSuggestion as { notes?: string } | null;
    }
    // Asked once, about the description as imported: its image already the model's own copy.
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatch(/\/description-image\//);
    expect(prompts[0]).not.toContain(photoUrl);
    expect(suggestion?.notes).toMatch(/^A tidied phoenix\. !\[photo\]\(\/description-image\/[a-z0-9]+\)$/);
  });
});
