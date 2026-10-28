import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyThemeToObject, objectFromMesh, paletteForTheme } from "./modelLoaders";
import { hasOwnColor } from "./ownColor";
import { parseOff } from "../sdk/threeMf";

// A script that colours part of what it makes: two faces left alone, one painted red. The painted face keeps the
// colour the script gave it; the rest are a shape, so the theme's colour -- or the reader's -- is theirs.
const PART_COLORED = "OFF\n5 3 0\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n2 0 0\n3 0 1 2\n3 1 3 2\n3 1 4 2 255 0 0\n";
const ALL_COLORED = "OFF\n4 2 0\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n3 0 1 2 255 0 0\n3 1 3 2 0 255 0\n";

const meshOf = (off: string) => objectFromMesh(parseOff(off)) as THREE.Mesh;
// As hex, since the attribute holds the colour as float32 and a Color is float64.
const corner = (geometry: THREE.BufferGeometry, at: number) =>
  new THREE.Color().fromBufferAttribute(geometry.getAttribute("color") as THREE.BufferAttribute, at).getHexString();

describe("objectFromMesh", () => {
  it("gives the faces a script left uncoloured a material the recolouring reaches", () => {
    const object = meshOf(PART_COLORED);
    const [shape, own] = object.material as THREE.Material[];
    expect(hasOwnColor(shape)).toBe(false);
    expect(hasOwnColor(own)).toBe(true);
    // The uncoloured faces first, so each kind is one group: two triangles' corners, then the painted one's.
    expect(object.geometry.groups.map((group) => [group.start, group.count, group.materialIndex])).toEqual([
      [0, 6, 0],
      [6, 3, 1],
    ]);

    applyThemeToObject(object, paletteForTheme("dark"));
    expect(shape).toHaveProperty("color", paletteForTheme("dark").color);
    // White, so the attribute's colours come through it unchanged.
    expect((own as THREE.MeshStandardMaterial).color.getHexString()).toBe("ffffff");
  });

  it("keeps each face's colour with it where the triangles are regrouped", () => {
    const geometry = meshOf(PART_COLORED).geometry;
    for (const at of [0, 1, 2, 3, 4, 5]) expect(corner(geometry, at)).toBe("cccccc");
    for (const at of [6, 7, 8]) expect(corner(geometry, at)).toBe("ff0000");
  });

  it("leaves a model the script coloured throughout as one material of its own", () => {
    const object = meshOf(ALL_COLORED);
    expect(Array.isArray(object.material)).toBe(false);
    expect(hasOwnColor(object.material as THREE.Material)).toBe(true);
    expect(object.geometry.groups).toHaveLength(0);
  });
});
