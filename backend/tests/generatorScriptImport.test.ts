import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// No pacing between MakerWorld calls here; config.ts reads it on load, so it's hoisted.
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

// Importing a model built from a script, in the two shapes MakerWorld actually answers in: the creator shared
// the script, or they marked it `protected` and the site hands out an empty download rather than refusing.

const app = createApp();
const stamp = Date.now();
let token: string;
const auth = () => ({ Authorization: `Bearer ${token}` });
const originalFetch = global.fetch;

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

const SCRIPT = 'base_width = 80;\r\ntext_color = "green"; // [white, red, green]\r\n';

function design(designId: string, scriptsProtected: boolean, profiles = true) {
  return {
    id: Number(designId),
    title: "Keychain Creator",
    modelId: `model-${designId}`,
    instances: profiles ? [{ id: "1", profileId: "9001", instanceCreator: { uid: 42 } }] : [],
    defaultInstanceId: "1",
    designCreator: { uid: 42, name: "A Creator" },
    designExtension: {
      model_files: [
        { modelName: "keychain.scad", modelType: "scad", modelUrl: "", scadStatus: 2, protected: scriptsProtected },
      ],
    },
  };
}

/** The raw-files zip, which for a withheld script MakerWorld still signs and still serves -- empty. */
async function zipOf(entries: Record<string, string>): Promise<Buffer> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer" });
}

function mockMakerworld(designId: string, scriptsProtected: boolean, zip: Buffer, profiles = true) {
  const fetched: string[] = [];
  global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
    const url = String(input);
    fetched.push(url);
    if (url === `https://api.bambulab.com/v1/design-service/design/${designId}`) {
      return json(design(designId, scriptsProtected, profiles));
    }
    if (url.includes(`/design/${designId}/model?modelType=all&type=download`)) {
      return json({ name: "", url: `https://s3.example.com/${designId}-all.zip` });
    }
    if (url.startsWith("https://api.bambulab.com/v1/iot-service/api/user/profile/")) {
      return json({ message: "success", url: `https://s3.example.com/${designId}.3mf`, filename: "keychain.3mf" });
    }
    if (url === `https://s3.example.com/${designId}.3mf`) {
      return new Response("solid keychain\nendsolid keychain\n", {
        headers: { "content-type": "application/octet-stream" },
      });
    }
    if (url === `https://s3.example.com/${designId}-all.zip`) {
      return new Response(zip as unknown as BodyInit, { headers: { "content-type": "application/zip" } });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return fetched;
}

async function importDesign(designId: string) {
  const res = await request(app)
    .post("/api/import")
    .set(auth())
    .send({ url: `https://makerworld.com/en/models/${designId}-keychain`, makerworld_cookie: "token=test-bearer" });
  expect(res.status).toBe(200);
  return res.body.print?.id ?? res.body.id;
}

describe("importing a model built from a script", () => {
  beforeAll(async () => {
    const res = await request(app)
      .post("/api/register")
      .send({
        displayName: "Generator Script Import",
        email: `generator-import-${stamp}@example.com`,
        password: "password123",
      });
    token = res.body.token;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("keeps a shared script, with its line endings put right", async () => {
    const designId = String((stamp % 1_000_000_000) + 1);
    mockMakerworld(designId, false, await zipOf({ "keychain.scad": SCRIPT }));
    const printId = await importDesign(designId);

    const print = (await request(app).get(`/api/print/${printId}`).set(auth())).body;
    expect(print.generator_scripts).toEqual([{ id: expect.any(String), filename: "keychain.scad" }]);
    expect(print.generator_script_withheld).toBe(false);

    const file = await request(app).get(`/api/print/${printId}/files/${print.generator_scripts[0].id}`).set(auth());
    expect(file.status).toBe(200);
    // Stored as Unix, or OpenSCAD's customizer would show none of the script's widgets.
    expect(file.text).toBe('base_width = 80;\ntext_color = "green"; // [white, red, green]\n');
  }, 120000);

  // A design with no print profiles downloads as the zip of its raw files, and a script-only model's zip holds
  // nothing to print. Removing that zip once it had given up its scripts left the model's own file pointing at
  // a file that was gone, and the import failed on a model that is otherwise perfectly importable.
  it("imports a model whose raw files are nothing but scripts", async () => {
    const designId = String((stamp % 1_000_000_000) + 3);
    mockMakerworld(designId, false, await zipOf({ "generator.scad": SCRIPT }), false);
    const printId = await importDesign(designId);

    const print = (await request(app).get(`/api/print/${printId}`).set(auth())).body;
    expect(print.generator_scripts).toEqual([{ id: expect.any(String), filename: "generator.scad" }]);
    // Nothing printable came in the zip, so the zip itself is the model's file.
    expect(print.plates.length).toBe(1);
  }, 120000);

  it("records why there is no script when the creator withheld it, and asks for nothing", async () => {
    const designId = String((stamp % 1_000_000_000) + 2);
    // Withheld, so nothing should ask for the raw files at all; an empty zip is what would come back.
    const fetched = mockMakerworld(designId, true, await zipOf({}));
    const printId = await importDesign(designId);

    const print = (await request(app).get(`/api/print/${printId}`).set(auth())).body;
    expect(print.generator_scripts).toEqual([]);
    expect(print.generator_script_withheld).toBe(true);
    // The model itself still imported.
    expect(print.plates.length).toBeGreaterThan(0);
    expect(fetched.some((url) => url.includes("modelType=all&type=download"))).toBe(false);
  }, 120000);
});
