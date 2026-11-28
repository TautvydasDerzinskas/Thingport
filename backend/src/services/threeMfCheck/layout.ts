// A Bambu layout project's plates as the slicer prints them: each build item's printed parts where they are, the
// filaments they use, and their bounds on their plate. Read from the meshes, as nothing smaller says where an object
// ends.

import { paintStates } from "../../adapter/paint";
import { bedBoxOf, plateColumns, plateOrigin, type BedBox } from "../../adapter/printer";
import type { BambuPackage } from "../../adapter/readers/bambuProject";
import { asArray, firstValue } from "../../adapter/settings";
import { composeTransform, parseTransform } from "../../adapter/transform";
import { decodeXml, escapeXml, normalizePath, pathKey } from "../../adapter/xml";

export type Vec3 = [number, number, number];
export type Box3 = { min: Vec3; max: Vec3 };
export type Box2 = { minX: number; minY: number; maxX: number; maxY: number };

/** A mesh as its file has it, with the filaments its painting uses. */
/** A mesh as its file has it: the filaments its painting uses, and whether any of it is unpainted, printing in its
 *  part's own. */
export type Mesh = { positions: Float32Array; triangles: Uint32Array; painted: Set<number>; unpainted: boolean };
export type PlacedMesh = { mesh: Mesh; matrix: number[] };

export type LayoutItem = {
  /** Its place in the build. */
  index: number;
  objectId: string;
  /** Its place among its object's build items, which model_settings.config numbers instances by. */
  instance: number;
  /** Its object is in a model part of its own, not the main model, which a merge can't rewrite. */
  external: boolean;
  /** Some of its meshes are further down than its object's own components, whose part rows a merge can't match. */
  nested: boolean;
  name: string;
  /** Into the layout's plates. */
  plate: number;
  /** The parts it prints, in the bed's coordinates. */
  parts: PlacedMesh[];
  /** In the bed's coordinates, and in its plate's. */
  world: Box3;
  bounds: Box3;
  /** How far the slicer lowers it: it prints each object from the bed up, so one above the bed comes down onto it
   *  (and one partly below it is cut off there). */
  lift: number;
  filaments: Set<number>;
};

/** The heights an item prints between once the slicer has it on the bed. */
export function printedHeights(item: LayoutItem): [number, number] {
  return [Math.max(item.world.min[2] - item.lift, 0), item.world.max[2] - item.lift];
}

export type LayoutPlate = { items: LayoutItem[]; origin: [number, number] };

export type Layout = {
  /** One plate's printable area, in its own coordinates. */
  bed: BedBox;
  height: number | null;
  /** Areas of the bed nothing may print on. */
  exclude: Box2[];
  plates: LayoutPlate[];
};

export const DEFAULT_BED: BedBox = { minX: 0, minY: 0, maxX: 256, maxY: 256 };

type Component = { objectid: string; path: string | null; transform: string | null };
type FileObject = { mesh: Mesh | null; components: Component[] };

/** A tag's attributes up to its end: a `>` inside a quoted value doesn't end it, as XML allows one there. */
export const ATTRS = String.raw`(?:[^>"']|"[^"]*"|'[^']*')*?`;
const OBJECT_RE = new RegExp(String.raw`<object\b(${ATTRS})>([\s\S]*?)<\/object>`, "g");
const COMPONENT_RE = new RegExp(String.raw`<component\b(${ATTRS})\/?>`, "g");
const VERTEX_RE = /<vertex\b([^>]*?)\/?>/g;
const TRIANGLE_RE = /<triangle\b([^>]*?)\/?>/g;
const ITEM_RE = new RegExp(String.raw`<item\b(${ATTRS})\/?>`, "g");
const MAX_DEPTH = 8;

// Each attribute of a tag in turn, a quoted value taken whole, so text inside one is never read as another.
const ATTR_RE = /([^\s=/<>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** An attribute's value, in any of XML's ways: double- or single-quoted, spaced around the `=` or not, its entities
 *  and character references read. */
export function attrValue(tag: string, name: string): string | null {
  for (const m of tag.matchAll(ATTR_RE)) if (m[1] === name) return decodeXml(m[2] ?? m[3]);
  return null;
}

/** The tag with its attribute set to `value`, read as attrValue reads it, so only that attribute changes; added
 *  before the tag's end where it has none. */
export function withAttr(tag: string, name: string, value: string): string {
  const written = `${name}="${escapeXml(value)}"`;
  for (const m of tag.matchAll(ATTR_RE))
    if (m[1] === name) return tag.slice(0, m.index) + written + tag.slice(m.index + m[0].length);
  return tag.replace(/(\/?>)$/, ` ${written}$1`);
}

/** A vertex's or triangle's attribute: indexOf where it's written as writers write it, as a mesh has millions of
 *  tags, whose values are numbers and paint codes; otherwise read as any tag's. */
function meshAttr(tag: string, name: string): string | null {
  const key = `${name}="`;
  let at = tag.indexOf(key);
  while (at > 0 && !/\s/.test(tag[at - 1])) at = tag.indexOf(key, at + 1);
  if (at >= 0) {
    const start = at + key.length;
    const end = tag.indexOf('"', start);
    return end < 0 ? null : decodeXml(tag.slice(start, end));
  }
  return tag.includes(name) ? attrValue(tag, name) : null;
}

/** A vertex index: a whole number of one of the mesh's vertices, else null. */
function vertexIndex(value: string | null, count: number): number | null {
  const n = Number(value);
  return value !== null && value !== "" && Number.isInteger(n) && n >= 0 && n < count ? n : null;
}

function readMesh(body: string, paints: Map<string, number[]>): Mesh {
  const positions: number[] = [];
  const triangles: number[] = [];
  const painted = new Set<number>();
  let unpainted = false;
  let m;
  const vertices = new RegExp(VERTEX_RE.source, VERTEX_RE.flags);
  while ((m = vertices.exec(body)))
    positions.push(Number(meshAttr(m[1], "x")), Number(meshAttr(m[1], "y")), Number(meshAttr(m[1], "z")));
  const count = positions.length / 3;
  const faces = new RegExp(TRIANGLE_RE.source, TRIANGLE_RE.flags);
  while ((m = faces.exec(body))) {
    const a = vertexIndex(meshAttr(m[1], "v1"), count);
    const b = vertexIndex(meshAttr(m[1], "v2"), count);
    const c = vertexIndex(meshAttr(m[1], "v3"), count);
    if (a === null || b === null || c === null) continue;
    triangles.push(a, b, c);
    const paint = meshAttr(m[1], "paint_color");
    if (!paint) {
      unpainted = true;
      continue;
    }
    // Every filament a split triangle's pieces are in, which the tower is sized by.
    let states = paints.get(paint);
    if (states === undefined) {
      states = paintStates(paint);
      paints.set(paint, states);
    }
    for (const state of states) {
      if (state > 0) painted.add(state);
      else unpainted = true;
    }
  }
  return { positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles), painted, unpainted };
}

function readObjects(xml: string, paints: Map<string, number[]>): Map<string, FileObject> {
  const objects = new Map<string, FileObject>();
  const re = new RegExp(OBJECT_RE.source, OBJECT_RE.flags);
  let m;
  while ((m = re.exec(xml))) {
    const id = attrValue(m[1], "id");
    if (!id) continue;
    const body = m[2];
    const components: Component[] = [];
    const comps = new RegExp(COMPONENT_RE.source, COMPONENT_RE.flags);
    let c;
    while ((c = comps.exec(body))) {
      const objectid = attrValue(c[1], "objectid");
      if (objectid)
        components.push({
          objectid,
          path: attrValue(c[1], "p:path") ?? attrValue(c[1], "path"),
          transform: attrValue(c[1], "transform"),
        });
    }
    objects.set(id, { mesh: /<mesh[\s>]/.test(body) ? readMesh(body, paints) : null, components });
  }
  return objects;
}

/** The build's items as the main model lists them, each numbered among its object's. */
export function buildItems(rootXml: string) {
  const at = rootXml.lastIndexOf("<build");
  const build = at < 0 ? "" : rootXml.slice(at);
  const seen = new Map<string, number>();
  const items: {
    objectId: string;
    instance: number;
    transform: string | null;
    printable: boolean;
    /** The model part its object is in, where it isn't the main model (the production extension's `p:path`). */
    path: string | null;
  }[] = [];
  const re = new RegExp(ITEM_RE.source, ITEM_RE.flags);
  let m;
  while ((m = re.exec(build))) {
    const objectId = attrValue(m[1], "objectid");
    if (!objectId) continue;
    const instance = seen.get(objectId) ?? 0;
    seen.set(objectId, instance + 1);
    items.push({
      objectId,
      instance,
      transform: attrValue(m[1], "transform"),
      // As Bambu Studio reads it: "0" and "false" are left out, anything else or nothing prints.
      printable: !["0", "false"].includes(attrValue(m[1], "printable") ?? ""),
      path: attrValue(m[1], "p:path"),
    });
  }
  return items;
}

function emptyBox(): Box3 {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

/** `box` grown by the mesh's vertices where `matrix` puts them. */
function extend(box: Box3, { mesh, matrix: t }: PlacedMesh) {
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    const [x, y, z] = [p[i], p[i + 1], p[i + 2]];
    const out = [
      x * t[0] + y * t[3] + z * t[6] + t[9],
      x * t[1] + y * t[4] + z * t[7] + t[10],
      x * t[2] + y * t[5] + z * t[8] + t[11],
    ];
    for (let axis = 0; axis < 3; axis++) {
      if (out[axis] < box.min[axis]) box.min[axis] = out[axis];
      if (out[axis] > box.max[axis]) box.max[axis] = out[axis];
    }
  }
}

/** The bed's areas nothing may print on: Bambu Studio reads `bed_exclude_area` as rectangles of four points each. */
function excludedAreas(points: unknown): Box2[] {
  const list = asArray(points);
  const areas: Box2[] = [];
  for (let i = 0; i + 3 < list.length; i += 4) {
    const box = bedBoxOf(list.slice(i, i + 4));
    if (box) areas.push(box);
  }
  return areas;
}

/** The project's plates and what's printed on each. */
export async function readLayout(pkg: BambuPackage, fallbackBed?: BedBox | null): Promise<Layout> {
  const settings = pkg.config ?? {};
  const bed = bedBoxOf(settings.printable_area) ?? fallbackBed ?? DEFAULT_BED;
  const heightValue = Number(firstValue(settings.printable_height));
  const exclude = excludedAreas(settings.bed_exclude_area);

  const paints = new Map<string, number[]>();
  const files = new Map<string, Map<string, FileObject>>();
  const rootKey = pathKey(pkg.root.relativePath);
  const objectsIn = async (key: string) => {
    let objects = files.get(key);
    if (!objects) {
      const rec = pkg.filesByKey[key];
      objects = rec ? readObjects(await rec.entry.async("string"), paints) : new Map();
      files.set(key, objects);
    }
    return objects;
  };

  // The meshes under an object, each with the transform that places it, in the order the slicer makes its parts.
  const leaves = async (
    key: string,
    id: string,
    matrix: number[],
    depth: number,
    out: { id: string; placed: PlacedMesh; depth: number }[],
  ) => {
    const object = (await objectsIn(key)).get(id);
    if (!object || depth > MAX_DEPTH) return;
    if (object.mesh) out.push({ id, placed: { mesh: object.mesh, matrix }, depth });
    for (const c of object.components) {
      const child = c.path ? pathKey(normalizePath(c.path)) : key;
      await leaves(child, c.objectid, composeTransform(matrixString(matrix), c.transform), depth + 1, out);
    }
  };

  const rootXml = await pkg.root.entry.async("string");
  const plateCount = Math.max(pkg.plates.length, 1);
  const columns = plateColumns(plateCount);
  const plates: LayoutPlate[] = Array.from({ length: plateCount }, (_, i) => ({
    items: [],
    origin: plateOrigin(i, columns, bed),
  }));
  const plateOf = new Map<string, number>();
  pkg.plates.forEach((plate, i) => {
    for (const inst of plate.instances) plateOf.set(`${inst.objectId}:${inst.instanceId}`, i);
  });

  for (const [index, item] of buildItems(rootXml).entries()) {
    if (!item.printable) continue;
    const found: { id: string; placed: PlacedMesh; depth: number }[] = [];
    const start = item.path ? pathKey(normalizePath(item.path)) : rootKey;
    await leaves(start, item.objectId, parseTransform(item.transform), 0, found);
    // model_settings.config describes the main model's objects.
    const object = item.path ? undefined : pkg.modelSettings[item.objectId];
    const listed = object?.parts ?? [];
    const parts: PlacedMesh[] = [];
    const filaments = new Set<number>();
    found.forEach(({ id, placed }, i) => {
      // As the slicer matches them: the part at the same place, else the first with the mesh's id.
      const part = listed[i]?.id === id ? listed[i] : listed.find((p) => p.id === id);
      if (part && part.role !== "normal_part") return;
      parts.push(placed);
      // The part's own filament only where some of it isn't painted another.
      if (placed.mesh.unpainted) filaments.add(part?.extruder ?? object?.extruder ?? 1);
      for (const state of placed.mesh.painted) filaments.add(state);
    });
    if (!parts.length) continue;
    const world = emptyBox();
    for (const placed of parts) extend(world, placed);
    if (!Number.isFinite(world.min[0])) continue;
    const plate = plateOf.get(`${item.objectId}:${item.instance}`) ?? plateAt(world, plates, bed);
    const [ox, oy] = plates[plate].origin;
    plates[plate].items.push({
      index,
      objectId: item.objectId,
      instance: item.instance,
      external: Boolean(item.path),
      nested: found.some((leaf) => leaf.depth > 1),
      name: object?.name || `Object ${item.objectId}`,
      plate,
      parts,
      world,
      bounds: {
        min: [world.min[0] - ox, world.min[1] - oy, world.min[2]],
        max: [world.max[0] - ox, world.max[1] - oy, world.max[2]],
      },
      lift: Math.max(world.min[2], 0),
      filaments,
    });
  }
  return { bed, height: Number.isFinite(heightValue) && heightValue > 0 ? heightValue : null, exclude, plates };
}

const matrixString = (m: number[]) => m.join(" ");

/** The plate an item no plate lists is on: the one its middle is over, else the first. */
function plateAt(world: Box3, plates: LayoutPlate[], bed: BedBox): number {
  const x = (world.min[0] + world.max[0]) / 2;
  const y = (world.min[1] + world.max[1]) / 2;
  const found = plates.findIndex(
    ({ origin: [ox, oy] }) => x >= ox + bed.minX && x <= ox + bed.maxX && y >= oy + bed.minY && y <= oy + bed.maxY,
  );
  return Math.max(found, 0);
}
