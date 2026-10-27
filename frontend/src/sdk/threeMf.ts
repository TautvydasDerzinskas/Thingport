// Writing a 3MF from a mesh.
//
// The OpenSCAD build Thingport carries has no 3MF export of its own, and what it does write is ASCII STL: three
// vertices spelled out per facet, every one of them repeated by each facet that touches it. A generated model of
// any size comes to tens of megabytes that way. A 3MF lists each vertex once and is a zip, so the same geometry
// is a fraction of it -- and it is the format Thingport keeps models in everywhere else.

import { zipSync, strToU8 } from "fflate";

export type Mesh = {
  /** Flat x, y, z triples. */
  vertices: Float64Array;
  /** Flat vertex-index triples. */
  triangles: Uint32Array;
};

/**
 * The OFF the engine writes, as a mesh.
 *
 * OFF faces are polygons, not triangles -- a plain cube comes out as six quads -- so each is fanned from its
 * first vertex. Convex faces are all OpenSCAD emits, which is what makes a fan safe.
 */
export function parseOff(text: string): Mesh {
  const tokens: string[] = [];
  for (const line of text.split("\n")) {
    const stripped = line.indexOf("#") >= 0 ? line.slice(0, line.indexOf("#")) : line;
    for (const token of stripped.trim().split(/\s+/)) if (token) tokens.push(token);
  }
  if (tokens[0] !== "OFF") throw new Error("That isn't OFF: the engine wrote something else.");

  const vertexCount = Number(tokens[1]);
  const faceCount = Number(tokens[2]);
  if (!Number.isInteger(vertexCount) || !Number.isInteger(faceCount)) {
    throw new Error("The OFF header doesn't say how big the mesh is.");
  }

  const vertices = new Float64Array(vertexCount * 3);
  let at = 4; // "OFF", three counts.
  for (let i = 0; i < vertexCount * 3; i++) vertices[i] = Number(tokens[at++]);

  const triangles: number[] = [];
  for (let face = 0; face < faceCount; face++) {
    const corners = Number(tokens[at++]);
    const indices: number[] = [];
    for (let i = 0; i < corners; i++) indices.push(Number(tokens[at++]));
    for (let i = 2; i < corners; i++) triangles.push(indices[0], indices[i - 1], indices[i]);
  }
  return { vertices, triangles: Uint32Array.from(triangles) };
}

/** Trims a coordinate to what a printer could tell apart, so the file isn't mostly trailing digits. */
function coordinate(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(5)));
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

/** The 3MF package for one mesh, as the bytes of a .3mf file. */
export function writeThreeMf(mesh: Mesh, { name = "model" }: { name?: string } = {}): Uint8Array {
  if (!mesh.triangles.length) throw new Error("There is nothing in the model to save.");

  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<model unit="millimeter" xml:lang="en-US"',
    ' xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n',
    ` <metadata name="Title">${escapeXml(name)}</metadata>\n`,
    ' <metadata name="Application">Thingport</metadata>\n',
    ' <resources>\n  <object id="1" type="model">\n   <mesh>\n    <vertices>\n',
  ];
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    parts.push(
      `     <vertex x="${coordinate(mesh.vertices[i])}" y="${coordinate(mesh.vertices[i + 1])}" z="${coordinate(
        mesh.vertices[i + 2],
      )}"/>\n`,
    );
  }
  parts.push("    </vertices>\n    <triangles>\n");
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    parts.push(
      `     <triangle v1="${mesh.triangles[i]}" v2="${mesh.triangles[i + 1]}" v3="${mesh.triangles[i + 2]}"/>\n`,
    );
  }
  parts.push("    </triangles>\n   </mesh>\n  </object>\n </resources>\n");
  parts.push(' <build>\n  <item objectid="1"/>\n </build>\n</model>\n');

  return zipSync({
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(RELS),
    "3D/3dmodel.model": strToU8(parts.join("")),
  });
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&${{ "<": "lt", ">": "gt", "&": "amp", '"': "quot", "'": "apos" }[c]};`);
}

/** The engine's OFF as a 3MF. */
export function offToThreeMf(off: string, options?: { name?: string }): Uint8Array {
  return writeThreeMf(parseOff(off), options);
}
