// A plain 3MF, of no slicer's: meshes, and the colours the 3MF materials extension gives them, an object's own (its
// `pid` and `pindex`, into a colour group or base materials) and a triangle's (`pid` and `p1`). PrusaSlicer and Cura
// read none of them. This reads one as a Bambu layout package with a filament per colour, each object and part on its
// colour's and each triangle of another colour painted with its own, for the copies prusa.ts and cura.ts make.

import JSZip from "jszip";
import { encodePaintState } from "../paint";
import { formatNumber, formatTransform, parseTransform } from "../transform";
import { escapeXml, normalizePath, parseAttrs, pathKey } from "../xml";
import {
  indexZipFiles,
  NO_MODEL,
  parseModelSettings,
  parseModelXml,
  type BambuPackage,
  type ModelObject,
  type ObjectSettings,
  type ParsedModel,
  type PartSettings,
} from "./bambuProject";

// The most filaments a file's own numbering is taken up to.
const MAX_FILAMENTS = 64;

// Millimetres per unit (3MF core spec), which the copies are written in.
const UNITS: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

const GROUP_RE = /<(?:[\w-]+:)?(colorgroup|basematerials)\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?\1>/gi;
const OBJECT_RE = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
const TRIANGLE_RE = /<triangle\b([^>]*?)\/?>/gi;
const COLOUR_ATTRS = new Set(["pid", "p1", "p2", "p3"]);

/** "#RRGGBB" of a 3MF colour ("#RRGGBB" or "#RRGGBBAA"), or null. */
function colourValue(raw: string | undefined): string | null {
  const m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(String(raw ?? "").trim());
  return m ? `#${m[1].toUpperCase()}` : null;
}

/** Each colour group's and base materials' colours, by its id. */
function readColours(xml: string): Map<string, (string | null)[]> {
  const groups = new Map<string, (string | null)[]>();
  const re = new RegExp(GROUP_RE.source, GROUP_RE.flags);
  let m;
  while ((m = re.exec(xml))) {
    const id = parseAttrs(m[2]).id;
    if (!id) continue;
    const colorGroup = m[1].toLowerCase() === "colorgroup";
    const entryRe = colorGroup ? /<(?:[\w-]+:)?color\b([^>]*?)\/?>/gi : /<(?:[\w-]+:)?base\b([^>]*?)\/?>/gi;
    const colours: (string | null)[] = [];
    let e;
    while ((e = entryRe.exec(m[3]))) colours.push(colourValue(parseAttrs(e[1])[colorGroup ? "color" : "displaycolor"]));
    groups.set(id, colours);
  }
  return groups;
}

type ModelFile = {
  relativePath: string;
  xml: string;
  parsed: ParsedModel;
  colours: Map<string, (string | null)[]>;
  /** Each object's own attributes (name, pid, pindex), by id. */
  attrs: Map<string, Record<string, string>>;
  /** Each mesh's triangles' own colours, once read. */
  triangleColours: Map<string, string[]>;
};

/** An object's own colour: the one its `pid` and `pindex` name. */
function ownColour(file: ModelFile, id: string): string | null {
  const a = file.attrs.get(id);
  return a?.pid ? (file.colours.get(a.pid)?.[Number.parseInt(a.pindex ?? "0", 10) || 0] ?? null) : null;
}

/** A triangle's own colour, by its `p1` in its own `pid`'s group or its object's. */
function triangleColour(file: ModelFile, objectId: string, triangle: Record<string, string>): string | null {
  if (triangle.p1 === undefined) return null;
  const group = triangle.pid ?? file.attrs.get(objectId)?.pid ?? "";
  return file.colours.get(group)?.[Number.parseInt(triangle.p1, 10)] ?? null;
}

/** A mesh's triangles' own colours, each once, in order. */
function triangleColours(file: ModelFile, obj: ModelObject): string[] {
  const known = file.triangleColours.get(obj.id);
  if (known) return known;
  const out: string[] = [];
  if (/<triangle\b[^>]*\bp1\s*=/i.test(obj.body)) {
    const re = new RegExp(TRIANGLE_RE.source, TRIANGLE_RE.flags);
    let m;
    while ((m = re.exec(obj.body))) {
      const colour = triangleColour(file, obj.id, parseAttrs(m[1]));
      if (colour && !out.includes(colour)) out.push(colour);
    }
  }
  file.triangleColours.set(obj.id, out);
  return out;
}

function objectAttrs(xml: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  const re = /<object\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = parseAttrs(m[1]);
    if (attrs.id) out.set(attrs.id, attrs);
  }
  return out;
}

/** A model file in millimetres: its vertices and the moves in its transforms scaled, its unit said. */
function inMillimetres(xml: string): string {
  const unit = /<model\b[^>]*\bunit\s*=\s*"([^"]*)"/i.exec(xml)?.[1]?.toLowerCase() ?? "millimeter";
  const scale = UNITS[unit] ?? 1;
  if (scale === 1) return xml;
  const scaled = (value: string) => formatNumber((Number.parseFloat(value) || 0) * scale);
  return xml
    .replace(/(<model\b[^>]*\bunit\s*=\s*")[^"]*"/i, '$1millimeter"')
    .replace(/<vertex\b([^>]*?)\/?>/gi, (_tag: string, attrs: string) => {
      const a = parseAttrs(attrs);
      return `<vertex x="${scaled(a.x)}" y="${scaled(a.y)}" z="${scaled(a.z)}"/>`;
    })
    .replace(/(<(?:component|item)\b[^>]*\btransform\s*=\s*")([^"]*)"/gi, (_all, before: string, value: string) => {
      const m = parseTransform(value);
      for (const i of [9, 10, 11]) m[i] *= scale;
      return `${before}${formatTransform(m)}"`;
    });
}

export async function readPlainPackage(input: Uint8Array | JSZip): Promise<BambuPackage> {
  const zip = input instanceof JSZip ? input : await JSZip.loadAsync(input);
  const source = indexZipFiles(zip);
  if (!source["3d/3dmodel.model"]) throw new Error(NO_MODEL);
  const files = new Map<string, ModelFile>();
  for (const [key, rec] of Object.entries(source)) {
    if (!key.endsWith(".model")) continue;
    const xml = inMillimetres(await rec.entry.async("string"));
    files.set(key, {
      relativePath: rec.relativePath,
      xml,
      parsed: parseModelXml(xml),
      colours: readColours(xml),
      attrs: objectAttrs(xml),
      triangleColours: new Map(),
    });
  }
  const rootFile = files.get("3d/3dmodel.model") as ModelFile;

  // A filament per colour, numbered as they're first met from the build down, in the first number free.
  const palette: (string | undefined)[] = [];
  const extruderOf = (colour: string | null) => {
    if (!colour) return 0;
    if (!palette.includes(colour)) {
      const free = palette.findIndex((slot) => slot === undefined);
      if (free >= 0) palette[free] = colour;
      else palette.push(colour);
    }
    return palette.indexOf(colour) + 1;
  };
  const objectIn = (file: ModelFile, id: string) => file.parsed.objects.find((o) => o.id === id) ?? null;
  const fileOf = (path: string | null, from: ModelFile) =>
    path ? (files.get(pathKey(normalizePath(path))) ?? null) : from;

  // The colour each mesh's unpainted triangles print in: its part's, met first.
  const against = new Map<string, string | null>();
  // The first mesh's colour under an object, which its part prints in.
  const firstColour = (file: ModelFile, id: string, seen: Set<string>): string | null => {
    const mark = `${file.relativePath}::${id}`;
    const obj = objectIn(file, id);
    if (!obj || seen.has(mark)) return null;
    seen.add(mark);
    if (obj.hasMesh) return ownColour(file, id) ?? triangleColours(file, obj)[0] ?? null;
    for (const c of obj.components) {
      const child = fileOf(c.path, file);
      const colour = child ? firstColour(child, c.objectid, seen) : null;
      if (colour) return colour;
    }
    return null;
  };
  // Every mesh under an object gets the colour its unpainted triangles print in, and the colours are numbered.
  const visit = (file: ModelFile, id: string, part: string | null, seen: Set<string>) => {
    const mark = `${file.relativePath}::${id}`;
    const obj = objectIn(file, id);
    if (!obj || seen.has(mark)) return;
    seen.add(mark);
    if (obj.hasMesh) {
      if (!against.has(mark)) against.set(mark, part ?? ownColour(file, id));
      extruderOf(ownColour(file, id));
      for (const colour of triangleColours(file, obj)) extruderOf(colour);
      return;
    }
    for (const c of obj.components) {
      const child = fileOf(c.path, file);
      if (child) visit(child, c.objectid, part, new Set(seen));
    }
  };

  // A file that says which filament each object and part prints in keeps those numbers for their colours: Thingport's
  // own tools write Bambu Studio's model_settings.config beside their colours.
  const modelSettingsXml = source["metadata/model_settings.config"];
  const said = modelSettingsXml ? parseModelSettings(await modelSettingsXml.entry.async("string")) : {};
  const give = (objectId: string, extruder: number) => {
    const colour = firstColour(rootFile, objectId, new Set());
    if (colour && extruder > 0 && extruder <= MAX_FILAMENTS && !palette[extruder - 1] && !palette.includes(colour))
      palette[extruder - 1] = colour;
  };
  for (const [id, entry] of Object.entries(said)) {
    if (!entry.parts.length) give(id, entry.extruder);
    for (const part of entry.parts) {
      if (part.id) give(part.id, part.extruder);
    }
  }

  const items = rootFile.parsed.buildItems.length
    ? rootFile.parsed.buildItems.map((item) => item.objectid)
    : rootFile.parsed.objects.map((o) => o.id);
  const modelSettings: Record<string, ObjectSettings> = {};
  for (const id of items) {
    const obj = objectIn(rootFile, id);
    if (!obj || modelSettings[id]) continue;
    const name = rootFile.attrs.get(id)?.name ?? "";
    const parts: PartSettings[] = [];
    if (obj.hasMesh) visit(rootFile, id, null, new Set());
    for (const c of obj.hasMesh ? [] : obj.components) {
      const child = fileOf(c.path, rootFile);
      if (!child) continue;
      const colour = firstColour(child, c.objectid, new Set());
      visit(child, c.objectid, colour, new Set());
      parts.push({
        id: c.objectid,
        name: child.attrs.get(c.objectid)?.name ?? "",
        extruder: extruderOf(colour) || 1,
        role: "normal_part",
        settings: {},
      });
    }
    const extruder = extruderOf(obj.hasMesh ? (ownColour(rootFile, id) ?? firstColour(rootFile, id, new Set())) : null);
    modelSettings[id] = { id, name, extruder: extruder || parts[0]?.extruder || 1, parts, settings: {} };
  }

  // Model files with each triangle of another colour than its part's painted with its own, the materials' own
  // references gone (the writers give each triangle its filament's).
  const out = new JSZip();
  for (const file of files.values()) {
    const xml = paintedXml(file, (id) => against.get(`${file.relativePath}::${id}`) ?? null, extruderOf);
    out.file(file.relativePath, xml, { createFolders: false });
  }
  const thumbnail = source["metadata/thumbnail.png"];
  if (thumbnail) out.file(thumbnail.relativePath, await thumbnail.entry.async("uint8array"), { createFolders: false });
  const filesByKey = indexZipFiles(out);
  return {
    zip: out,
    filesByKey,
    root: filesByKey["3d/3dmodel.model"],
    config: null,
    // Only for the colours the copies show their filaments in; a number the file named but gave no colour is grey.
    settings: {
      filament_colour: Array.from(palette, (colour) => colour ?? "#808080"),
      filament_type: Array.from(palette, () => "PLA"),
    },
    modelSettingsXml: null,
    modelSettings,
    plates: [],
  };
}

function paintedXml(
  file: ModelFile,
  againstOf: (id: string) => string | null,
  extruderOf: (colour: string | null) => number,
): string {
  const chunks: string[] = [];
  let last = 0;
  const re = new RegExp(OBJECT_RE.source, OBJECT_RE.flags);
  let m;
  while ((m = re.exec(file.xml))) {
    const id = parseAttrs(m[1]).id;
    const body = m[2];
    if (!/<mesh[\s>]/i.test(body)) continue;
    const own = ownColour(file, id);
    const part = againstOf(id);
    const needs = /<triangle\b[^>]*\b(?:pid|p1)\s*=/i.test(body) || (own !== null && own !== part);
    if (!needs) continue;
    const painted = body.replace(new RegExp(TRIANGLE_RE.source, TRIANGLE_RE.flags), (_tag: string, attrs: string) => {
      const t = parseAttrs(attrs);
      const colour = triangleColour(file, id, t) ?? own;
      const kept = Object.entries(t).filter(([key]) => !COLOUR_ATTRS.has(key));
      const paint =
        colour && colour !== part && !t.paint_color && !t["slic3rpe:mmu_segmentation"]
          ? ` paint_color="${encodePaintState(extruderOf(colour))}"`
          : "";
      return `<triangle ${kept.map(([key, value]) => `${key}="${escapeXml(value)}"`).join(" ")}${paint}/>`;
    });
    // The body starts after `<object`, its attributes and `>`.
    const start = m.index + "<object".length + m[1].length + 1;
    chunks.push(file.xml.slice(last, start), painted);
    last = start + body.length;
  }
  chunks.push(file.xml.slice(last));
  return chunks.join("");
}
