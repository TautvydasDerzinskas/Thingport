import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeZip } from "../src/utils/zipWriter";
import { generateModelPreviewGlb, modelPreviewGlbExists, modelPreviewGlbPath } from "../src/services/modelPreviewCache";

// A hand-built 2-object/2-extruder/2-plate Bambu-style .3mf, small enough to commit as test
// data inline rather than shipping a binary fixture file. Exercises the same fast regex-based
// mesh extraction, extruder/plate resolution, and affine-transform + Z-up->Y-up rotation math the real
// (huge) repro file that motivated this feature goes through.
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

// Reproduces the real-world Bambu Studio pattern that broke both the original frontend parser
// and this file's first version: a "wrapper" object whose <components> references another
// same-document object (objectid, no p:path) rather than embedding its own <mesh>. Object 2 here
// has no mesh of its own -- all its geometry comes from resolving the internal reference to
// object 1, translated by the component's own transform.
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

// Vertex positions as plain numbers. `+ 0` turns the -0 the Z-up -> Y-up rotation produces for
// every vertex at 3MF y=0 (z = -y) into 0, which toEqual would otherwise treat as different.
function positionsOf(mesh: any): number[] {
  return Array.from(mesh.geometry.attributes.position.array as ArrayLike<number>, v => v + 0);
}

describe("modelPreviewCache", () => {
  let fixturePath: string;
  const plateId = `test-fixture-${Date.now()}`;

  beforeAll(async () => {
    // This test deliberately doesn't touch the database (unlike the other test files) -- it
    // only needs the model-previews cache directory, which the running app normally gets via
    // src/db.ts's startup side effect. Recreate that here so the test stays DB-independent.
    await fs.mkdir(path.dirname(modelPreviewGlbPath("x")), { recursive: true });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-3mf-out-"));
    fixturePath = path.join(dir, "fixture.3mf");
    await buildFixture3mf(fixturePath);
  });

  afterAll(async () => {
    await fs.rm(modelPreviewGlbPath(plateId), { force: true });
  });

  it("generates a GLB with both plates, correct colors, and correctly transformed geometry", async () => {
    await generateModelPreviewGlb(plateId, fixturePath);
    expect(modelPreviewGlbExists(plateId)).toBe(true);

    const THREE = await import("three");
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const buf = fsSync.readFileSync(modelPreviewGlbPath(plateId));
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

    const gltf = await new Promise<any>((resolve, reject) => {
      new GLTFLoader().parse(arrayBuffer, "", resolve, reject);
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
    expect(meta.filamentColors).toEqual(["#00B800", "#FF0000"]);
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

    // Object 1: identity transform, then the Z-up -> Y-up rotation (3MF x,y,z -> three.js x,z,-y).
    // A plain swap (x,z,y) would mirror the model and flip its triangle winding.
    expect(meshes["extruder-0"].positions).toEqual([0, 0, 0, 10, 0, 0, 0, 0, -10]);
    // Object 2: +50 X translation applied in 3MF space before the same rotation.
    expect(meshes["extruder-1"].positions).toEqual([50, 0, 0, 70, 0, 0, 50, 0, -20]);

    void THREE; // imported only to force-load three before GLTFLoader in some module graphs
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

    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const buf = fsSync.readFileSync(modelPreviewGlbPath(wrapperPlateId));
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

    const gltf = await new Promise<any>((resolve, reject) => {
      new GLTFLoader().parse(arrayBuffer, "", resolve, reject);
    });

    let root: any = null;
    gltf.scene.traverse((obj: any) => {
      if (obj.userData?.thingportPreview) root = obj;
    });
    expect(root).toBeTruthy();
    const meta = JSON.parse(root.userData.thingportPreview);
    // The wrapper object (id 2) has no <mesh> of its own -- its single mesh only exists because
    // the component reference to object 1 was resolved and merged in.
    expect(meta.plates).toEqual([{ index: 1, name: "Only plate", objectCount: 1 }]);

    const meshes: Record<string, { positions: number[] }> = {};
    gltf.scene.traverse((obj: any) => {
      if (obj.isMesh) {
        meshes[obj.name] = { positions: positionsOf(obj) };
      }
    });

    expect(Object.keys(meshes)).toEqual(["extruder-0"]);
    // Object 1's vertices, translated by the component's own +5 X transform (build item itself
    // is identity), then the Z-up -> Y-up rotation.
    expect(meshes["extruder-0"].positions).toEqual([5, 0, 0, 15, 0, 0, 5, 0, -10]);
  });
});
