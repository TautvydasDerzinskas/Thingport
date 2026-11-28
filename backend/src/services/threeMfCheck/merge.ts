// Objects that print into each other made one object with a part for each, as Bambu Studio keeps a multi-colour
// model: it slices an object's parts together, and separate objects apart. Only the main model's objects and build and
// model_settings.config change; the meshes stay where they are, now components of the one object. That object is the
// largest's, placed as it was, the others' parts placed relative to it.
//
// The slicer numbers objects by where each first comes in the build, and the files keeping per-object things it
// draws (layer heights, height ranges, brim ears, cut pieces) say which by that number, so those are renumbered.

import { randomUUID } from "node:crypto";
import type { ObjectSettings } from "../../adapter/readers/bambuProject";
import { composeTransform, parseTransform } from "../../adapter/transform";
import { escapeXml } from "../../adapter/xml";
import { ATTRS, attrValue, buildItems, withAttr, type LayoutItem } from "./layout";

export type ProjectFiles = {
  rootXml: string;
  modelSettingsXml: string | null;
  /** The files that name objects by their place in the build, by entry name, where the project has them. */
  sideFiles: Record<string, string>;
};

/** The project's files naming objects by their place in the build, and how each does: by lines `object_id=N|...`, or
 *  as XML, `<object id="N">`. */
export const SIDE_FILES: Record<string, "lines" | "xml"> = {
  "Metadata/layer_heights_profile.txt": "lines",
  "Metadata/brim_ear_points.txt": "lines",
  "Metadata/layer_config_ranges.xml": "xml",
  "Metadata/cut_information.xml": "xml",
};

/** Whether a side file names its objects by lines; its entry name in any case, as zips spell it. */
const byLines = (name: string) =>
  Object.entries(SIDE_FILES).some(([file, kind]) => kind === "lines" && file.toLowerCase() === name.toLowerCase());

const LINE_ID_RE = /^object_id=(\d+)\|/;
// Tags read up to their real end: XML lets a quoted value hold a `>`.
const tags = (source: string) => new RegExp(source, "g");
const XML_OBJECT_RE = tags(String.raw`<object\b(${ATTRS})>[\s\S]*?<\/object>\s*`);
const SETTINGS_OBJECT_RE = tags(String.raw`<object\b(${ATTRS})>([\s\S]*?)<\/object>`);
const PART_RE = tags(String.raw`<part\b${ATTRS}(?:\/>|>[\s\S]*?<\/part>)`);
const PART_OPEN_RE = new RegExp(String.raw`<part\b${ATTRS}\/?>`);
const INSTANCE_RE = /<model_instance>([\s\S]*?)<\/model_instance>\s*/g;
const ASSEMBLE_RE = tags(String.raw`<assemble_item\b(${ATTRS})\/?>\s*`);
const ROOT_OBJECT_RE = tags(String.raw`<object\b(${ATTRS})>([\s\S]*?)<\/object>\s*`);
const COMPONENT_RE = tags(String.raw`<component\b(${ATTRS})\/?>`);
const ITEM_TAG_RE = tags(String.raw`<item\b(${ATTRS})\/?>\s*`);
// The resources a 3MF numbers: every one's id is unique across them (3MF Core Specification, Resources).
const RESOURCE_RE = tags(
  String.raw`<(?:[\w-]+:)?(?:object|basematerials|colorgroup|texture2d|texture2dgroup|compositematerials|multiproperties|slicestack|displacement2d|normvectorgroup|disp2dgroup)\b(${ATTRS})\/?>`,
);
// What Bambu Studio writes at an object's level besides the settings changed for it.
const OBJECT_INFO = new Set(["name", "extruder", "module"]);

/** The objects' places in the build, 1-based, as the slicer numbers them. */
function buildPlaces(rootXml: string): Map<string, number> {
  const places = new Map<string, number>();
  for (const item of buildItems(rootXml)) if (!places.has(item.objectId)) places.set(item.objectId, places.size + 1);
  return places;
}

/** The build places the side files name. */
export function sideFilePlaces(files: Record<string, string>): Set<number> {
  const places = new Set<number>();
  for (const [name, text] of Object.entries(files)) {
    if (byLines(name)) {
      for (const line of text.split(/\r?\n/)) {
        const m = LINE_ID_RE.exec(line);
        if (m) places.add(Number(m[1]));
      }
    } else
      for (const m of text.matchAll(XML_OBJECT_RE)) {
        const id = Number(attrValue(m[1], "id"));
        if (Number.isInteger(id)) places.add(id);
      }
  }
  return places;
}

/** The group's main item: the largest, whose object the others' parts join. */
export function mainItem(group: LayoutItem[]): LayoutItem {
  const volume = ({ world: { min, max } }: LayoutItem) => (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]);
  return group.reduce((best, item) => (volume(item) > volume(best) ? item : best));
}

/** Whether the main item's object can take the others' parts as it is: it's made of components and has no other
 *  instance, which would get them too. */
function reusable(main: LayoutItem, rootXml: string): boolean {
  const object = [...rootXml.matchAll(ROOT_OBJECT_RE)].find((m) => attrValue(m[1], "id") === main.objectId);
  const instances = buildItems(rootXml).filter((item) => item.objectId === main.objectId).length;
  const component = referencesIn(rootXml).has(main.objectId);
  return Boolean(object) && !/<mesh[\s>]/.test(object![2]) && instances === 1 && !component;
}

/** Which of the main model's objects others have as components, and which those others are. */
function referencesIn(rootXml: string): Map<string, Set<string>> {
  const references = new Map<string, Set<string>>();
  for (const m of rootXml.matchAll(ROOT_OBJECT_RE)) {
    const id = attrValue(m[1], "id");
    if (!id) continue;
    for (const c of m[2].matchAll(COMPONENT_RE)) {
      const target = attrValue(c[0], "objectid");
      if (!target || attrValue(c[0], "p:path") || attrValue(c[0], "path")) continue;
      if (!references.has(target)) references.set(target, new Set());
      references.get(target)!.add(id);
    }
  }
  return references;
}

/** Whether merging the group would lose what's set for an object (the joining objects' own settings or anything a
 *  side file keeps for them, or the main one's side files where its parts go on a new object), or can't be written:
 *  an object in a model part of its own or made of components of components, or a main one placed by a transform that
 *  can't be undone. */
export function mergeLoses(
  group: LayoutItem[],
  modelSettings: Record<string, ObjectSettings>,
  rootXml: string,
  sidePlaces: Set<number>,
): boolean {
  const main = mainItem(group);
  if (group.some((item) => item.external || item.nested)) return true;
  if (!invertTransform(parseTransform(buildItems(rootXml)[main.index]?.transform))) return true;
  const places = buildPlaces(rootXml);
  const kept = (item: LayoutItem) => sidePlaces.has(places.get(item.objectId) ?? 0);
  if (kept(main) && !reusable(main, rootXml)) return true;
  return group.some((item) => {
    if (item === main) return false;
    const own = Object.keys(modelSettings[item.objectId]?.settings ?? {}).some((key) => !OBJECT_INFO.has(key));
    return own || kept(item);
  });
}

/** `m` undone, for an affine 3MF transform in row-vector form; null where it can't be, reliably: flat, or near enough
 *  for its size (a determinant judged against the scale, so a tiny uniform scale still inverts). */
export function invertTransform(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const scale = Math.max(...m.slice(0, 9).map(Math.abs));
  if (!Number.isFinite(det) || !(scale > 0) || Math.abs(det) / scale ** 3 < 1e-9) return null;
  const inv = [
    (e * i - f * h) / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    (f * g - d * i) / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    (d * h - e * g) / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
  const [x, y, z] = [m[9], m[10], m[11]];
  return [
    ...inv,
    -(x * inv[0] + y * inv[3] + z * inv[6]),
    -(x * inv[1] + y * inv[4] + z * inv[7]),
    -(x * inv[2] + y * inv[5] + z * inv[8]),
  ];
}

const compose = (outer: number[], inner: number[]) => composeTransform(outer.join(" "), inner.join(" "));

/** A transform written as exactly as its numbers are: a part placed relative to another can be scaled by far less
 *  than the adapter's seven decimals keep. */
const exact = (m: number[]) => m.map((n) => (Object.is(n, -0) ? "0" : String(n))).join(" ");

const METADATA_TAG_RE = tags(String.raw`<metadata\b${ATTRS}\/?>`);

/** A metadata entry's value by its key, as Bambu Studio's reader takes it: its attributes in any order, the last entry
 *  with that key. */
function metadataValue(xml: string, key: string): string | null {
  let value: string | null = null;
  for (const [tag] of xml.matchAll(METADATA_TAG_RE)) if (attrValue(tag, "key") === key) value = attrValue(tag, "value");
  return value;
}

/** The entries with that key given `value`. */
function withMetadata(xml: string, key: string, value: string): string {
  return xml.replace(METADATA_TAG_RE, (tag) => (attrValue(tag, "key") === key ? withAttr(tag, "value", value) : tag));
}

/** The project with each group made one object. Groups are of one plate's items, and none loses anything
 *  (mergeLoses). */
export function mergeObjects(files: ProjectFiles, groups: LayoutItem[][]): ProjectFiles {
  if (!groups.length) return files;
  const { rootXml } = files;
  const items = buildItems(rootXml);
  const objects = new Map<string, { attrs: string; body: string }>();
  for (const m of rootXml.matchAll(ROOT_OBJECT_RE)) {
    const id = attrValue(m[1], "id");
    if (id) objects.set(id, { attrs: m[1], body: m[2] });
  }
  const settingsXml = files.modelSettingsXml ?? "";
  const entries = new Map<string, string>();
  for (const m of settingsXml.matchAll(SETTINGS_OBJECT_RE)) {
    const id = attrValue(m[1], "id");
    if (id) entries.set(id, m[2]);
  }
  const taken = [...rootXml.slice(0, Math.max(rootXml.lastIndexOf("<build"), 0)).matchAll(RESOURCE_RE)]
    .map((m) => Number(attrValue(m[1], "id")))
    .filter(Number.isFinite);
  let nextId = Math.max(0, ...taken) + 1;

  // What changes: each object rewritten or added, build items dropped or renamed, settings entries likewise.
  const newObjects = new Map<string, string>();
  const newEntries = new Map<string, string>();
  const dropItems = new Set<number>();
  const renameItem = new Map<number, string>();
  /** `objectId:instance` of a merged item -> the object it's part of now, for plates and the assembly. */
  const mergedInto = new Map<string, string | null>();

  for (const group of groups) {
    const main = mainItem(group);
    const members = [main, ...group.filter((item) => item !== main)];
    const mainObject = objects.get(main.objectId);
    if (!mainObject) continue;
    const reuse = reusable(main, rootXml);
    const targetId = reuse ? main.objectId : String(nextId++);
    const undo = invertTransform(parseTransform(items[main.index].transform));
    if (!undo) continue;

    const components: string[] = [];
    const parts: string[] = [];
    for (const member of members) {
      const object = objects.get(member.objectId);
      if (!object) continue;
      const relative = compose(undo, parseTransform(items[member.index].transform));
      const entry = entries.get(member.objectId) ?? "";
      const extruder = metadataValue(entry.split(/<part\b/)[0], "extruder") ?? "1";
      const leafIds: string[] = [];
      if (/<mesh[\s>]/.test(object.body)) {
        components.push(`<component objectid="${member.objectId}" transform="${exact(relative)}"/>`);
        leafIds.push(member.objectId);
      } else {
        for (const c of object.body.matchAll(COMPONENT_RE)) {
          const tag = c[0];
          const placed = exact(compose(relative, parseTransform(attrValue(tag, "transform"))));
          let out = withAttr(tag, "transform", placed);
          if (attrValue(tag, "p:UUID") !== null && !(reuse && member === main))
            out = withAttr(out, "p:UUID", randomUUID());
          components.push(out);
          leafIds.push(attrValue(tag, "objectid") ?? "");
        }
      }
      // Each part keeps its filament: a part on "the object's" is on its own object's.
      const rows = [...entry.matchAll(PART_RE)].map(([part]) => {
        const id = attrValue(PART_OPEN_RE.exec(part)?.[0] ?? "", "id");
        const value = metadataValue(part, "extruder");
        if (value && value !== "0") return { id, xml: part };
        if (value === "0") return { id, xml: withMetadata(part, "extruder", extruder) };
        const xml = part
          .replace(new RegExp(String.raw`^(<part\b${ATTRS})\/>$`), "$1></part>")
          .replace(/<\/part>$/, `<metadata key="extruder" value="${escapeXml(extruder)}"/></part>`);
        return { id, xml };
      });
      // In the order of the member's own components, each with the row the slicer gives it (the one at its place,
      // else the first with its id), so they still match once they follow the other members' parts.
      leafIds.forEach((id, i) => {
        const row = rows[i]?.id === id ? rows[i] : rows.find((r) => r.id === id);
        parts.push(
          row?.xml ??
            `<part id="${escapeXml(id)}" subtype="normal_part"><metadata key="name" value="${escapeXml(member.name)}"/>` +
              `<metadata key="extruder" value="${escapeXml(extruder)}"/></part>`,
        );
      });
      mergedInto.set(`${member.objectId}:${member.instance}`, member === main ? targetId : null);
      if (member === main) {
        if (!reuse) renameItem.set(member.index, targetId);
      } else dropItems.add(member.index);
    }

    const uuid = attrValue(mainObject.attrs, "p:UUID");
    const attrs = reuse
      ? mainObject.attrs
      : ` id="${targetId}"${uuid !== null ? ` p:UUID="${randomUUID()}"` : ""} type="model"`;
    newObjects.set(targetId, `<object${attrs}><components>${components.join("")}</components></object>\n`);
    const mainEntry = entries.get(main.objectId);
    const objectHead = mainEntry
      ? mainEntry.split(/<part\b/)[0]
      : `<metadata key="name" value="${escapeXml(main.name)}"/><metadata key="extruder" value="1"/>`;
    newEntries.set(targetId, `<object id="${targetId}">${objectHead}${parts.join("\n")}\n</object>`);
  }

  // The build: merged items gone, the main ones on their new objects, other instances renumbered.
  const renumber = new Map<string, number>();
  const counts = new Map<string, number>();
  items.forEach((item, index) => {
    if (dropItems.has(index)) return;
    const objectId = renameItem.get(index) ?? item.objectId;
    const instance = counts.get(objectId) ?? 0;
    counts.set(objectId, instance + 1);
    if (objectId === item.objectId) renumber.set(`${item.objectId}:${item.instance}`, instance);
  });
  // Objects the build had and no longer has leave model_settings.config, and the main model too unless they're now
  // a component of a merged one.
  const unbuilt = new Set(items.map((item) => item.objectId).filter((id) => !counts.has(id)));
  const asComponents = new Set<string>();
  for (const body of newObjects.values())
    for (const c of body.matchAll(COMPONENT_RE))
      if (!attrValue(c[0], "p:path")) asComponents.add(attrValue(c[0], "objectid") ?? "");
  // Nor do objects that one left in the main model has as a component.
  const references = referencesIn(rootXml);
  const gone = new Set([...unbuilt].filter((id) => !asComponents.has(id)));
  for (let changed = true; changed;) {
    changed = false;
    for (const id of gone)
      if ([...(references.get(id) ?? [])].some((by) => !gone.has(by))) {
        gone.delete(id);
        changed = true;
      }
  }

  let itemIndex = -1;
  const buildAt = rootXml.lastIndexOf("<build");
  const head = rootXml.slice(0, buildAt).replace(ROOT_OBJECT_RE, (whole, attrs: string) => {
    const id = attrValue(attrs, "id") ?? "";
    if (gone.has(id)) return "";
    if (newObjects.has(id)) {
      const replacement = newObjects.get(id)!;
      newObjects.delete(id);
      return replacement;
    }
    return whole;
  });
  const added = [...newObjects.values()].join("");
  const build = rootXml.slice(buildAt).replace(ITEM_TAG_RE, (whole, attrs: string) => {
    if (!attrValue(attrs, "objectid")) return whole;
    itemIndex++;
    if (dropItems.has(itemIndex)) return "";
    const renamed = renameItem.get(itemIndex);
    return renamed ? withAttr(whole.trimEnd(), "objectid", renamed) + "\n" : whole;
  });
  const resourcesEnd = head.lastIndexOf("</resources>");
  const newRoot = head.slice(0, resourcesEnd) + added + head.slice(resourcesEnd) + build;

  const place = (objectId: string, instance: string | null) => {
    const key = `${objectId}:${instance ?? "0"}`;
    if (mergedInto.has(key)) {
      const into = mergedInto.get(key);
      return into ? { objectId: into, instance: "0" } : null;
    }
    const next = renumber.get(key);
    return { objectId, instance: next === undefined ? instance : String(next) };
  };

  let newSettings = files.modelSettingsXml;
  if (newSettings !== null) {
    newSettings = newSettings.replace(SETTINGS_OBJECT_RE, (whole, attrs: string) => {
      const id = attrValue(attrs, "id") ?? "";
      if (newEntries.has(id)) {
        const entry = newEntries.get(id)!;
        newEntries.delete(id);
        return entry;
      }
      return unbuilt.has(id) ? "" : whole;
    });
    const extra = [...newEntries.values()].join("\n");
    const firstPlate = newSettings.search(/<plate>/);
    newSettings =
      firstPlate >= 0
        ? newSettings.slice(0, firstPlate) + extra + "\n" + newSettings.slice(firstPlate)
        : newSettings.replace(/<\/config>/, `${extra}\n</config>`);
    newSettings = newSettings
      .replace(INSTANCE_RE, (whole, body: string) => {
        const objectId = metadataValue(body, "object_id");
        if (!objectId) return whole;
        const to = place(objectId, metadataValue(body, "instance_id"));
        if (!to) return "";
        let out = withMetadata(whole, "object_id", to.objectId);
        if (to.instance !== null) out = withMetadata(out, "instance_id", to.instance);
        return out;
      })
      .replace(ASSEMBLE_RE, (whole, attrs: string) => {
        const objectId = attrValue(attrs, "object_id");
        if (!objectId) return whole;
        const to = place(objectId, attrValue(attrs, "instance_id"));
        if (!to) return "";
        let out = withAttr(whole.trimEnd(), "object_id", to.objectId);
        if (to.instance !== null) out = withAttr(out, "instance_id", to.instance);
        return out + "\n";
      });
  }

  // Side files follow the objects to their new places in the build.
  const before = buildPlaces(rootXml);
  const after = buildPlaces(newRoot);
  const moved = new Map<number, number>();
  for (const [id, at] of before) {
    const now = after.get(id);
    if (now !== undefined) moved.set(at, now);
  }
  const sideFiles = Object.fromEntries(
    Object.entries(files.sideFiles).map(([name, text]) => {
      if (byLines(name))
        return [
          name,
          text
            .split(/(?<=\n)/)
            .map((line) => {
              const m = LINE_ID_RE.exec(line);
              if (!m) return line;
              const to = moved.get(Number(m[1]));
              return to === undefined ? "" : line.replace(LINE_ID_RE, `object_id=${to}|`);
            })
            .join(""),
        ];
      return [
        name,
        text.replace(XML_OBJECT_RE, (whole, attrs: string) => {
          const to = moved.get(Number(attrValue(attrs, "id")));
          if (to === undefined) return "";
          // Only the opening tag's own id: the cut pieces' entries hold ids of their own further in.
          const open = whole.slice(0, "<object".length + attrs.length + 1);
          return withAttr(open, "id", String(to)) + whole.slice(open.length);
        }),
      ];
    }),
  );
  return { rootXml: newRoot, modelSettingsXml: newSettings, sideFiles };
}
