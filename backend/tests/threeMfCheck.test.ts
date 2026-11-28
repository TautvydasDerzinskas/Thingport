import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { paintStates } from "../src/adapter/paint";
import { readBambuPackage } from "../src/adapter/readers/bambuProject";
import { makerworldThreeMfRules as RULES } from "../src/providers/makerworld/threeMfRules";
import { checkThreeMf, fixThreeMf } from "../src/services/threeMfCheck";
import { runThreeMfCheck } from "../src/services/threeMfCheck/check";
import { invertTransform } from "../src/services/threeMfCheck/merge";
import { plateFootprint } from "../src/services/threeMfCheck/footprint";
import {
  attrValue,
  readLayout,
  withAttr,
  type Box2,
  type Box3,
  type LayoutItem,
} from "../src/services/threeMfCheck/layout";
import {
  placeTower,
  towerClear,
  towerFootprint,
  towerSettings,
  towerSize,
} from "../src/services/threeMfCheck/wipeTower";

// Pure: no database. 3MFs a site would turn down, what the check says of each, and the copy it makes.

type Vec3 = [number, number, number];
type MeshSpec = { vertices: Vec3[]; triangles: [number, number, number][] };

/** A closed box standing on z = 0, its corners given. */
function box([x0, y0]: [number, number], [x1, y1]: [number, number], height: number, z0 = 0): MeshSpec {
  const vertices = [0, 1, 2, 3, 4, 5, 6, 7].map((i): Vec3 => [
    i & 1 ? x1 : x0,
    i & 2 ? y1 : y0,
    i & 4 ? z0 + height : z0,
  ]);
  // prettier-ignore
  const triangles: [number, number, number][] = [[0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6], [0, 1, 4], [1, 5, 4], [2, 6, 3], [3, 6, 7], [0, 4, 2], [2, 4, 6], [1, 3, 5], [3, 7, 5]];
  return { vertices, triangles };
}

/** Several closed meshes as one. */
function joined(...meshes: MeshSpec[]): MeshSpec {
  const out: MeshSpec = { vertices: [], triangles: [] };
  for (const mesh of meshes) {
    const at = out.vertices.length;
    out.vertices.push(...mesh.vertices);
    out.triangles.push(...mesh.triangles.map(([a, b, c]): [number, number, number] => [a + at, b + at, c + at]));
  }
  return out;
}

/** A square frame around the origin: `outer` wide, a hole `inner` wide. */
function frame(outer: number, inner: number, height: number): MeshSpec {
  const [o, i] = [outer / 2, inner / 2];
  return joined(
    box([-o, -o], [-i, o], height),
    box([i, -o], [o, o], height),
    box([-i, -o], [i, -i], height),
    box([-i, i], [i, o], height),
  );
}

const meshXml = ({ vertices, triangles }: MeshSpec, paint?: string) =>
  `<mesh><vertices>${vertices.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join("")}</vertices><triangles>${triangles
    .map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"${paint ? ` paint_color="${paint}"` : ""}/>`)
    .join("")}</triangles></mesh>`;

type PartSpec = { name: string; mesh: MeshSpec; extruder?: number };
type ObjectSpec = {
  name: string;
  /** Its one part's mesh, or its parts. */
  mesh?: MeshSpec;
  parts?: PartSpec[];
  extruder?: number;
  settings?: Record<string, string>;
  /** Every triangle painted so. */
  paint?: string;
  /** Its parts' rows in model_settings.config in the reverse of their components' order. */
  rowsReversed?: boolean;
  /** Made of another object (by its place in `objects`), moved this far along X, rather than a mesh of its own. */
  of?: { object: number; dx: number };
};
/** A build item: the object (by its place in `objects`), where its origin goes on the plate, and the plate. */
type ItemSpec = { object: number; at: [number, number]; plate?: number };

const P1S_SETTINGS = {
  printer_settings_id: "Bambu Lab P1S 0.4 nozzle",
  printer_model: "Bambu Lab P1S",
  printer_variant: "0.4",
  nozzle_diameter: ["0.4"],
  print_settings_id: "0.20mm Standard @BBL X1C",
  filament_settings_id: ["Bambu PLA Basic @BBL X1C", "Bambu PLA Basic @BBL X1C"],
  filament_colour: ["#FF0000", "#00FF00"],
  filament_type: ["PLA", "PLA"],
  printable_area: ["0x0", "256x0", "256x256", "0x256"],
  printable_height: "250",
  bed_exclude_area: ["0x0", "18x0", "18x28", "0x28"],
  enable_prime_tower: "1",
  wipe_tower_x: ["165", "165"],
  wipe_tower_y: ["200", "200"],
};

const BED_STRIDE = 256 * 1.2;

/** A Bambu Studio project as it writes one: each object's meshes in its own file, components of the object. */
async function bambuProject(options: {
  objects: ObjectSpec[];
  items: ItemSpec[];
  settings?: Record<string, unknown>;
  app?: string;
  plates?: number;
  files?: Record<string, string>;
  /** How the build items quote their attributes. */
  quoting?: "single" | "spaced";
}): Promise<Uint8Array> {
  const zip = new JSZip();
  const { objects, items } = options;
  const objectId = (i: number) => 2 * i + 2;
  // One part keeps the id Bambu Studio would give it; several get their own.
  const meshIds = (i: number) => {
    const parts = objects[i].parts;
    return parts ? parts.map((_, k) => 100 * (i + 1) + k) : [2 * i + 1];
  };
  const partsOf = (object: ObjectSpec): PartSpec[] =>
    object.parts ?? [{ name: object.name, mesh: object.mesh!, extruder: undefined }];
  objects.forEach((object, i) => {
    if (object.of) return;
    const meshes = partsOf(object)
      .map((part, k) => `<object id="${meshIds(i)[k]}" type="model">${meshXml(part.mesh, object.paint)}</object>`)
      .join("");
    zip.file(
      `3D/Objects/object_${i + 1}.model`,
      `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${meshes}</resources><build/></model>`,
    );
  });
  const components = (object: ObjectSpec, i: number) =>
    object.of
      ? `<component objectid="${objectId(object.of.object)}" transform="1 0 0 0 1 0 0 0 1 ${object.of.dx} 0 0"/>`
      : meshIds(i)
          .map(
            (id, k) =>
              `<component p:path="/3D/Objects/object_${i + 1}.model" objectid="${id}" p:UUID="000${k}000${i}-b206-40ff-9872-83e8017abed1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`,
          )
          .join("");
  const plates = options.plates ?? 1;
  const attr = (name: string, value: string) =>
    options.quoting === "single"
      ? `${name}='${value}'`
      : options.quoting === "spaced"
        ? `${name} = "${value}"`
        : `${name}="${value}"`;
  zip.file(
    "3D/3dmodel.model",
    `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="Application">${options.app ?? "BambuStudio-02.03.00.70"}</metadata>
 <resources>
${objects
  .map(
    (object, i) =>
      `  <object id="${objectId(i)}" p:UUID="0000000${i}-61cb-4c03-9d28-80fed5dfa1dc" type="model"><components>${components(object, i)}</components></object>`,
  )
  .join("\n")}
 </resources>
 <build>
${items
  .map(({ object, at: [x, y], plate = 1 }) => {
    const [ox, oy] = [((plate - 1) % 2) * BED_STRIDE, -Math.floor((plate - 1) / 2) * BED_STRIDE];
    return `  <item ${attr("objectid", String(objectId(object)))} ${attr("transform", `1 0 0 0 1 0 0 0 1 ${x + ox} ${y + oy} 0`)} ${attr("printable", "1")}/>`;
  })
  .join("\n")}
 </build>
</model>`,
  );
  const meta = (key: string, value: unknown) => `<metadata key="${key}" value="${value}"/>`;
  const seen = new Map<number, number>();
  const instances = items.map(({ object, plate = 1 }) => {
    const instance = seen.get(object) ?? 0;
    seen.set(object, instance + 1);
    return {
      plate,
      xml: `<model_instance>${meta("object_id", objectId(object))}${meta("instance_id", instance)}${meta("identify_id", 100 + instance)}</model_instance>`,
    };
  });
  const rowsOf = (object: ObjectSpec, i: number) => {
    const source = object.of ? object.of.object : i;
    const rows = partsOf(objects[source]).map(
      (part, k) =>
        `<part id="${meshIds(source)[k]}" subtype="normal_part">${meta("name", part.name)}${
          part.extruder ? meta("extruder", part.extruder) : ""
        }${meta("matrix", "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1")}</part>`,
    );
    return (object.rowsReversed ? rows.toReversed() : rows).join("");
  };
  zip.file(
    "Metadata/model_settings.config",
    `<?xml version="1.0" encoding="UTF-8"?>
<config>
${objects
  .map(
    (object, i) =>
      `<object id="${objectId(i)}">${meta("name", object.name)}${meta("extruder", object.extruder ?? 1)}${Object.entries(
        object.settings ?? {},
      )
        .map(([key, value]) => meta(key, value))
        .join("")}${rowsOf(object, i)}</object>`,
  )
  .join("\n")}
${Array.from(
  { length: plates },
  (_, p) =>
    `<plate>${meta("plater_id", p + 1)}${meta("plater_name", "")}${instances
      .filter((inst) => inst.plate === p + 1)
      .map((inst) => inst.xml)
      .join("")}</plate>`,
).join("\n")}
</config>`,
  );
  zip.file("Metadata/project_settings.config", JSON.stringify(options.settings ?? P1S_SETTINGS));
  for (const [name, text] of Object.entries(options.files ?? {})) zip.file(name, text);
  return zip.generateAsync({ type: "uint8array" });
}

const coin = (extruder = 1) => ({ name: "Coin", mesh: box([-20, -20], [20, 20], 2), extruder });
// Sunk into the coin's top, as an inlay modelled as its own body is.
const logo = (extruder = 2) => ({ name: "Logo", mesh: box([-8, -8], [8, 8], 1, 1.4), extruder });

async function fixed(bytes: Uint8Array, options = {}) {
  const run = await runThreeMfCheck(bytes, RULES, options);
  const copy = run.zip ? await run.zip.generateAsync({ type: "uint8array" }) : null;
  return { ...run.result, copy };
}

async function settingsOf(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  return JSON.parse(await zip.file("Metadata/project_settings.config")!.async("string")) as Record<string, unknown>;
}

function boundsOf(item: LayoutItem, part: number): Box3 {
  const { mesh, matrix: t } = item.parts[part];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const [x, y, z] = [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]];
    const p = [
      x * t[0] + y * t[3] + z * t[6] + t[9],
      x * t[1] + y * t[4] + z * t[7] + t[10],
      x * t[2] + y * t[5] + z * t[8] + t[11],
    ];
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p[a]);
      max[a] = Math.max(max[a], p[a]);
    }
  }
  return { min, max };
}

function expectBox(actual: Box3, expected: Box3) {
  for (let a = 0; a < 3; a++) {
    expect(actual.min[a]).toBeCloseTo(expected.min[a], 4);
    expect(actual.max[a]).toBeCloseTo(expected.max[a], 4);
  }
}

describe("3MF check for publishing", () => {
  it("makes objects printing into each other one object, places the wipe tower and names the nozzle variant", async () => {
    const { printer_variant: _variant, wipe_tower_x: _x, wipe_tower_y: _y, ...settings } = P1S_SETTINGS;
    const bytes = await bambuProject({
      objects: [coin(), logo(), { name: "Token", mesh: box([-10, -10], [10, 10], 2) }],
      items: [
        { object: 0, at: [120, 120] },
        { object: 1, at: [120, 120] },
        { object: 2, at: [60, 180] },
      ],
      settings,
    });
    const { printer, needsPrinter, issues, copy } = await fixed(bytes);

    expect(printer).toEqual({ id: "bambulab-p1s", nozzle: "0.4" });
    expect(needsPrinter).toBe(false);
    expect(issues).toEqual([
      { check: "nozzle", problem: "no-nozzle", plate: null, fix: "set-nozzle" },
      {
        check: "overlapping-objects",
        problem: "overlapping-objects",
        plate: 1,
        objects: ["Coin", "Logo"],
        fix: "merge-objects",
      },
      { check: "wipe-tower", problem: "no-tower-position", plate: 1, fix: "place-tower" },
    ]);
    expect(copy).not.toBeNull();

    // The copy: the coin's object holds the logo as a second part on its own filament, the token as it was.
    const zip = await JSZip.loadAsync(copy!);
    const model = await zip.file("3D/3dmodel.model")!.async("string");
    expect(model.match(/<item /g)).toHaveLength(2);
    const config = await zip.file("Metadata/model_settings.config")!.async("string");
    const merged = config.match(/<object id="2">[\s\S]*?<\/object>/)![0];
    expect(
      [...merged.matchAll(/<part id="(\d+)"[\s\S]*?key="extruder" value="(\d+)"/g)].map((m) => [m[1], m[2]]),
    ).toEqual([
      ["1", "1"],
      ["3", "2"],
    ]);
    expect(config).not.toMatch(/<object id="4">/);
    expect(config.match(/<model_instance>/g)).toHaveLength(2);

    // Each part prints where it did.
    const layout = await readLayout(await readBambuPackage(zip));
    const [one, token] = layout.plates[0].items;
    expect(one.parts).toHaveLength(2);
    expectBox(boundsOf(one, 0), { min: [100, 100, 0], max: [140, 140, 2] });
    expectBox(boundsOf(one, 1), { min: [112, 112, 1.4], max: [128, 128, 2.4] });
    expect(token.bounds).toEqual({ min: [50, 170, 0], max: [70, 190, 2] });

    // The tower: on the bed, off its corner nothing prints on, clear of both objects.
    const out = await settingsOf(copy!);
    expect(out.printer_variant).toBe("0.4");
    const [x, y] = [Number((out.wipe_tower_x as string[])[0]), Number((out.wipe_tower_y as string[])[0])];
    const [width, depth] = towerSize({ boxes: [], filaments: 2, height: 2.4 }, towerSettings(out));
    const tower = { minX: x - 3, minY: y - 3, maxX: x + width + 3, maxY: y + depth + 3 };
    expect(tower.minX).toBeGreaterThanOrEqual(0);
    expect(tower.maxX).toBeLessThanOrEqual(256);
    expect(tower.maxY).toBeLessThanOrEqual(256);
    for (const taken of [
      { minX: 100, minY: 100, maxX: 140, maxY: 140 },
      { minX: 50, minY: 170, maxX: 70, maxY: 190 },
      { minX: 0, minY: 0, maxX: 18, maxY: 28 },
    ])
      expect(
        tower.maxX <= taken.minX || tower.minX >= taken.maxX || tower.maxY <= taken.minY || tower.minY >= taken.maxY,
      ).toBe(true);

    // Checked again, the copy needs nothing.
    expect((await fixed(copy!)).issues).toEqual([]);
  });

  it("counts an inlay sitting in its pocket as an object of its own, which the slicer lowers into the coin", async () => {
    // The pocket fits the inlay exactly, so as placed they only touch; the slicer prints each object from the bed up.
    const pocketed = joined(
      box([-20, -20], [20, 20], 1.5),
      // The rim around the pocket.
      box([-20, -20], [-8, 20], 0.4, 1.5),
      box([8, -20], [20, 20], 0.4, 1.5),
      box([-8, -20], [8, -8], 0.4, 1.5),
      box([-8, 8], [8, 20], 0.4, 1.5),
    );
    const bytes = await bambuProject({
      objects: [
        { name: "Coin", mesh: pocketed, extruder: 1 },
        { name: "Inlay", mesh: box([-8, -8], [8, 8], 0.8, 1.5), extruder: 2 },
      ],
      items: [
        { object: 0, at: [120, 120] },
        { object: 1, at: [120, 120] },
      ],
    });
    const { issues, copy } = await fixed(bytes);
    expect(issues).toEqual([
      {
        check: "overlapping-objects",
        problem: "overlapping-objects",
        plate: 1,
        objects: ["Coin", "Inlay"],
        fix: "merge-objects",
      },
    ]);
    // One object, the inlay a part of it where it was: in the pocket.
    const [item] = (await readLayout(await readBambuPackage(await JSZip.loadAsync(copy!)))).plates[0].items;
    expect(item.lift).toBe(0);
    expectBox(boundsOf(item, 1), { min: [112, 112, 1.5], max: [128, 128, 2.3] });
  });

  it("leaves apart objects that share their bounds without printing into each other", async () => {
    const bytes = await bambuProject({
      objects: [
        { name: "Frame", mesh: frame(60, 30, 10) },
        { name: "Cube", mesh: box([-5, -5], [5, 5], 10) },
      ],
      items: [
        { object: 0, at: [128, 128] },
        { object: 1, at: [128, 128] },
      ],
    });
    expect(await fixed(bytes)).toEqual({
      printer: { id: "bambulab-p1s", nozzle: "0.4" },
      needsPrinter: false,
      issues: [],
      copy: null,
    });
  });

  it("leaves to the slicer what Thingport can't fix, and makes no copy", async () => {
    const own = await bambuProject({
      objects: [coin(), { ...logo(), settings: { wall_loops: "3" } }],
      items: [
        { object: 0, at: [120, 120] },
        { object: 1, at: [120, 120] },
      ],
    });
    const kept = await fixed(own);
    expect(kept.issues).toEqual([
      { check: "overlapping-objects", problem: "overlapping-objects", plate: 1, objects: ["Coin", "Logo"], fix: null },
    ]);
    expect(kept.copy).toBeNull();

    const off = await bambuProject({
      objects: [coin(), { name: "Corner", mesh: box([-4, -4], [4, 4], 2), extruder: 1 }],
      items: [
        { object: 0, at: [250, 120] },
        { object: 1, at: [10, 10] },
      ],
    });
    expect((await fixed(off)).issues).toEqual([
      { check: "off-bed", problem: "off-bed", plate: 1, objects: ["Coin", "Corner"], fix: null },
    ]);

    const sliced = new JSZip();
    sliced.file("3D/3dmodel.model", "<model/>");
    sliced.file("Metadata/plate_1.gcode", "G28");
    expect((await fixed(await sliced.generateAsync({ type: "uint8array" }))).issues).toEqual([
      { check: "sliced", problem: "sliced", plate: null, fix: null },
    ]);

    const plain = new JSZip();
    plain.file(
      "3D/3dmodel.model",
      `<model><resources><object id="1">${meshXml(box([0, 0], [5, 5], 5))}</object></resources><build><item objectid="1"/></build></model>`,
    );
    expect((await fixed(await plain.generateAsync({ type: "uint8array" }))).issues).toEqual([
      { check: "project", problem: "not-a-project", plate: null, fix: null },
    ]);
  });

  it("moves a wipe tower that would print into an object", async () => {
    const bytes = await bambuProject({
      objects: [coin(1), { name: "Badge", mesh: box([-10, -10], [10, 10], 2), extruder: 2 }],
      items: [
        { object: 0, at: [180, 210] },
        { object: 1, at: [60, 60] },
      ],
    });
    const { issues, copy } = await fixed(bytes);
    expect(issues).toEqual([{ check: "wipe-tower", problem: "tower-in-the-way", plate: 1, fix: "place-tower" }]);
    const out = await settingsOf(copy!);
    expect((out.wipe_tower_x as string[])[0]).not.toBe("165");
    expect((await fixed(copy!)).issues).toEqual([]);
  });

  it("renumbers the instances and per-object files of what stays when objects merge", async () => {
    // The logo comes first in the build, so the objects after it move up a place once it's part of the coin.
    const bytes = await bambuProject({
      objects: [coin(), logo(), { name: "Token", mesh: box([-10, -10], [10, 10], 2) }],
      items: [
        { object: 1, at: [120, 120] },
        { object: 0, at: [120, 120] },
        { object: 2, at: [60, 180] },
        { object: 0, at: [120, 120], plate: 2 },
      ],
      plates: 2,
      files: { "Metadata/layer_heights_profile.txt": "object_id=3|0|0.2|2|0.1\n" },
    });
    const { issues, copy } = await fixed(bytes);
    expect(issues.map((issue) => [issue.check, issue.plate, issue.fix])).toEqual([
      ["overlapping-objects", 1, "merge-objects"],
    ]);
    const zip = await JSZip.loadAsync(copy!);
    // The coin has another instance, so the merged one is a new object, in the coin's place in the build.
    const model = await zip.file("3D/3dmodel.model")!.async("string");
    expect([...model.matchAll(/<item objectid="(\d+)"/g)].map((m) => m[1])).toEqual(["7", "6", "2"]);
    expect(await zip.file("Metadata/layer_heights_profile.txt")!.async("string")).toBe("object_id=2|0|0.2|2|0.1\n");
    const config = await zip.file("Metadata/model_settings.config")!.async("string");
    const plates = config.match(/<plate>[\s\S]*?<\/plate>/g)!;
    const instancesOf = (plate: string) =>
      [...plate.matchAll(/key="object_id" value="(\d+)"\/><metadata key="instance_id" value="(\d+)"/g)].map(
        (m) => `${m[1]}:${m[2]}`,
      );
    expect(instancesOf(plates[0])).toEqual(["7:0", "6:0"]);
    expect(instancesOf(plates[1])).toEqual(["2:0"]);
    expect((await fixed(copy!)).issues).toEqual([]);
  });

  it("names Bambu Studio as the app of an OrcaSlicer project", async () => {
    const bytes = await bambuProject({
      objects: [coin()],
      items: [{ object: 0, at: [128, 128] }],
      app: "OrcaSlicer-2.3.0",
    });
    const { issues, copy } = await fixed(bytes);
    expect(issues).toEqual([{ check: "project", problem: "other-app", plate: null, fix: "retag" }]);
    const model = await (await JSZip.loadAsync(copy!)).file("3D/3dmodel.model")!.async("string");
    expect(model).toMatch(/<metadata name="Application">BambuStudio-/);
  });

  it("puts a project for another printer, or on the user's own preset, on Bambu's preset for the printer", async () => {
    const k1c = await bambuProject({
      objects: [coin()],
      items: [{ object: 0, at: [110, 110] }],
      settings: {
        ...P1S_SETTINGS,
        printer_settings_id: "Creality K1C 0.4 nozzle",
        printer_model: "Creality K1C",
        printable_area: ["0x0", "220x0", "220x220", "0x220"],
      },
    });
    expect(await fixed(k1c)).toEqual({
      printer: null,
      needsPrinter: true,
      issues: [{ check: "project", problem: "other-printer", plate: null, fix: "retarget" }],
      copy: null,
    });
    const forP1S = await fixed(k1c, { printer: { id: "bambulab-p1s", nozzle: "0.4" } });
    expect(forP1S.issues).toEqual([{ check: "project", problem: "other-printer", plate: null, fix: "retarget" }]);
    const out = await settingsOf(forP1S.copy!);
    expect(out.printer_settings_id).toBe("Bambu Lab P1S 0.4 nozzle");
    expect(out.printer_variant).toBe("0.4");
    expect((await fixed(forP1S.copy!)).issues).toEqual([]);

    const mine = await bambuProject({
      objects: [coin()],
      items: [{ object: 0, at: [128, 128] }],
      settings: { ...P1S_SETTINGS, printer_settings_id: "My P1S" },
    });
    const own = await fixed(mine);
    expect(own.issues).toEqual([{ check: "project", problem: "custom-printer", plate: null, fix: "retarget" }]);
    expect((await settingsOf(own.copy!)).printer_settings_id).toBe("Bambu Lab P1S 0.4 nozzle");
  });

  it("converts a PrusaSlicer project once a printer is picked", async () => {
    const zip = new JSZip();
    zip.file(
      "3D/3dmodel.model",
      `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">
 <metadata name="slic3rpe:Version3mf">1</metadata>
 <metadata name="Application">PrusaSlicer-2.9.2+win64</metadata>
 <resources><object id="1" type="model">${meshXml(box([-10, -10], [10, 10], 5))}</object></resources>
 <build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 125 105 0" printable="1"/></build>
</model>`,
    );
    zip.file(
      "Metadata/Slic3r_PE.config",
      '; bed_shape = 0x0,250x0,250x210,0x210\n; filament_colour = #FF8000\n; filament_settings_id = "Prusament PLA"\n; filament_type = PLA\n; layer_height = 0.2\n; nozzle_diameter = 0.4\n; printer_model = MK4S\n; printer_settings_id = Original Prusa MK4S 0.4 nozzle\n; print_settings_id = 0.20mm SPEED @MK4S 0.4\n',
    );
    zip.file(
      "Metadata/Slic3r_PE_model.config",
      `<?xml version="1.0" encoding="UTF-8"?><config><object id="1" instances_count="1"><metadata type="object" key="name" value="Block"/><volume firstid="0" lastid="11"><metadata type="volume" key="name" value="Block"/></volume></object></config>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    expect((await fixed(bytes)).needsPrinter).toBe(true);
    const converted = await fixed(bytes, { printer: { id: "bambulab-p1s", nozzle: "0.4" } });
    expect(converted.issues[0]).toEqual({ check: "project", problem: "other-slicer", plate: null, fix: "convert" });
    const out = await settingsOf(converted.copy!);
    expect(out.printer_settings_id).toBe("Bambu Lab P1S 0.4 nozzle");
    // Bambu Studio's command line stops dead on a project naming no nozzle, which a converted one doesn't.
    expect(out.nozzle_diameter).toEqual(["0.4"]);
    expect((await fixed(converted.copy!)).issues).toEqual([]);
  });

  it("tests each no-print rectangle against what's printed there, by its outline", async () => {
    const { wipe_tower_x: _x, wipe_tower_y: _y, ...settings } = P1S_SETTINGS;
    const bytes = await bambuProject({
      objects: [
        // Over the first rectangle with none of its corners in it.
        { name: "Cover", mesh: box([-20, -20], [20, 20], 2) },
        // Between the two, where a box around both would be.
        { name: "Between", mesh: box([-10, -10], [10, 10], 2) },
      ],
      items: [
        { object: 0, at: [110, 110] },
        { object: 1, at: [160, 160] },
      ],
      settings: {
        ...settings,
        bed_exclude_area: ["100x100", "120x100", "120x120", "100x120", "200x200", "220x200", "220x220", "200x220"],
      },
    });
    expect((await fixed(bytes)).issues).toEqual([
      { check: "off-bed", problem: "off-bed", plate: 1, objects: ["Cover"], fix: null },
    ]);
  });

  it("reports a 3MF whose build prints nothing", async () => {
    const bytes = await bambuProject({ objects: [coin()], items: [] });
    expect((await fixed(bytes)).issues).toEqual([{ check: "project", problem: "unreadable", plate: null, fix: null }]);
  });

  it("doesn't merge objects that would then print taller than the printer", async () => {
    // Apart, the slicer lowers the body onto the bed; as one object it stays on the base, 11 mm up.
    const bytes = await bambuProject({
      objects: [
        { name: "Base", mesh: box([-20, -20], [20, 20], 9) },
        { name: "Body", mesh: box([-5, -5], [5, 5], 3, 8) },
      ],
      items: [
        { object: 0, at: [120, 120] },
        { object: 1, at: [120, 120] },
      ],
      settings: { ...P1S_SETTINGS, printable_height: "10" },
    });
    const { issues, copy } = await fixed(bytes);
    expect(issues).toEqual([
      { check: "overlapping-objects", problem: "overlapping-objects", plate: 1, objects: ["Base", "Body"], fix: null },
      { check: "off-bed", problem: "off-bed", plate: 1, objects: ["Base", "Body"], fix: null },
    ]);
    expect(copy).toBeNull();
  });

  it("reads build items however they quote their attributes", async () => {
    expect(attrValue(` objectid='2' transform = "1 0 0"`, "objectid")).toBe("2");
    expect(attrValue(` objectid='2' transform = "1 0 0"`, "transform")).toBe("1 0 0");
    for (const quoting of ["single", "spaced"] as const) {
      const bytes = await bambuProject({
        objects: [coin(), logo()],
        items: [
          { object: 0, at: [120, 120] },
          { object: 1, at: [120, 120] },
        ],
        quoting,
      });
      const { issues, copy } = await fixed(bytes);
      expect(issues.map((issue) => issue.problem)).toEqual(["overlapping-objects"]);
      const model = await (await JSZip.loadAsync(copy!)).file("3D/3dmodel.model")!.async("string");
      const items = model.match(/<item\b[^>]*>/g)!;
      expect(items).toHaveLength(1);
      expect(items[0].match(/objectid/g)).toHaveLength(1);
    }
  });

  it("counts every filament a split triangle is painted in", async () => {
    const { wipe_tower_x: _x, wipe_tower_y: _y, ...settings } = P1S_SETTINGS;
    // "8442": a triangle split into pieces on filaments 1 and 2, mostly 1.
    const bytes = await bambuProject({
      objects: [{ name: "Painted", mesh: box([-10, -10], [10, 10], 2), paint: "8442" }],
      items: [{ object: 0, at: [120, 120] }],
      settings,
    });
    expect((await fixed(bytes)).issues).toEqual([
      { check: "wipe-tower", problem: "no-tower-position", plate: 1, fix: "place-tower" },
    ]);
  });

  it("keeps each joining object's parts on their own filaments when its rows are out of order", async () => {
    const bytes = await bambuProject({
      objects: [
        coin(),
        {
          name: "Badge",
          parts: [
            { name: "Left", mesh: box([-8, -8], [0, 8], 1, 1.4), extruder: 2 },
            { name: "Right", mesh: box([0, -8], [8, 8], 1, 1.4), extruder: 3 },
          ],
          rowsReversed: true,
        },
      ],
      items: [
        { object: 0, at: [120, 120] },
        { object: 1, at: [120, 120] },
      ],
    });
    const { issues, copy } = await fixed(bytes);
    expect(issues.map((issue) => issue.problem)).toEqual(["overlapping-objects"]);
    const config = await (await JSZip.loadAsync(copy!)).file("Metadata/model_settings.config")!.async("string");
    const merged = config.match(/<object id="2">[\s\S]*?<\/object>/)![0];
    expect(
      [...merged.matchAll(/<part id="(\d+)"[\s\S]*?key="extruder" value="(\d+)"/g)].map((m) => [m[1], m[2]]),
    ).toEqual([
      ["1", "1"],
      ["200", "2"],
      ["201", "3"],
    ]);
  });

  it("keeps an object that another one is made of when it joins a third", async () => {
    const bytes = await bambuProject({
      objects: [coin(), logo(), { name: "Twin", of: { object: 1, dx: 80 } }],
      items: [
        { object: 0, at: [120, 120] },
        { object: 1, at: [120, 120] },
        { object: 2, at: [20, 200] },
      ],
    });
    const { issues, copy } = await fixed(bytes);
    expect(issues.map((issue) => [issue.problem, issue.objects])).toEqual([["overlapping-objects", ["Coin", "Logo"]]]);
    const zip = await JSZip.loadAsync(copy!);
    const model = await zip.file("3D/3dmodel.model")!.async("string");
    // The logo's object stays for the twin, made of it, though the logo itself is now part of the coin.
    expect(model).toMatch(/<object id="4"/);
    const layout = await readLayout(await readBambuPackage(zip));
    expect(layout.plates[0].items.map((item) => [item.name, item.parts.length])).toEqual([
      ["Coin", 2],
      ["Twin", 1],
    ]);
    expect((await fixed(copy!)).issues).toEqual([]);
  });

  it("joins an object's overlapping parts before testing it against another", async () => {
    // Read together by the even-odd rule, the parts' shared middle would be a hole, and the pin in it unseen.
    const bytes = await bambuProject({
      objects: [
        {
          name: "Bar",
          parts: [
            { name: "Left", mesh: box([0, 0], [10, 10], 2) },
            { name: "Right", mesh: box([4, 0], [14, 10], 2) },
          ],
        },
        { name: "Pin", mesh: box([5, 2], [9, 8], 2) },
      ],
      items: [
        { object: 0, at: [100, 100] },
        { object: 1, at: [100, 100] },
      ],
    });
    expect((await fixed(bytes)).issues).toEqual([
      {
        check: "overlapping-objects",
        problem: "overlapping-objects",
        plate: 1,
        objects: ["Bar", "Pin"],
        fix: "merge-objects",
      },
    ]);
  });

  it("sizes and places a tower as the slicer does: its brim, its turn and room for a bigger one", () => {
    const bed = { minX: 0, minY: 0, maxX: 256, maxY: 256 };
    const empty = (size: number) =>
      plateFootprint({ items: [], origin: [0, 0] }, { minX: 0, minY: 0, maxX: size, maxY: size }, []);
    const plate = { footprint: empty(256), filaments: 2, height: 50 };
    const base = towerSettings({ layer_height: "0.2", prime_tower_rib_wall: "0" });
    const [width, depth] = towerSize(plate, base);
    // No brim where it's 0; one by the tower's height where it's negative (4 mm at 50 mm).
    expect(towerFootprint(plate, { ...base, brim: 0 }, 100, 100)).toEqual({
      minX: 100,
      minY: 100,
      maxX: 100 + width,
      maxY: 100 + depth,
    });
    expect(towerFootprint(plate, { ...base, brim: -1 }, 100, 100).minX).toBeCloseTo(96, 5);
    // Turned 90 degrees about its corner, it reaches back along X.
    const turned = towerFootprint(plate, { ...base, brim: 0, rotation: 90 }, 100, 100);
    expect(turned.minX).toBeCloseTo(100 - depth, 5);
    expect(turned.maxY).toBeCloseTo(100 + width, 5);
    expect(placeTower(plate, bed, base).clear).toBe(true);
    // A bed too small for the bigger tower takes the project's own; one too small for either has no spot.
    const rib = towerSettings({ layer_height: "0.2" });
    expect(placeTower({ ...plate, footprint: empty(40), height: 2 }, { ...bed, maxX: 40, maxY: 40 }, rib).clear).toBe(
      true,
    );
    expect(placeTower({ ...plate, footprint: empty(20), height: 2 }, { ...bed, maxX: 20, maxY: 20 }, rib).clear).toBe(
      false,
    );
  });

  it("keeps the grid of what's on the bed bounded, whatever bed a file names", () => {
    const f = plateFootprint({ items: [], origin: [0, 0] }, { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 }, []);
    expect(f.cell).toBeGreaterThan(1);
    expect(f.taken.length).toBeLessThanOrEqual(4_000_000);
  });

  it("leaves to the slicer a merge that would put a part where another object is", async () => {
    // The bead floats over the coin, so alone the slicer lowers it into the coin; kept at its height as a part of the
    // coin, it would print into the arch, which clears both as they are.
    const bytes = await bambuProject({
      objects: [
        coin(),
        { name: "Bead", mesh: box([-5, -5], [5, 5], 2, 10) },
        {
          name: "Arch",
          parts: [
            { name: "Left", mesh: box([-30, -5], [-25, 5], 12) },
            { name: "Right", mesh: box([25, -5], [30, 5], 12) },
            { name: "Top", mesh: box([-30, -5], [30, 5], 2, 10) },
          ],
        },
      ],
      items: [
        { object: 0, at: [120, 120] },
        { object: 1, at: [120, 120] },
        { object: 2, at: [120, 120] },
      ],
    });
    const { issues, copy } = await fixed(bytes);
    expect(issues).toEqual([
      { check: "overlapping-objects", problem: "overlapping-objects", plate: 1, objects: ["Coin", "Bead"], fix: null },
    ]);
    expect(copy).toBeNull();
  });

  it("slices where the geometry changes, so thin feet of tall objects are seen", async () => {
    // Columns 100 mm tall, apart, on 0.6 mm feet that overlap: evenly spaced heights would all miss the feet.
    const footed = (x: number, column: number) => ({
      name: `Column ${x}`,
      parts: [
        { name: "Foot", mesh: box([x, 0], [x + 30, 10], 0.6) },
        { name: "Column", mesh: box([column, 0], [column + 5, 10], 100) },
      ],
    });
    const bytes = await bambuProject({
      objects: [footed(0, 0), footed(20, 45)],
      items: [
        { object: 0, at: [100, 100] },
        { object: 1, at: [100, 100] },
      ],
    });
    expect((await fixed(bytes)).issues.map((issue) => [issue.problem, issue.fix])).toEqual([
      ["overlapping-objects", "merge-objects"],
    ]);
  });

  it("leaves out build items marked not to print, and reads one whose object is in another model part", async () => {
    const zip = await JSZip.loadAsync(
      await bambuProject({
        objects: [coin(), { name: "Far", mesh: box([-4, -4], [4, 4], 2) }, logo()],
        items: [
          { object: 0, at: [120, 120] },
          { object: 1, at: [300, 120] },
          { object: 2, at: [120, 120] },
        ],
      }),
    );
    const model = await zip.file("3D/3dmodel.model")!.async("string");
    zip.file(
      "3D/3dmodel.model",
      model
        .replace(/(<item objectid="4"[^>]*)printable="1"/, '$1printable="false"')
        // The logo's build item names its mesh in its own model part.
        .replace(/<item objectid="6"/, '<item p:path="/3D/Objects/object_3.model" objectid="5"'),
    );
    const { issues, copy } = await fixed(await zip.generateAsync({ type: "uint8array" }));
    // The far object doesn't print, so isn't off the bed; the logo is read from its part and overlaps the coin, but a
    // merge can't move an object out of its own model part.
    expect(issues).toEqual([
      {
        check: "overlapping-objects",
        problem: "overlapping-objects",
        plate: 1,
        objects: ["Coin", "Object 5"],
        fix: null,
      },
    ]);
    expect(copy).toBeNull();
  });

  it("reads a settings entry with a single-quoted id, and a mesh's bad triangles not at all", async () => {
    const zip = await JSZip.loadAsync(
      await bambuProject({
        objects: [coin(), logo()],
        items: [
          { object: 0, at: [120, 120] },
          { object: 1, at: [120, 120] },
        ],
      }),
    );
    const config = await zip.file("Metadata/model_settings.config")!.async("string");
    zip.file("Metadata/model_settings.config", config.replace('<object id="4">', "<object id='4'>"));
    const part = await zip.file("3D/Objects/object_2.model")!.async("string");
    zip.file(
      "3D/Objects/object_2.model",
      part.replace("</triangles>", '<triangle v1="-1" v2="0" v3="1"/></triangles>'),
    );
    const { issues, copy } = await fixed(await zip.generateAsync({ type: "uint8array" }));
    expect(issues.map((issue) => issue.problem)).toEqual(["overlapping-objects"]);
    const merged = (await (await JSZip.loadAsync(copy!)).file("Metadata/model_settings.config")!.async("string")).match(
      /<object id="2">[\s\S]*?<\/object>/,
    )![0];
    expect(
      [...merged.matchAll(/<part id="(\d+)"[\s\S]*?key="extruder" value="(\d+)"/g)].map((m) => [m[1], m[2]]),
    ).toEqual([
      ["1", "1"],
      ["3", "2"],
    ]);
  });

  it("reads attributes and paint however deep or strangely written, and undoes tiny scales", () => {
    expect(attrValue(` partnumber='note objectid="7"' objectid='2'`, "objectid")).toBe("2");
    expect(() => paintStates("F".repeat(100_000))).not.toThrow();
    const undone = invertTransform([1e-5, 0, 0, 0, 1e-5, 0, 0, 0, 1e-5, 1, 2, 3])!;
    [1e5, 0, 0, 0, 1e5, 0, 0, 0, 1e5, -1e5, -2e5, -3e5].forEach((n, i) => expect(undone[i]).toBeCloseTo(n, 3));
    expect(invertTransform([1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 2, 3])).toBeNull();
  });

  it("finds a tower room right up to the bed's edges, and stays bounded far from the origin", () => {
    const flat = towerSettings({ layer_height: "0.2", prime_tower_rib_wall: "0", prime_tower_brim_width: "0" });
    const bed = { minX: 0, minY: 0, maxX: 36, maxY: 80 };
    const plate = { footprint: plateFootprint({ items: [], origin: [0, 0] }, bed, []), filaments: 2, height: 2 };
    // A 35 mm tower on a 36 mm bed only fits without the 2 mm kept from the edges.
    expect(placeTower(plate, bed, flat).clear).toBe(true);
    const far = { minX: 1e17, minY: 1e17, maxX: 1e17 + 256, maxY: 1e17 + 256 };
    const farPlate = {
      ...plate,
      footprint: plateFootprint({ items: [], origin: [0, 0] }, far, [{ ...far, minY: -1e12 }]),
    };
    expect(placeTower(farPlate, far, flat).clear).toBe(false);
  });

  it("counts a part's own filament only where some of it isn't painted another", async () => {
    const { wipe_tower_x: _x, wipe_tower_y: _y, ...settings } = P1S_SETTINGS;
    // On filament 1, every triangle painted 2: one filament, no tower.
    const bytes = await bambuProject({
      objects: [{ name: "Painted", mesh: box([-10, -10], [10, 10], 2), paint: "8", extruder: 1 }],
      items: [{ object: 0, at: [120, 120] }],
      settings,
    });
    expect((await fixed(bytes)).issues).toEqual([]);
  });

  it("rewrites only the attribute it means, and reads metadata in either order", async () => {
    expect(withAttr(`<item partnumber='note objectid="7"' objectid='2'/>`, "objectid", "9")).toBe(
      `<item partnumber='note objectid="7"' objectid="9"/>`,
    );
    const mergedLogo = async (parts: number) => {
      const zip = await JSZip.loadAsync(
        await bambuProject({
          objects: [
            coin(),
            {
              name: "Logo",
              parts: Array.from({ length: parts }, (_, k) => ({
                name: `Logo ${k}`,
                mesh: box([-8 + k, -8], [-7 + k, 8], 1, 1.4),
                extruder: 3,
              })),
              extruder: 2,
            },
          ],
          items: [
            { object: 0, at: [120, 120] },
            { object: 1, at: [120, 120] },
          ],
        }),
      );
      const config = await zip.file("Metadata/model_settings.config")!.async("string");
      zip.file(
        "Metadata/model_settings.config",
        config.replace('<metadata key="extruder" value="3"/>', '<metadata value="3" key="extruder"/>'),
      );
      const { copy } = await fixed(await zip.generateAsync({ type: "uint8array" }));
      const merged = await (await JSZip.loadAsync(copy!)).file("Metadata/model_settings.config")!.async("string");
      return merged.match(/<part id="200"[\s\S]*?<\/part>/)![0];
    };
    // Its own filament, 3, kept, written value first: not the object's 2 added after it.
    const own = await mergedLogo(2);
    expect(own.match(/extruder/g)).toHaveLength(1);
    expect(own).toContain('value="3" key="extruder"');
    // An object's only volume prints in the object's filament whatever it says, so it joins on that one.
    const lone = await mergedLogo(1);
    expect(lone.match(/extruder/g)).toHaveLength(1);
    expect(lone).toContain('value="2" key="extruder"');
  });

  it("never fills the grid from an area off it, and finds a clear tower spot where the best-ranked isn't", () => {
    const bed = { minX: 0, minY: 0, maxX: 35, maxY: 30 };
    const off = plateFootprint({ items: [], origin: [0, 0] }, bed, [{ minX: -20, minY: 0, maxX: -10, maxY: 10 }]);
    expect(off.taken.every((cell) => cell === 0)).toBe(true);
    // Taken: a sliver down the left edge, which every spot touches, and a block at the back.
    const footprint = plateFootprint({ items: [], origin: [0, 0] }, bed, [
      { minX: 0, minY: 0, maxX: 0.9, maxY: 30 },
      { minX: 10, minY: 25, maxX: 20, maxY: 30 },
    ]);
    const flat = towerSettings({
      layer_height: "0.2",
      prime_tower_rib_wall: "0",
      prime_tower_brim_width: "0",
      filament_prime_volume: ["10"],
    });
    expect(placeTower({ footprint, filaments: 2, height: 2 }, bed, flat).clear).toBe(true);
  });

  it("reads the project as its slicer would even where the site lists no project check", async () => {
    const bytes = await bambuProject({
      objects: [coin()],
      items: [{ object: 0, at: [128, 128] }],
      app: "OrcaSlicer-2.3.0",
    });
    const run = await runThreeMfCheck(bytes, { ...RULES, checks: ["off-bed"] });
    expect(run.result.issues).toEqual([{ check: "project", problem: "other-app", plate: null, fix: "retag" }]);
    expect(run.zip).not.toBeNull();
  });

  it("leaves to the slicer objects made of components of components, and those a side file keeps settings for", async () => {
    // The twin is made of the logo's object, which is made of its mesh: rows the merge can't match.
    const nested = await bambuProject({
      objects: [coin(), logo(), { name: "Twin", of: { object: 1, dx: 0 } }],
      items: [
        { object: 0, at: [120, 120] },
        { object: 2, at: [120, 120] },
      ],
    });
    expect((await fixed(nested)).issues).toEqual([
      { check: "overlapping-objects", problem: "overlapping-objects", plate: 1, objects: ["Coin", "Twin"], fix: null },
    ]);
    const ranged = await bambuProject({
      objects: [coin(), logo()],
      items: [
        { object: 0, at: [120, 120] },
        { object: 1, at: [120, 120] },
      ],
      // Single-quoted, as an XML writer may: the logo's (the second object's) height range.
      files: {
        "Metadata/layer_config_ranges.xml": `<objects><object id='2'><range min_z="0" max_z="1"/></object></objects>`,
      },
    });
    expect((await fixed(ranged)).issues.map((issue) => issue.fix)).toEqual([null]);
  });

  it("reads tags whose values hold a '>' or a character reference", async () => {
    const zip = await JSZip.loadAsync(
      await bambuProject({
        objects: [
          coin(),
          logo(),
          { name: "Plain", mesh: box([-5, -5], [5, 5], 2) },
          { name: "Painted", mesh: box([-5, -5], [5, 5], 2), paint: "&#56;" },
        ],
        items: [
          { object: 0, at: [120, 120] },
          { object: 1, at: [120, 120] },
          { object: 2, at: [40, 40] },
          { object: 3, at: [40, 80] },
        ],
        settings: { ...P1S_SETTINGS, wipe_tower_x: ["165"], wipe_tower_y: ["200"] },
      }),
    );
    const model = await zip.file("3D/3dmodel.model")!.async("string");
    zip.file(
      "3D/3dmodel.model",
      model
        .replace('<item objectid="4"', '<item partnumber="A > B" objectid="4"')
        .replace('<object id="2" ', '<object id="2" name="A > B" '),
    );
    const { issues, copy } = await fixed(await zip.generateAsync({ type: "uint8array" }));
    // The logo's item is read past its '>', and the painted object's &#56; is filament 2.
    expect(issues.map((issue) => issue.problem)).toEqual(["overlapping-objects"]);
    const merged = await (await JSZip.loadAsync(copy!)).file("3D/3dmodel.model")!.async("string");
    expect(merged).toMatch(/<object id="2" name="A > B" /);
    expect((await fixed(copy!)).issues).toEqual([]);
    expect(paintStates(attrValue(` paint_color="&#56;"`, "paint_color")!)).toEqual([2]);
  });

  it("gives a merged object an id no resource has, and keeps tiny relative scales exact", async () => {
    const zip = await JSZip.loadAsync(
      await bambuProject({
        objects: [{ name: "Coin", mesh: box([-2e-7, -2e-7], [2e-7, 2e-7], 2e-8) }, logo()],
        items: [
          { object: 0, at: [120, 120] },
          { object: 0, at: [120, 120], plate: 2 },
          { object: 1, at: [120, 120] },
        ],
        plates: 2,
      }),
    );
    const model = await zip.file("3D/3dmodel.model")!.async("string");
    zip.file(
      "3D/3dmodel.model",
      model
        .replace(
          " <resources>",
          ' <resources>\n  <basematerials id="7"><base name="White" displaycolor="#FFFFFF"/></basematerials>',
        )
        // The coin is scaled up by its build item from a mesh a hundred-millionth its size.
        .replaceAll(
          '<item objectid="2" transform="1 0 0 0 1 0 0 0 1',
          '<item objectid="2" transform="1e8 0 0 0 1e8 0 0 0 1e8',
        ),
    );
    const { issues, copy } = await fixed(await zip.generateAsync({ type: "uint8array" }));
    expect(issues.map((issue) => [issue.problem, issue.plate])).toEqual([["overlapping-objects", 1]]);
    const out = await JSZip.loadAsync(copy!);
    expect(
      [...(await out.file("3D/3dmodel.model")!.async("string")).matchAll(/<item objectid="(\d+)"/g)].map((m) => m[1]),
    ).toEqual(["8", "2"]);
    const [merged] = (await readLayout(await readBambuPackage(out))).plates[0].items;
    expectBox(boundsOf(merged, 1), { min: [112, 112, 1.4], max: [128, 128, 2.4] });
  });

  it("finds overlaps between vertex heights, and doesn't count area past the shared band", async () => {
    const slanted: MeshSpec = {
      vertices: [0, 1, 2, 3, 4, 5, 6, 7].map((i): Vec3 => [
        (i & 4 ? 40 : 0) + (i & 1 ? 74 : 72),
        i & 2 ? 2 : 0,
        i & 4 ? 10 : 0,
      ]),
      triangles: box([0, 0], [1, 1], 1).triangles,
    };
    const crossing = await bambuProject({
      objects: [
        { name: "Slanted", mesh: slanted },
        { name: "Upright", mesh: box([80, 0], [82, 2], 10) },
      ],
      items: [
        { object: 0, at: [20, 100] },
        { object: 1, at: [20, 100] },
      ],
    });
    expect((await fixed(crossing)).issues.map((issue) => issue.problem)).toEqual(["overlapping-objects"]);
    // 3 mm by 0.06 mm shared: 0.18 mm², under the 0.25 that counts.
    const grazing = await bambuProject({
      objects: [
        { name: "A", mesh: box([0, 0], [10, 10], 2) },
        { name: "B", mesh: box([7, 9.94], [17, 20], 2) },
      ],
      items: [
        { object: 0, at: [100, 100] },
        { object: 1, at: [100, 100] },
      ],
    });
    expect((await fixed(grazing)).issues).toEqual([]);
  });

  it("places a tower only at coordinates as they're written, in a gap narrower than a step, and on any bed", () => {
    const flat = (extra: Record<string, unknown> = {}) =>
      towerSettings({
        layer_height: "0.2",
        prime_tower_rib_wall: "0",
        prime_tower_brim_width: "0",
        filament_prime_volume: ["10"],
        ...extra,
      });
    // Only X = 0.0004 fits, which isn't a thousandth: nothing as written does.
    const shifted = { minX: 0.0004, minY: 0, maxX: 35.0004, maxY: 60 };
    const free = (bed: typeof shifted, exclude: Box2[] = []) =>
      plateFootprint({ items: [], origin: [0, 0] }, bed, exclude);
    expect(placeTower({ footprint: free(shifted), filaments: 2, height: 2 }, shifted, flat()).clear).toBe(false);
    // Taken at X 0-1.5 and 36.9-40: a 35.8 mm tower fits only at X 1-1.2, between the search's steps.
    const narrow = { minX: 0, minY: 0, maxX: 40, maxY: 20 };
    const footprint = free(narrow, [
      { minX: 0, minY: 0, maxX: 1.5, maxY: 20 },
      { minX: 36.9, minY: 0, maxX: 40, maxY: 20 },
    ]);
    const placed = placeTower({ footprint, filaments: 2, height: 2 }, narrow, flat({ prime_tower_width: "35.8" }));
    expect(placed.clear).toBe(true);
    expect(placed.spot[0]).toBeGreaterThanOrEqual(1);
    expect(placed.spot[0]).toBeLessThanOrEqual(1.2);
    // A bed whose cells had to grow still covers all of it.
    const big = plateFootprint({ items: [], origin: [0, 0] }, { minX: 0, minY: 0, maxX: 3000, maxY: 2000 }, []);
    expect(big.cols * big.rows).toBeLessThanOrEqual(4_000_000);
    expect(big.cols * big.cell).toBeGreaterThanOrEqual(3000);
    expect(big.rows * big.cell).toBeGreaterThanOrEqual(2000);
  });

  it("counts the filaments a plate really prints in: supports', and no paint Bambu Studio would drop", async () => {
    const { wipe_tower_x: _x, wipe_tower_y: _y, ...settings } = P1S_SETTINGS;
    const one = (extra: Record<string, unknown>, paint?: string) =>
      bambuProject({
        objects: [{ name: "Block", mesh: box([-10, -10], [10, 10], 2), extruder: 1, paint }],
        items: [{ object: 0, at: [120, 120] }],
        settings: { ...settings, ...extra },
      });
    const tower = [{ check: "wipe-tower", problem: "no-tower-position", plate: 1, fix: "place-tower" }];
    expect((await fixed(await one({ enable_support: "1", support_filament: "2" }))).issues).toEqual(tower);
    expect((await fixed(await one({ enable_support: "0", support_filament: "2" }))).issues).toEqual([]);
    // "8Z" isn't all hex: the slicer drops it, and the block prints in its own filament alone.
    expect((await fixed(await one({}, "8Z"))).issues).toEqual([]);
  });

  it("says which objects it can't read, and leaves out build items in comments", async () => {
    const zip = await JSZip.loadAsync(
      await bambuProject({
        objects: [coin(), { name: "Broken", mesh: box([-4, -4], [4, 4], 2) }],
        items: [
          { object: 0, at: [120, 120] },
          { object: 1, at: [40, 40] },
        ],
      }),
    );
    const part = await zip.file("3D/Objects/object_2.model")!.async("string");
    zip.file("3D/Objects/object_2.model", part.replace(/y="-4"/g, 'y="abc"'));
    const model = await zip.file("3D/3dmodel.model")!.async("string");
    zip.file(
      "3D/3dmodel.model",
      model.replace(" </build>", ' <!-- <item objectid="2" transform="1 0 0 0 1 0 0 0 1 400 400 0"/> -->\n </build>'),
    );
    expect((await fixed(await zip.generateAsync({ type: "uint8array" }))).issues).toEqual([
      { check: "project", problem: "unreadable", plate: 1, objects: ["Broken"], fix: null },
    ]);
  });

  it("checks only for slicers that read Bambu Studio projects", async () => {
    const bytes = await bambuProject({ objects: [coin()], items: [{ object: 0, at: [128, 128] }] });
    await expect(runThreeMfCheck(bytes, { ...RULES, slicer: "prusaslicer" })).rejects.toThrow(/Bambu Studio projects/);
  });

  it("writes a merged object after the objects it's made of, with an id in the 3MF's range", async () => {
    const zip = await JSZip.loadAsync(
      await bambuProject({
        objects: [coin(), logo()],
        items: [
          { object: 0, at: [120, 120] },
          { object: 0, at: [120, 120], plate: 2 },
          { object: 1, at: [120, 120] },
        ],
        plates: 2,
      }),
    );
    const model = await zip.file("3D/3dmodel.model")!.async("string");
    zip.file(
      "3D/3dmodel.model",
      model
        .replace(
          " <resources>",
          ' <resources>\n  <basematerials id="2147483647"><base name="White" displaycolor="#FFFFFF"/></basematerials>',
        )
        // The logo as a mesh of the main model's own, declared after the coin.
        .replace(/<object id="4"[\s\S]*?<\/object>/, `<object id="4" type="model">${meshXml(logo().mesh)}</object>`),
    );
    const { issues, copy } = await fixed(await zip.generateAsync({ type: "uint8array" }));
    expect(issues.map((issue) => issue.problem)).toEqual(["overlapping-objects"]);
    const out = await (await JSZip.loadAsync(copy!)).file("3D/3dmodel.model")!.async("string");
    // Past the largest id there is, the lowest free one; and the object comes after the mesh it uses.
    expect([...out.matchAll(/<item objectid="(\d+)"/g)].map((m) => m[1])).toEqual(["1", "2"]);
    expect(out.indexOf('<object id="4"')).toBeLessThan(out.indexOf('<object id="1"'));
  });

  it("fills overlapping shells of one mesh, and samples the last row inside the shared band", async () => {
    const shells = await bambuProject({
      objects: [
        { name: "Bar", mesh: joined(box([0, 0], [10, 10], 2), box([4, 0], [14, 10], 2)) },
        { name: "Pin", mesh: box([5, 2], [9, 8], 2) },
      ],
      items: [
        { object: 0, at: [100, 100] },
        { object: 1, at: [100, 100] },
      ],
    });
    expect((await fixed(shells)).issues.map((issue) => issue.problem)).toEqual(["overlapping-objects"]);
    // 2 mm by 0.13 mm shared: 0.26 mm², just over the 0.25 that counts.
    const thin = await bambuProject({
      objects: [
        { name: "A", mesh: box([0, 0], [10, 10], 2) },
        { name: "B", mesh: box([8, 9.87], [18, 20], 2) },
      ],
      items: [
        { object: 0, at: [100, 100] },
        { object: 1, at: [100, 100] },
      ],
    });
    expect((await fixed(thin)).issues.map((issue) => issue.problem)).toEqual(["overlapping-objects"]);
  });

  it("sizes a two-nozzle tower with its changes, and keeps the whole tower off a no-print area", () => {
    const plate = (bed: Box2, exclude: Box2[] = []) => ({
      footprint: plateFootprint({ items: [], origin: [0, 0] }, bed, exclude),
      exclude,
      filaments: 2,
      height: 2,
    });
    const bed = { minX: 0, minY: 0, maxX: 256, maxY: 256 };
    const dual = towerSettings({
      layer_height: "0.2",
      prime_tower_rib_wall: "0",
      prime_tower_brim_width: "0",
      filament_prime_volume: ["15", "15"],
      nozzle_diameter: ["0.4", "0.4"],
      filament_change_length: ["20", "20"],
      filament_diameter: ["1.75", "1.75"],
    });
    expect(towerSize(plate(bed), dual)[1]).toBeGreaterThan(towerSize(plate(bed), { ...dual, changeVolume: 0 })[1]);
    // A strip at X 10-11 the whole bed deep: a brimless tower from X 10 reaches into it.
    const strip = [{ minX: 10, minY: 0, maxX: 11, maxY: 256 }];
    expect(towerClear(plate(bed, strip), bed, dual, 10, 100)).toBe(false);
    // A 35.8 x 5.8 tower on a 40 x 10 bed whose edges are taken fits only at about (1.01-1.19, 1.01-1.19).
    const small = { minX: 0, minY: 0, maxX: 40, maxY: 10 };
    const edges = [
      { minX: 0, minY: 0, maxX: 1.01, maxY: 10 },
      { minX: 36.99, minY: 0, maxX: 40, maxY: 10 },
      { minX: 0, minY: 0, maxX: 40, maxY: 1.01 },
      { minX: 0, minY: 6.99, maxX: 40, maxY: 10 },
    ];
    const snug = towerSettings({
      layer_height: "0.2",
      prime_tower_rib_wall: "0",
      prime_tower_brim_width: "0",
      prime_tower_width: "35.8",
      filament_prime_volume: ["27.69"],
    });
    expect(towerSize(plate(small, edges), snug)[1]).toBeCloseTo(5.8, 2);
    expect(placeTower(plate(small, edges), small, snug).clear).toBe(true);
  });

  describe("in a worker", () => {
    let dir: string;
    beforeAll(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-3mf-check-"));
    });
    afterAll(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    it("writes the copy beside the file and leaves the file as it was", async () => {
      const src = path.join(dir, "coin.3mf");
      const dest = path.join(dir, "coin.makerworld.3mf");
      const bytes = await bambuProject({
        objects: [coin(), logo()],
        items: [
          { object: 0, at: [120, 120] },
          { object: 1, at: [120, 120] },
        ],
      });
      await fs.writeFile(src, bytes);
      const result = await fixThreeMf(src, dest, RULES);
      expect(result.written).toBe(true);
      expect(result.issues.map((issue) => issue.problem)).toEqual(["overlapping-objects"]);
      expect(new Uint8Array(await fs.readFile(src))).toEqual(bytes);
      expect((await checkThreeMf(dest, RULES)).issues).toEqual([]);
    });

    it("never writes the copy over a file already there, the checked one least of all", async () => {
      const src = path.join(dir, "kept.3mf");
      const bytes = await bambuProject({
        objects: [coin(), logo()],
        items: [
          { object: 0, at: [120, 120] },
          { object: 1, at: [120, 120] },
        ],
      });
      await fs.writeFile(src, bytes);
      await expect(fixThreeMf(src, src, RULES)).rejects.toThrow(/EEXIST/);
      expect(new Uint8Array(await fs.readFile(src))).toEqual(bytes);
      // What the worker wrote it to first is gone either way.
      expect((await fs.readdir(dir)).filter((name) => name.endsWith(".part"))).toEqual([]);
      // A name as long as one may be still gets its copy: the worker's file has a short name of its own.
      const long = path.join(dir, `${"é".repeat(110)}.3mf`);
      expect((await fixThreeMf(src, long, RULES)).written).toBe(true);
    });
  });
});
