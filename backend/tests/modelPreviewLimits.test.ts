import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

// Separate file because limits are read when config.ts loads. 1 MB is raised to the 8 MB floor (any lower and
// the worker can't start, which crashes the whole process on Node 24); 8 MB is still too little for a render.
vi.hoisted(() => {
  process.env.MODEL_PREVIEW_MAX_MEMORY_MB = "1";
});

const { writeZip } = await import("../src/utils/zipWriter");
const { generateModelPreviewGlb, modelPreviewGlbExists, modelPreviewGlbPath } =
  await import("../src/services/modelPreviewCache");

const MODEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter">
 <resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0" /><vertex x="10" y="0" z="0" /><vertex x="0" y="10" z="0" /></vertices><triangles><triangle v1="0" v2="1" v3="2" /></triangles></mesh></object></resources>
 <build><item objectid="1" /></build>
</model>
`;

describe("modelPreviewCache -- worker limits", () => {
  let fixture: string;
  const plateId = `test-fixture-limits-${Date.now()}`;
  const cacheDir = () => path.dirname(modelPreviewGlbPath("x"));

  beforeAll(async () => {
    await fs.mkdir(cacheDir(), { recursive: true });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-3mf-limits-"));
    const modelPath = path.join(dir, "3dmodel.model");
    await fs.writeFile(modelPath, MODEL_XML);
    fixture = path.join(dir, "limits.3mf");
    await writeZip(fixture, [{ arcname: "3D/3dmodel.model", filePath: modelPath }]);
  });

  afterAll(async () => {
    for (const ext of [".v3.glb", ".v3.error", ".pending"]) {
      await fs.rm(path.join(cacheDir(), `${plateId}${ext}`), { force: true });
    }
  });

  it("kills a render that exceeds its memory budget and keeps the server process alive", async () => {
    await generateModelPreviewGlb(plateId, fixture);
    expect(modelPreviewGlbExists(plateId)).toBe(false);
    const error = fsSync.readFileSync(path.join(cacheDir(), `${plateId}.v3.error`), "utf-8");
    expect(error).toMatch(/^permanent: (memory grew|worker heap exceeded)/);
    expect(fsSync.existsSync(path.join(cacheDir(), `${plateId}.pending`))).toBe(false);
    expect(fsSync.readdirSync(cacheDir()).some((f) => f.startsWith(plateId) && f.endsWith(".tmp"))).toBe(false);
  });

  it("does not retry a limit failure, even once the cooldown has passed", async () => {
    const errorPath = path.join(cacheDir(), `${plateId}.v3.error`);
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(errorPath, longAgo, longAgo);
    await generateModelPreviewGlb(plateId, fixture);
    // Untouched: a retry would have rewritten it.
    expect(Math.round(fsSync.statSync(errorPath).mtimeMs)).toBe(longAgo.getTime());
  });
});
