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
  /**
   * The distinct colours the script gave the model, as "#rrggbb", or absent where it never coloured it.
   *
   * A palette with an index per triangle rather than a colour per triangle: colour arrives a region at a time
   * -- one `color()` call, one painted part -- so a model of a hundred thousand triangles has a handful of
   * colours, and this is the shape 3MF and a slicer's filament slots want anyway.
   */
  palette?: string[];
  /** One entry per triangle, indexing `palette`. Present whenever `palette` is. */
  colors?: Uint16Array;
  /**
   * The palette entry standing in for the faces the script never coloured, where it coloured some of them.
   *
   * Those faces have no colour of the model's own: they are a shape, like an uncoloured model's, so they are
   * drawn in the theme's colour or the reader's. The entry holds a plain grey for the formats that need every
   * face to name a colour, and this says which entry it is, which the colour alone can't (a script may name
   * that grey itself).
   */
  uncolored?: number;
};

/** The mesh's colours, in the form a caller that only wants to know "did the script colour this" can ask. */
export const isColored = (mesh: Mesh): boolean => (mesh.palette?.length ?? 0) > 0;

/** What a face the script never coloured is shown and saved as: OFF states no default, so a plain grey it is. */
const UNCOLORED = "#cccccc";

/**
 * The OFF the engine writes, as a mesh.
 *
 * OFF faces are polygons, not triangles -- a plain cube comes out as six quads -- so each is fanned from its
 * first vertex. Convex faces are all OpenSCAD emits, which is what makes a fan safe.
 */
export function parseOff(text: string): Mesh {
  // Line by line, because a face line may carry more than its corners: a script that uses `color()` makes the
  // engine write that face's red, green and blue after the indices. Read as one long run of numbers, the first
  // such colour is taken for the next face's corner count and everything after it is nonsense -- quietly, since
  // the numbers still parse. Lines are what tells a corner from a colour.
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const stripped = line.indexOf("#") >= 0 ? line.slice(0, line.indexOf("#")) : line;
    if (stripped.trim()) lines.push(stripped.trim());
  }

  let at = 0;
  const words = (index: number) => lines[index].split(/\s+/);
  // The header is "OFF", sometimes with the counts on the same line.
  const first = words(at);
  if (first[0] !== "OFF") throw new Error("That isn't OFF: the engine wrote something else.");
  let counts = first.slice(1);
  at += 1;
  if (counts.length < 3) {
    counts = words(at);
    at += 1;
  }

  const vertexCount = Number(counts[0]);
  const faceCount = Number(counts[1]);
  if (!Number.isInteger(vertexCount) || !Number.isInteger(faceCount)) {
    throw new Error("The OFF header doesn't say how big the mesh is.");
  }

  const vertices = new Float64Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++, at++) {
    const parts = words(at);
    vertices[i * 3] = Number(parts[0]);
    vertices[i * 3 + 1] = Number(parts[1]);
    vertices[i * 3 + 2] = Number(parts[2]);
  }

  const triangles: number[] = [];
  // Built as the faces are read: a model has a colour per `color()` call, not per face.
  const palette: string[] = [];
  // Whether any face carried a colour at all, which is what decides if there is a palette to keep: a model the
  // script never coloured is a shape, and a palette of nothing but the stand-in would read as a colour it asked
  // for.
  let painted = false;
  const indexOfColor = new Map<string, number>();
  const colors: number[] = [];
  const indexOf = (color: string) => {
    const known = indexOfColor.get(color);
    if (known !== undefined) return known;
    palette.push(color);
    indexOfColor.set(color, palette.length - 1);
    return palette.length - 1;
  };
  // A script can colour part of what it makes and leave the rest -- `cube(); color("red") sphere();` -- and the
  // faces it left have no colour on them at all. They get an entry of their own rather than falling to index 0,
  // which is whichever colour happened to be named first and has nothing to do with them. Kept out of
  // indexOfColor, so a script that names this very grey itself means that colour where it named it, and the
  // faces it left are still told apart from the ones it painted.
  let uncolored: number | null = null;
  const indexOfUncolored = () => {
    if (uncolored === null) {
      palette.push(UNCOLORED);
      uncolored = palette.length - 1;
    }
    return uncolored;
  };
  for (let face = 0; face < faceCount; face++, at++) {
    const parts = words(at);
    const corners = Number(parts[0]);
    // Anything past the corner count and its corners is that face's colour.
    const color = faceColor(parts.slice(corners + 1));
    if (color) painted = true;
    const index = color ? indexOf(color) : indexOfUncolored();
    // A polygon is fanned from its first corner. The engine merges coplanar triangles into one face, and the
    // shapes it merges them into are convex, so a fan covers them exactly. Each piece keeps the face's colour.
    for (let i = 2; i < corners; i++) {
      triangles.push(Number(parts[1]), Number(parts[i]), Number(parts[i + 1]));
      colors.push(index);
    }
  }
  const mesh: Mesh = { vertices, triangles: Uint32Array.from(triangles) };
  // A model the script never coloured carries no palette: its faces are a shape, and Thingport draws those in
  // the theme's colour (see utils/ownColor.ts). One `color()` over the whole of it is still a colour the script
  // asked for, so a palette of one is kept -- dropped, the model would be shown and saved as uncoloured.
  if (painted) {
    mesh.palette = palette;
    mesh.colors = Uint16Array.from(colors);
    if (uncolored !== null) mesh.uncolored = uncolored;
  }
  return mesh;
}

/**
 * A face's trailing numbers as a colour, or null where it has none.
 *
 * OFF writes red, green and blue after the corners, with alpha sometimes following. OpenSCAD writes them as
 * 0-255 whole numbers, but the format allows 0-1 fractions and other writers use them, so which it is comes
 * from the values themselves.
 */
function faceColor(parts: string[]): string | null {
  if (parts.length < 3) return null;
  const channels = parts.slice(0, 3).map(Number);
  if (channels.some((channel) => !Number.isFinite(channel))) return null;
  const fractional =
    channels.every((channel) => channel <= 1) && channels.some((channel) => !Number.isInteger(channel));
  const scale = fractional ? 255 : 1;
  const hex = channels
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel * scale))))
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
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

/** The id of the base-material group a coloured mesh's triangles point at; the object itself is 1. */
const MATERIALS_ID = 2;

/**
 * The 3MF package for one mesh, as the bytes of a .3mf file.
 *
 * A mesh with a palette is written as a base-material group, one material per colour, with each triangle
 * naming the one it belongs to. That is the core spec's own way of colouring a model, and it is what a slicer
 * reads to put each part on a filament.
 */
export function writeThreeMf(mesh: Mesh, { name = "model" }: { name?: string } = {}): Uint8Array {
  if (!mesh.triangles.length) throw new Error("There is nothing in the model to save.");
  const palette = mesh.palette ?? [];
  const faceColors = mesh.colors;
  const colored = palette.length > 0 && faceColors?.length === mesh.triangles.length / 3;
  // One colour over the whole model is the object's own material, which `pindex` already names: saying it
  // again on each triangle would only repeat it a hundred thousand times.
  const perTriangle = colored && palette.length > 1;

  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<model unit="millimeter" xml:lang="en-US"',
    ' xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n',
    ` <metadata name="Title">${escapeXml(name)}</metadata>\n`,
    ' <metadata name="Application">Thingport</metadata>\n',
    " <resources>\n",
  ];
  if (colored) {
    parts.push(`  <basematerials id="${MATERIALS_ID}">\n`);
    for (const [index, color] of palette.entries()) {
      // Opaque: OFF carries no alpha that OpenSCAD writes, and a slicer reads these as filament slots.
      parts.push(`   <base name="Colour ${index + 1}" displaycolor="${displayColor(color)}"/>\n`);
    }
    parts.push("  </basematerials>\n");
  }
  parts.push(
    colored
      ? `  <object id="1" type="model" pid="${MATERIALS_ID}" pindex="0">\n   <mesh>\n    <vertices>\n`
      : '  <object id="1" type="model">\n   <mesh>\n    <vertices>\n',
  );
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    parts.push(
      `     <vertex x="${coordinate(mesh.vertices[i])}" y="${coordinate(mesh.vertices[i + 1])}" z="${coordinate(
        mesh.vertices[i + 2],
      )}"/>\n`,
    );
  }
  parts.push("    </vertices>\n    <triangles>\n");
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    // p1 alone colours the whole triangle; p2 and p3 would blend it across the corners.
    const material = perTriangle && faceColors ? ` p1="${faceColors[i / 3]}"` : "";
    parts.push(
      `     <triangle v1="${mesh.triangles[i]}" v2="${mesh.triangles[i + 1]}" v3="${mesh.triangles[i + 2]}"${material}/>\n`,
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

/** A palette entry as 3MF writes a colour: #RRGGBB plus the alpha it always wants. */
function displayColor(color: string): string {
  const hex = color.replace("#", "").toUpperCase();
  return `#${hex.length === 8 ? hex : `${hex}FF`}`;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => `&${{ "<": "lt", ">": "gt", "&": "amp", '"': "quot", "'": "apos" }[c]};`);
}

/** The engine's OFF as a 3MF. */
export function offToThreeMf(off: string, options?: { name?: string }): Uint8Array {
  return writeThreeMf(parseOff(off), options);
}
