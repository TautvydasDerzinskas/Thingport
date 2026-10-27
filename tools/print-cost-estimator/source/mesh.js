// Reads a model file into bare triangles: nine numbers a triangle (three vertices, x y z each), in millimetres, which
// is all geometry.js needs to measure a part. STL, OBJ and 3MF are read here; what a slicer exported is read by
// slicer.js instead, which knows the time and weight it already worked out.
//
// Nothing here uses the DOM, so the same code runs under node for the tests: the 3MF's XML is scanned with regular
// expressions rather than parsed, which machine-written 3MF holds up to and keeps a 100 MB model from needing a tree.

import { readZip } from "./zip.js";

/** A file that can't be measured, with a message written for the person who dropped it. */
export class MeshError extends Error {}

const MESH_EXTS = [".stl", ".obj", ".3mf"];
const DECODER = new TextDecoder();

/** Millimetres per unit, for the units 3MF allows. */
const UNITS = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

export const extensionOf = (name) => {
  const lower = String(name ?? "").toLowerCase();
  // ".gcode.3mf" is a sliced project, not a mesh, and is told apart by its name before its bytes are read.
  if (lower.endsWith(".gcode.3mf")) return ".gcode.3mf";
  const dot = lower.lastIndexOf(".");
  return dot < 0 ? "" : lower.slice(dot);
};

export const isMeshFile = (name) => MESH_EXTS.includes(extensionOf(name));

/* ------------------------------------------------------------------ STL */

/** Binary STL: an 80-byte header, the triangle count, then 50 bytes a triangle. */
function readBinaryStl(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  const triangles = new Float32Array(count * 9);
  for (let i = 0; i < count; i++) {
    // 12 bytes of face normal first, which is ignored: the normal is taken from the winding instead, as a file
    // written by a careless exporter may disagree with its own triangles.
    let at = 84 + i * 50 + 12;
    for (let v = 0; v < 9; v++, at += 4) triangles[i * 9 + v] = view.getFloat32(at, true);
  }
  return triangles;
}

/** ASCII STL: "facet normal …" blocks of three "vertex x y z" lines. */
function readAsciiStl(text) {
  const numbers = [];
  for (const [, x, y, z] of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi)) {
    numbers.push(parseFloat(x), parseFloat(y), parseFloat(z));
  }
  if (numbers.length < 9) throw new MeshError("This STL has no triangles in it.");
  // A stray vertex (a truncated download) would shift every triangle after it, so the tail is dropped.
  return new Float32Array(numbers.slice(0, numbers.length - (numbers.length % 9)));
}

/** Which of the two an .stl is: the size the triangle count implies is the only reliable test, as a binary STL may
 *  also begin with the word "solid". */
function readStl(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 84 && 84 + view.getUint32(80, true) * 50 === bytes.length) return readBinaryStl(bytes);
  const text = DECODER.decode(bytes);
  if (/^\s*solid/i.test(text) && /vertex/i.test(text)) return readAsciiStl(text);
  // Some exporters pad the file; trust the count when it at least fits.
  if (bytes.length >= 84 && 84 + view.getUint32(80, true) * 50 <= bytes.length) return readBinaryStl(bytes);
  throw new MeshError("This STL can't be read: it's neither a binary nor a text STL.");
}

/* ------------------------------------------------------------------ OBJ */

/** OBJ: "v x y z" vertices and "f" faces, which may be quads or longer and are split into a fan. */
function readObj(text) {
  const vertices = [];
  const triangles = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.charCodeAt(0) === 118 && line[1] === " ") {
      const [, x, y, z] = line.split(/\s+/);
      vertices.push(parseFloat(x), parseFloat(y), parseFloat(z));
    } else if (line.charCodeAt(0) === 102 && (line[1] === " " || line[1] === "\t")) {
      const corners = [];
      for (const part of line.slice(2).trim().split(/\s+/)) {
        // "f 1/2/3" is vertex/texture/normal; only the vertex is wanted, and a negative index counts from the end.
        const index = parseInt(part, 10);
        if (!Number.isFinite(index)) continue;
        corners.push(index > 0 ? index - 1 : vertices.length / 3 + index);
      }
      for (let i = 1; i + 1 < corners.length; i++) triangles.push(corners[0], corners[i], corners[i + 1]);
    }
  }
  if (!triangles.length) throw new MeshError("This OBJ has no faces in it.");
  const out = new Float32Array(triangles.length * 3);
  for (let i = 0; i < triangles.length; i++) {
    const at = triangles[i] * 3;
    if (at < 0 || at + 2 >= vertices.length) throw new MeshError("This OBJ points at vertices it doesn't have.");
    out[i * 3] = vertices[at];
    out[i * 3 + 1] = vertices[at + 1];
    out[i * 3 + 2] = vertices[at + 2];
  }
  return out;
}

/* ------------------------------------------------------------------ 3MF */

const attribute = (tag, name) => tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`))?.[1] ?? null;

/** A 3MF object's transform: twelve numbers, the rows of a 4×3 matrix, which multiply a point as a row vector. */
function parseTransform(text) {
  if (!text) return null;
  const n = text.trim().split(/\s+/).map(Number);
  return n.length === 12 && n.every(Number.isFinite) ? n : null;
}

function apply(m, x, y, z) {
  if (!m) return [x, y, z];
  return [
    x * m[0] + y * m[3] + z * m[6] + m[9],
    x * m[1] + y * m[4] + z * m[7] + m[10],
    x * m[2] + y * m[5] + z * m[8] + m[11],
  ];
}

function multiplyTransforms(outer, inner) {
  if (!outer) return inner;
  if (!inner) return outer;
  const out = new Array(12);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] =
        inner[row * 3] * outer[col] + inner[row * 3 + 1] * outer[3 + col] + inner[row * 3 + 2] * outer[6 + col];
    }
  }
  // The translation runs through the outer matrix too, then adds the outer's own.
  const [x, y, z] = apply(outer, inner[9], inner[10], inner[11]);
  out[9] = x;
  out[10] = y;
  out[11] = z;
  return out;
}

/** The objects of a 3MF model file, by id: each either a mesh or a list of components placed by transform.
 *
 *  The body is taken by finding the object's own closing tag rather than by one pattern over the whole element: a
 *  mesh is full of self-closing tags, and anything that stopped at the first of those would read one vertex and
 *  call the object empty. */
function parseObjects(xml) {
  const objects = new Map();
  const opening = /<object\b([^>]*)>/g;
  const closing = /<\/\s*object\s*>/g;
  for (let open = opening.exec(xml); open; open = opening.exec(xml)) {
    const id = attribute(open[1], "id");
    let block = "";
    // An object with no body at all is <object ... />, which holds nothing to read.
    if (!open[1].trimEnd().endsWith("/")) {
      closing.lastIndex = opening.lastIndex;
      const close = closing.exec(xml);
      block = xml.slice(opening.lastIndex, close ? close.index : xml.length);
      opening.lastIndex = close ? closing.lastIndex : xml.length;
    }
    if (!id) continue;
    const vertices = [];
    for (const [, tag] of block.matchAll(/<vertex\b([^>]*)\/?>/g)) {
      vertices.push(Number(attribute(tag, "x")), Number(attribute(tag, "y")), Number(attribute(tag, "z")));
    }
    const faces = [];
    for (const [, tag] of block.matchAll(/<triangle\b([^>]*)\/?>/g)) {
      faces.push(Number(attribute(tag, "v1")), Number(attribute(tag, "v2")), Number(attribute(tag, "v3")));
    }
    const components = [];
    for (const [, tag] of block.matchAll(/<component\b([^>]*)\/?>/g)) {
      const objectid = attribute(tag, "objectid");
      // A component may live in another model file inside the 3MF (the Production extension); those parts are read
      // from their own files, and a path that isn't there is left out rather than throwing.
      if (objectid)
        components.push({
          objectid,
          path: attribute(tag, "p:path"),
          transform: parseTransform(attribute(tag, "transform")),
        });
    }
    objects.set(id, { vertices, faces, components });
  }
  return objects;
}

/** The build's items: which objects are actually on the plate, and where. */
function parseItems(xml) {
  const items = [];
  const build = xml.match(/<build\b[\s\S]*?<\/\s*build\s*>/)?.[0];
  if (!build) return items;
  for (const [, tag] of build.matchAll(/<item\b([^>]*)\/?>/g)) {
    const objectid = attribute(tag, "objectid");
    if (objectid)
      items.push({ objectid, path: attribute(tag, "p:path"), transform: parseTransform(attribute(tag, "transform")) });
  }
  return items;
}

/**
 * A 3MF's triangles, in millimetres and in the places the build puts them. Every model file in the archive is read,
 * so a Bambu Studio project, whose parts each sit in their own file, comes out whole.
 */
async function readThreeMf(bytes) {
  const entries = await readZip(bytes);
  const modelFiles = [...entries.keys()].filter((name) => name.toLowerCase().endsWith(".model"));
  if (!modelFiles.length) throw new MeshError("This 3MF has no model in it.");
  // The root model is the one the package points at; "3D/3dmodel.model" is where every writer puts it.
  const rootName =
    modelFiles.find((name) => name.toLowerCase() === "3d/3dmodel.model") ??
    modelFiles.find((name) => !name.includes("Objects/")) ??
    modelFiles[0];

  const parsed = new Map();
  for (const name of modelFiles) {
    const xml = await entries.get(name).text();
    parsed.set(name, { xml, objects: parseObjects(xml), items: parseItems(xml) });
  }
  const root = parsed.get(rootName);
  const unit = attribute(root.xml.match(/<model\b[^>]*>/)?.[0] ?? "", "unit");
  const scale = UNITS[String(unit ?? "millimeter").toLowerCase()] ?? 1;

  // A path inside the package is absolute ("/3D/Objects/object_1.model"); the archive's names have no leading slash.
  const fileOf = (path) => {
    if (!path) return null;
    const wanted = path.replace(/^\//, "").toLowerCase();
    const name = [...parsed.keys()].find((key) => key.toLowerCase() === wanted);
    return name ? parsed.get(name) : null;
  };

  const out = [];
  let objectCount = 0;
  const seen = new Set();
  const walk = (file, objectid, transform, depth) => {
    const object = file?.objects.get(objectid);
    // A 3MF may name an object that isn't there, and components could in principle form a cycle.
    if (!object || depth > 12) return;
    const key = `${objectid}@${depth}`;
    if (object.faces.length) {
      objectCount++;
      const { vertices, faces } = object;
      for (let i = 0; i + 2 < faces.length; i += 3) {
        for (let corner = 0; corner < 3; corner++) {
          const at = faces[i + corner] * 3;
          const [x, y, z] = apply(transform, vertices[at], vertices[at + 1], vertices[at + 2]);
          out.push(x * scale, y * scale, z * scale);
        }
      }
    }
    for (const component of object.components) {
      if (seen.has(`${key}>${component.objectid}`)) continue;
      seen.add(`${key}>${component.objectid}`);
      walk(
        fileOf(component.path) ?? file,
        component.objectid,
        multiplyTransforms(transform, component.transform),
        depth + 1,
      );
    }
  };

  const items = root.items.length
    ? root.items
    : // No build section: measure every object that has a mesh, as a slicer would show them.
      [...root.objects.keys()].map((objectid) => ({ objectid, path: null, transform: null }));
  for (const item of items) walk(fileOf(item.path) ?? root, item.objectid, item.transform, 0);

  if (!out.length) throw new MeshError("This 3MF has no triangles in it: it may hold only a sliced plate.");
  return { triangles: new Float32Array(out), objects: objectCount, unit: unit ?? "millimeter" };
}

/* --------------------------------------------------------------- reading */

/**
 * A model file's triangles: `{ format, triangles, objects, unit }`, triangles being nine numbers each, in
 * millimetres. Throws a MeshError for a file this can't measure.
 */
export async function readMesh(input, name) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.length) throw new MeshError("This file is empty.");
  const extension = extensionOf(name);
  if (extension === ".3mf") {
    const mesh = await readThreeMf(bytes);
    return { format: "3MF", ...mesh };
  }
  if (extension === ".stl") return { format: "STL", triangles: readStl(bytes), objects: 1, unit: "millimeter" };
  if (extension === ".obj") {
    return { format: "OBJ", triangles: readObj(DECODER.decode(bytes)), objects: 1, unit: "millimeter" };
  }
  if (extension === ".step" || extension === ".stp") {
    throw new MeshError("STEP files hold shapes, not triangles. Export the part as an STL or 3MF and drop that.");
  }
  throw new MeshError(
    `${extension || "This file"} can't be measured. Drop an STL, OBJ or 3MF, or a file your slicer exported.`,
  );
}
