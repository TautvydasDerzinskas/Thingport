import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import type { BufferGeometry, Group, Mesh } from "three";
import { describe, expect, it } from "vitest";
import { applyAffineToVertices, loadThreeMfGroup } from "../src/services/modelPreviewRender";

// Pure: no database.

// A quarter turn about Z, the way a 3MF writes one: a point is a row vector, x' = x*m00 + y*m10 + z*m20 + m30.
const QUARTER_TURN = "0 1 0 -1 0 0 0 0 1";

describe("3MF transforms in the 3D preview and pictures", () => {
  it("move a point as a row vector, the move last", () => {
    const moved = applyAffineToVertices(
      new Float32Array([1, 0, 0, 0, 1, 0]),
      `${QUARTER_TURN} 5 0 0`.split(" ").map(Number),
    );
    // A quarter turn anticlockwise: x goes to y, and y to -x.
    expect([...moved]).toEqual([5, 1, 0, 4, 0, 0]);
  });

  it("turn a part the way its object turns it", async () => {
    const zip = new JSZip();
    zip.file(
      "3D/3dmodel.model",
      `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model"><mesh>
   <vertices><vertex x="10" y="0" z="0"/><vertex x="0" y="0" z="0"/><vertex x="0" y="0" z="1"/></vertices>
   <triangles><triangle v1="0" v2="1" v3="2"/></triangles>
  </mesh></object>
  <object id="2" type="model"><components><component objectid="1" transform="${QUARTER_TURN} 0 0 0"/></components></object>
 </resources>
 <build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 100 50 0"/></build>
</model>`,
    );
    const file = path.join(os.tmpdir(), `turned-part-${Date.now()}.3mf`);
    fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
    try {
      const group = await loadThreeMfGroup(file);
      if (typeof group === "string") throw new Error(`refused: ${group}`);
      const meshes: Mesh[] = [];
      (group as Group).traverse((node) => {
        if ((node as Mesh).isMesh) meshes.push(node as Mesh);
      });
      expect(meshes).toHaveLength(1);
      const position = (meshes[0].geometry as BufferGeometry).getAttribute("position");
      // The triangle's edge from its corner at the origin to the one 10 mm along x points along +y once turned. The
      // preview is Y-up, as glTF is: the file's y is its -z.
      const edge = [position.getX(0) - position.getX(1), -(position.getZ(0) - position.getZ(1))];
      expect(edge[0]).toBeCloseTo(0, 5);
      expect(edge[1]).toBeCloseTo(10, 5);
      // And moved where the build item puts it.
      expect([position.getX(1), -position.getZ(1)]).toEqual([100, 50]);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});
