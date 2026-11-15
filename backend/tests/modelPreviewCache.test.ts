import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import * as THREE from "three";
import type { Plate } from "@prisma/client";
import { toPlateOut } from "../src/dto";
import { writeZip } from "../src/utils/zipWriter";
import { Accessor, Document, NodeIO } from "@gltf-transform/core";
import {
  compressPreviewGlb,
  generateModelPreviewGlb,
  isPreviewCompressed,
  modelPreviewGlbExists,
  modelPreviewGlbPath,
  modelPreviewState,
} from "../src/services/modelPreviewCache";

// A small 2-object/2-extruder/2-plate Bambu-style .3mf.
const MODEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter">
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices>
     <vertex x="0" y="0" z="0" />
     <vertex x="10" y="0" z="0" />
     <vertex x="0" y="10" z="0" />
    </vertices>
    <triangles>
     <triangle v1="0" v2="1" v3="2" />
    </triangles>
   </mesh>
  </object>
  <object id="2" type="model">
   <mesh>
    <vertices>
     <vertex x="0" y="0" z="0" />
     <vertex x="20" y="0" z="0" />
     <vertex x="0" y="20" z="0" />
    </vertices>
    <triangles>
     <triangle v1="0" v2="1" v3="2" />
    </triangles>
   </mesh>
  </object>
 </resources>
 <build>
  <item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0" />
  <item objectid="2" transform="1 0 0 0 1 0 0 0 1 50 0 0" />
 </build>
</model>
`;

const MODEL_SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1">
    <metadata key="name" value="Part A"/>
    <metadata key="extruder" value="1"/>
  </object>
  <object id="2">
    <metadata key="name" value="Part B"/>
    <metadata key="extruder" value="2"/>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value="First plate"/>
    <model_instance><metadata key="object_id" value="1"/></model_instance>
  </plate>
  <plate>
    <metadata key="plater_id" value="2"/>
    <metadata key="plater_name" value="Second plate"/>
    <model_instance><metadata key="object_id" value="2"/></model_instance>
  </plate>
</config>
`;

const PROJECT_SETTINGS_JSON = JSON.stringify({
  filament_colour: ["#00B800", "#FF0000"],
  printable_area: ["0x0", "256x0", "256x256", "0x256"],
});

async function buildFixture3mf(destPath: string): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-3mf-fixture-"));
  const modelPath = path.join(dir, "3dmodel.model");
  const settingsPath = path.join(dir, "model_settings.config");
  const projectPath = path.join(dir, "project_settings.config");
  await fs.writeFile(modelPath, MODEL_XML);
  await fs.writeFile(settingsPath, MODEL_SETTINGS_XML);
  await fs.writeFile(projectPath, PROJECT_SETTINGS_JSON);
  await writeZip(destPath, [
    { arcname: "3D/3dmodel.model", filePath: modelPath },
    { arcname: "Metadata/model_settings.config", filePath: settingsPath },
    { arcname: "Metadata/project_settings.config", filePath: projectPath },
  ]);
}

// A wrapper object whose component references another object in the same document instead of
// having its own mesh.
const WRAPPER_MODEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter">
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices>
     <vertex x="0" y="0" z="0" />
     <vertex x="10" y="0" z="0" />
     <vertex x="0" y="10" z="0" />
    </vertices>
    <triangles>
     <triangle v1="0" v2="1" v3="2" />
    </triangles>
   </mesh>
  </object>
  <object id="2" type="model">
   <components>
    <component objectid="1" transform="1 0 0 0 1 0 0 0 1 5 0 0" />
   </components>
  </object>
 </resources>
 <build>
  <item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 0" />
 </build>
</model>
`;

const WRAPPER_MODEL_SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="2">
    <metadata key="name" value="Wrapper"/>
    <metadata key="extruder" value="1"/>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value="Only plate"/>
    <model_instance><metadata key="object_id" value="2"/></model_instance>
  </plate>
</config>
`;

async function buildWrapperFixture3mf(destPath: string): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-3mf-wrapper-fixture-"));
  const modelPath = path.join(dir, "3dmodel.model");
  const settingsPath = path.join(dir, "model_settings.config");
  const projectPath = path.join(dir, "project_settings.config");
  await fs.writeFile(modelPath, WRAPPER_MODEL_XML);
  await fs.writeFile(settingsPath, WRAPPER_MODEL_SETTINGS_XML);
  await fs.writeFile(projectPath, PROJECT_SETTINGS_JSON);
  await writeZip(destPath, [
    { arcname: "3D/3dmodel.model", filePath: modelPath },
    { arcname: "Metadata/model_settings.config", filePath: settingsPath },
    { arcname: "Metadata/project_settings.config", filePath: projectPath },
  ]);
}

// `+ 0` turns -0 into 0, which toEqual would treat as different.
// Positions as drawn: a packed preview stores them as integers across the mesh's bounds, with the scale and offset on
// the mesh's node, so they're read back through both and rounded well inside the 16-bit step.
function positionsOf(mesh: any): number[] {
  mesh.updateMatrix();
  const attribute = mesh.geometry.attributes.position;
  const out: number[] = [];
  for (let i = 0; i < attribute.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrix);
    out.push(...point.toArray().map((v) => Math.round(v * 100) / 100 + 0));
  }
  return out;
}

/** three's loader as the app's viewer sets it up, reading previews the server packed with meshopt. */
async function gltfLoader(): Promise<any> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import("three/examples/jsm/loaders/GLTFLoader.js"),
    import("meshoptimizer"),
  ]);
  await MeshoptDecoder.ready;
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}

/** The extensions a GLB's JSON chunk says it uses. */
function extensionsUsed(file: string): string[] {
  const buf = fsSync.readFileSync(file);
  return (JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString("utf-8")).extensionsUsed ?? []) as string[];
}

describe("modelPreviewCache", () => {
  let fixturePath: string;
  const plateId = `test-fixture-${Date.now()}`;

  beforeAll(async () => {
    // This test needs no database, only the cache directory db.ts normally creates.
    await fs.mkdir(path.dirname(modelPreviewGlbPath("x")), { recursive: true });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-3mf-out-"));
    fixturePath = path.join(dir, "fixture.3mf");
    await buildFixture3mf(fixturePath);
  });

  afterAll(async () => {
    await fs.rm(modelPreviewGlbPath(plateId), { force: true });
  });

  it("generates a GLB with both plates, correct colors, and correctly transformed geometry", async () => {
    // One of an earlier format, which nothing reads once the new one is there.
    const older = path.join(cacheDir(), `${plateId}.v4.glb`);
    await fs.writeFile(older, "older");
    await generateModelPreviewGlb(plateId, fixturePath);
    expect(modelPreviewGlbExists(plateId)).toBe(true);
    expect(fsSync.existsSync(older)).toBe(false);

    const loader = await gltfLoader();
    const buf = fsSync.readFileSync(modelPreviewGlbPath(plateId));
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

    const gltf = await new Promise<any>((resolve, reject) => {
      loader.parse(arrayBuffer, "", resolve, reject);
    });

    let root: any = null;
    gltf.scene.traverse((obj: any) => {
      if (obj.userData?.thingportPreview) root = obj;
    });
    expect(root).toBeTruthy();
    const meta = JSON.parse(root.userData.thingportPreview);
    expect(meta.plates).toEqual([
      { index: 1, name: "First plate", objectCount: 1 },
      { index: 2, name: "Second plate", objectCount: 1 },
    ]);
    // Normalized on the way in: Bambu writes these in either case and often with an alpha three.js can't read.
    expect(meta.filamentColors).toEqual(["#00b800", "#ff0000"]);
    expect(meta.buildVolume).toEqual({ x: 256, y: 256 });

    const meshes: Record<string, { color: string; positions: number[] }> = {};
    gltf.scene.traverse((obj: any) => {
      if (obj.isMesh) {
        meshes[obj.name] = {
          color: `#${obj.material.color.getHexString()}`,
          positions: positionsOf(obj),
        };
      }
    });

    expect(Object.keys(meshes).toSorted()).toEqual(["extruder-0", "extruder-1"]);
    expect(meshes["extruder-0"].color.toLowerCase()).toBe("#00b800");
    expect(meshes["extruder-1"].color.toLowerCase()).toBe("#ff0000");

    // Z-up -> Y-up rotation (x,y,z -> x,z,-y). A plain swap would mirror the model.
    expect(meshes["extruder-0"].positions).toEqual([0, 0, 0, 10, 0, 0, 0, 0, -10]);
    expect(meshes["extruder-1"].positions).toEqual([50, 0, 0, 70, 0, 0, 50, 0, -20]);
  });

  it("is idempotent -- a second call while the GLB already exists is a fast no-op", async () => {
    const before = fsSync.statSync(modelPreviewGlbPath(plateId)).mtimeMs;
    await generateModelPreviewGlb(plateId, fixturePath);
    const after = fsSync.statSync(modelPreviewGlbPath(plateId)).mtimeMs;
    expect(after).toBe(before);
  });
});

describe("modelPreviewCache -- internal <component> references", () => {
  let wrapperFixturePath: string;
  const wrapperPlateId = `test-fixture-wrapper-${Date.now()}`;

  beforeAll(async () => {
    await fs.mkdir(path.dirname(modelPreviewGlbPath("x")), { recursive: true });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-3mf-wrapper-out-"));
    wrapperFixturePath = path.join(dir, "wrapper.3mf");
    await buildWrapperFixture3mf(wrapperFixturePath);
  });

  afterAll(async () => {
    await fs.rm(modelPreviewGlbPath(wrapperPlateId), { force: true });
  });

  it("resolves geometry through a same-document <component objectid> reference with no p:path", async () => {
    await generateModelPreviewGlb(wrapperPlateId, wrapperFixturePath);
    expect(modelPreviewGlbExists(wrapperPlateId)).toBe(true);

    const loader = await gltfLoader();
    const buf = fsSync.readFileSync(modelPreviewGlbPath(wrapperPlateId));
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

    const gltf = await new Promise<any>((resolve, reject) => {
      loader.parse(arrayBuffer, "", resolve, reject);
    });

    let root: any = null;
    gltf.scene.traverse((obj: any) => {
      if (obj.userData?.thingportPreview) root = obj;
    });
    expect(root).toBeTruthy();
    const meta = JSON.parse(root.userData.thingportPreview);
    expect(meta.plates).toEqual([{ index: 1, name: "Only plate", objectCount: 1 }]);

    const meshes: Record<string, { positions: number[] }> = {};
    gltf.scene.traverse((obj: any) => {
      if (obj.isMesh) {
        meshes[obj.name] = { positions: positionsOf(obj) };
      }
    });

    expect(Object.keys(meshes)).toEqual(["extruder-0"]);
    // Translated by the component's +5 X, then rotated.
    expect(meshes["extruder-0"].positions).toEqual([5, 0, 0, 15, 0, 0, 5, 0, -10]);
  });
});

async function buildModelOnly3mf(destPath: string, modelXml: string): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-3mf-model-only-"));
  const modelPath = path.join(dir, "3dmodel.model");
  await fs.writeFile(modelPath, modelXml);
  await writeZip(destPath, [{ arcname: "3D/3dmodel.model", filePath: modelPath }]);
}

const ONE_TRIANGLE_MESH = `<mesh><vertices><vertex x="0" y="0" z="0" /><vertex x="10" y="0" z="0" /><vertex x="0" y="10" z="0" /></vertices><triangles><triangle v1="0" v2="1" v3="2" /></triangles></mesh>`;

function singleItemModelXml(objects: string, buildItemObjectId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter">
 <resources>${objects}</resources>
 <build><item objectid="${buildItemObjectId}" /></build>
</model>
`;
}

function fanOut(refId: string): string {
  return `<components>${Array.from({ length: 20 }, () => `<component objectid="${refId}" />`).join("")}</components>`;
}

describe("modelPreviewCache -- memory safety", () => {
  let outDir: string;
  const plateIds: string[] = [];
  const newPlateId = (label: string) => {
    const id = `test-fixture-${label}-${Date.now()}`;
    plateIds.push(id);
    return id;
  };

  beforeAll(async () => {
    await fs.mkdir(path.dirname(modelPreviewGlbPath("x")), { recursive: true });
    outDir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-3mf-safety-out-"));
  });

  afterAll(async () => {
    for (const id of plateIds) {
      for (const ext of [".v5.glb", ".v5.error", ".pending"]) {
        await fs.rm(path.join(path.dirname(modelPreviewGlbPath("x")), `${id}${ext}`), { force: true });
      }
    }
  });

  it("refuses a file whose rendered triangle count explodes through nested component references", async () => {
    // 64M rendered triangles from a few-KB file: must bail on the count, not by building geometry.
    let objects = `<object id="1" type="model">${ONE_TRIANGLE_MESH}</object>`;
    for (let id = 2; id <= 7; id++) objects += `<object id="${id}" type="model">${fanOut(String(id - 1))}</object>`;
    const fixture = path.join(outDir, "fanout.3mf");
    await buildModelOnly3mf(fixture, singleItemModelXml(objects, "7"));

    const plateId = newPlateId("fanout");
    await generateModelPreviewGlb(plateId, fixture);
    expect(modelPreviewGlbExists(plateId)).toBe(false);
    const errorPath = path.join(path.dirname(modelPreviewGlbPath("x")), `${plateId}.v5.error`);
    expect(fsSync.readFileSync(errorPath, "utf-8")).toBe("permanent: too-complex");
  });

  it("resolves a two-level wrapper chain to exactly one copy of the geometry", async () => {
    const objects =
      `<object id="1" type="model">${ONE_TRIANGLE_MESH}</object>` +
      `<object id="2" type="model"><components><component objectid="1" /></components></object>` +
      `<object id="3" type="model"><components><component objectid="2" /></components></object>`;
    const fixture = path.join(outDir, "chain.3mf");
    await buildModelOnly3mf(fixture, singleItemModelXml(objects, "3"));

    const plateId = newPlateId("chain");
    await generateModelPreviewGlb(plateId, fixture);
    expect(modelPreviewGlbExists(plateId)).toBe(true);

    const loader = await gltfLoader();
    const buf = fsSync.readFileSync(modelPreviewGlbPath(plateId));
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const gltf = await new Promise<any>((resolve, reject) => {
      loader.parse(arrayBuffer, "", resolve, reject);
    });
    const meshes: any[] = [];
    gltf.scene.traverse((obj: any) => {
      if (obj.isMesh) meshes.push(obj);
    });
    expect(meshes).toHaveLength(1);
    expect(positionsOf(meshes[0])).toEqual([0, 0, 0, 10, 0, 0, 0, 0, -10]);
  });

  it("never retries a plate whose previous generation died mid-run", async () => {
    const fixture = path.join(outDir, "crashed.3mf");
    await buildModelOnly3mf(
      fixture,
      singleItemModelXml(`<object id="1" type="model">${ONE_TRIANGLE_MESH}</object>`, "1"),
    );

    const plateId = newPlateId("crashed");
    await fs.writeFile(
      path.join(path.dirname(modelPreviewGlbPath("x")), `${plateId}.pending`),
      "left by a killed process",
    );
    await generateModelPreviewGlb(plateId, fixture);
    expect(modelPreviewGlbExists(plateId)).toBe(false);
  });

  it("removes its in-progress marker once generation finishes", async () => {
    const fixture = path.join(outDir, "ok.3mf");
    await buildModelOnly3mf(
      fixture,
      singleItemModelXml(`<object id="1" type="model">${ONE_TRIANGLE_MESH}</object>`, "1"),
    );

    const plateId = newPlateId("ok");
    await generateModelPreviewGlb(plateId, fixture);
    expect(modelPreviewGlbExists(plateId)).toBe(true);
    expect(fsSync.existsSync(path.join(path.dirname(modelPreviewGlbPath("x")), `${plateId}.pending`))).toBe(false);
  });
});

function cacheDir(): string {
  return path.dirname(modelPreviewGlbPath("x"));
}

function triangleAt(x: number): string {
  return `<mesh><vertices><vertex x="${x}" y="0" z="0" /><vertex x="${x + 10}" y="0" z="0" /><vertex x="${x}" y="10" z="0" /></vertices><triangles><triangle v1="0" v2="1" v3="2" /></triangles></mesh>`;
}

async function loadGlbMeshes(plateId: string): Promise<any[]> {
  const loader = await gltfLoader();
  const buf = fsSync.readFileSync(modelPreviewGlbPath(plateId));
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise<any>((resolve, reject) => {
    loader.parse(arrayBuffer, "", resolve, reject);
  });
  const meshes: any[] = [];
  gltf.scene.traverse((obj: any) => {
    if (obj.isMesh) meshes.push(obj);
  });
  return meshes;
}

describe("modelPreviewCache -- multi-part objects sharing one part file", () => {
  const plateIds: string[] = [];

  afterAll(async () => {
    for (const id of plateIds) {
      for (const ext of [".v5.glb", ".v5.error", ".pending"])
        await fs.rm(path.join(cacheDir(), `${id}${ext}`), { force: true });
    }
  });

  // Bambu Studio stores every part of a multi-part object in one file, referenced by objectid.
  it("takes only the referenced object from the file for each component, in its own colour", async () => {
    await fs.mkdir(cacheDir(), { recursive: true });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-3mf-parts-"));
    const mainPath = path.join(dir, "3dmodel.model");
    const partsPath = path.join(dir, "object_1.model");
    const settingsPath = path.join(dir, "model_settings.config");
    await fs.writeFile(
      mainPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" unit="millimeter">
 <resources><object id="9" type="model"><components>
  <component p:path="/3D/Objects/object_1.model" objectid="1" />
  <component p:path="/3D/Objects/object_1.model" objectid="2" />
 </components></object></resources>
 <build><item objectid="9" /></build>
</model>`,
    );
    await fs.writeFile(
      partsPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter"><resources>
 <object id="1" type="model">${triangleAt(0)}</object>
 <object id="2" type="model">${triangleAt(100)}</object>
</resources></model>`,
    );
    await fs.writeFile(
      settingsPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<config><object id="9"><metadata key="extruder" value="1"/>
 <part id="1" subtype="normal_part"><metadata key="extruder" value="1"/></part>
 <part id="2" subtype="normal_part"><metadata key="extruder" value="2"/></part>
</object></config>`,
    );
    const fixture = path.join(dir, "parts.3mf");
    await writeZip(fixture, [
      { arcname: "3D/3dmodel.model", filePath: mainPath },
      { arcname: "3D/Objects/object_1.model", filePath: partsPath },
      { arcname: "Metadata/model_settings.config", filePath: settingsPath },
    ]);

    const plateId = `test-fixture-parts-${Date.now()}`;
    plateIds.push(plateId);
    await generateModelPreviewGlb(plateId, fixture);
    expect(modelPreviewState(plateId)).toBe("ready");

    const meshes = await loadGlbMeshes(plateId);
    const byName = Object.fromEntries(meshes.map((m) => [m.name, positionsOf(m)]));
    expect(byName).toEqual({
      "extruder-0": [0, 0, 0, 10, 0, 0, 0, 0, -10],
      "extruder-1": [100, 0, 0, 110, 0, 0, 100, 0, -10],
    });
  });
});

describe("modelPreviewState", () => {
  const plateIds: string[] = [];
  const newPlateId = (label: string) => {
    const id = `test-fixture-state-${label}-${Date.now()}`;
    plateIds.push(id);
    return id;
  };

  afterAll(async () => {
    for (const id of plateIds) {
      for (const ext of [".v5.glb", ".v5.error", ".pending"])
        await fs.rm(path.join(cacheDir(), `${id}${ext}`), { force: true });
    }
  });

  it("says a too-heavy file failed, so the viewer won't parse it in the browser", async () => {
    let objects = `<object id="1" type="model">${ONE_TRIANGLE_MESH}</object>`;
    for (let id = 2; id <= 7; id++) objects += `<object id="${id}" type="model">${fanOut(String(id - 1))}</object>`;
    const fixture = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "thingport-state-")), "heavy.3mf");
    await buildModelOnly3mf(fixture, singleItemModelXml(objects, "7"));
    const plateId = newPlateId("heavy");
    await generateModelPreviewGlb(plateId, fixture);
    expect(modelPreviewState(plateId)).toBe("failed");
  });

  it("says a layout it can't read is unsupported, leaving it to the browser's loaders", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-state-"));
    const modelPath = path.join(dir, "model.model");
    await fs.writeFile(modelPath, singleItemModelXml(`<object id="1" type="model">${ONE_TRIANGLE_MESH}</object>`, "1"));
    const fixture = path.join(dir, "elsewhere.3mf");
    // Valid 3MF (the path comes from _rels/.rels), but not where this parser looks.
    await writeZip(fixture, [{ arcname: "3D/model.model", filePath: modelPath }]);
    const plateId = newPlateId("unsupported");
    await generateModelPreviewGlb(plateId, fixture);
    expect(modelPreviewState(plateId)).toBe("unsupported");
  });

  it("says generating while a render is queued or running", async () => {
    const fixture = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "thingport-state-")), "ok.3mf");
    await buildModelOnly3mf(
      fixture,
      singleItemModelXml(`<object id="1" type="model">${ONE_TRIANGLE_MESH}</object>`, "1"),
    );
    const plateId = newPlateId("running");
    const run = generateModelPreviewGlb(plateId, fixture);
    expect(modelPreviewState(plateId)).toBe("generating");
    await run;
    expect(modelPreviewState(plateId)).toBe("ready");
  });
});

describe("modelPreviewCache -- packing", () => {
  // Packing adds tables of its own, so a preview of a few triangles comes out bigger: one triangle, 0.5 KB to 1 KB.
  const ids: string[] = [];
  afterAll(async () => {
    for (const plateId of ids) await fs.rm(modelPreviewGlbPath(plateId), { force: true });
  });

  it("packs a new preview smaller once drawn, before the call returns", async () => {
    const vertices: string[] = [];
    const triangles: string[] = [];
    for (let i = 0; i < 500; i++) {
      vertices.push(
        `<vertex x="${i}" y="0" z="0" /><vertex x="${i + 1}" y="0" z="0" /><vertex x="${i}" y="1" z="${i % 7}" />`,
      );
      triangles.push(`<triangle v1="${3 * i}" v2="${3 * i + 1}" v3="${3 * i + 2}" />`);
    }
    const mesh = `<mesh><vertices>${vertices.join("")}</vertices><triangles>${triangles.join("")}</triangles></mesh>`;
    const fixture = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "thingport-pack-")), "strip.3mf");
    await buildModelOnly3mf(fixture, singleItemModelXml(`<object id="1" type="model">${mesh}</object>`, "1"));
    const plateId = `test-strip-${Date.now()}`;
    ids.push(plateId);
    await generateModelPreviewGlb(plateId, fixture);
    expect(extensionsUsed(modelPreviewGlbPath(plateId))).toContain("EXT_meshopt_compression");
  });

  it("keeps a new preview as drawn where packing would make it bigger", async () => {
    const fixture = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "thingport-pack-")), "tiny.3mf");
    await buildModelOnly3mf(
      fixture,
      singleItemModelXml(`<object id="1" type="model">${ONE_TRIANGLE_MESH}</object>`, "1"),
    );
    const plateId = `test-tiny-${Date.now()}`;
    ids.push(plateId);
    await generateModelPreviewGlb(plateId, fixture);
    const file = modelPreviewGlbPath(plateId);
    expect(await isPreviewCompressed(file, await fs.stat(file))).toBe(false);
  });

  it("leaves an older preview as it is where packing would make it bigger", async () => {
    const plateId = `test-tiny-old-${Date.now()}`;
    ids.push(plateId);
    const doc = new Document();
    const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]);
    const accessor = doc.createAccessor().setType(Accessor.Type.VEC3).setArray(positions).setBuffer(doc.createBuffer());
    const primitive = doc.createPrimitive().setAttribute("POSITION", accessor);
    doc.createScene().addChild(doc.createNode("preview").setMesh(doc.createMesh().addPrimitive(primitive)));
    const plain = await new NodeIO().writeBinary(doc);
    const file = modelPreviewGlbPath(plateId);
    await fs.writeFile(file, plain);

    expect(await compressPreviewGlb(file)).toEqual({ status: "skipped" });
    expect(new Uint8Array(await fs.readFile(file))).toEqual(plain);
  });
});

describe("a plate's 3D preview link", () => {
  it("is handed out unversioned where the preview goes between finding it and reading its time", async () => {
    const plateId = `test-link-${Date.now()}`;
    const file = modelPreviewGlbPath(plateId);
    await fs.writeFile(file, "glb");
    // Moved with its model, say, just after it was found.
    const statSync = fsSync.statSync;
    const spy = vi.spyOn(fsSync, "statSync").mockImplementation(((target: fsSync.PathLike, options?: never) => {
      if (String(target) === file) throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
      return statSync(target, options);
    }) as typeof fsSync.statSync);
    try {
      const plate = { id: plateId, filename: "part.3mf", position: 0, mime: "model/3mf", size: 3 } as Plate;
      expect(toPlateOut("print", plate, null).preview_glb_url).toBe(`/plate/${plateId}/preview.glb`);
    } finally {
      spy.mockRestore();
      await fs.rm(file, { force: true });
    }
  });
});
