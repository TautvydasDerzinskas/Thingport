// Checks the parts of the tool that are worth being sure of: that each kind of file is read into the triangles it
// really holds, that a measured solid comes out with the volume it has, that the estimate and the price are the
// arithmetic they claim to be, and that a sliced file's own figures are read as each slicer writes them.
//   node source/test_estimator.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fits, measure, scaled } from "./geometry.js";
import { readMesh } from "./mesh.js";
import { DENSITIES, MATERIAL, PRINTER, estimate } from "./estimate.js";
import { BUSINESS, LAYERS, price } from "./cost.js";
import { parseDuration, parseGcode, parseSliceInfo, platesToValues, readSliced } from "./slicer.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------- fixtures */

/** A box of the given size at the origin, wound outward: eight corners, twelve triangles. */
function box(x, y, z, at = [0, 0, 0]) {
  const corners = [
    [0, 0, 0],
    [x, 0, 0],
    [x, y, 0],
    [0, y, 0],
    [0, 0, z],
    [x, 0, z],
    [x, y, z],
    [0, y, z],
  ].map((corner) => corner.map((value, axis) => value + at[axis]));
  const quads = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  const out = [];
  for (const [a, b, c, d] of quads) {
    for (const triangle of [
      [a, b, c],
      [a, c, d],
    ]) {
      for (const corner of triangle) out.push(...corners[corner]);
    }
  }
  return new Float32Array(out);
}

/** Two solids measured as one mesh: measure() adds triangles up, it doesn't care that they don't touch. */
function withBoth(a, b) {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

const binaryStl = (triangles) => {
  const count = triangles.length / 9;
  const bytes = new Uint8Array(84 + count * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, count, true);
  for (let i = 0; i < count; i++) {
    let at = 84 + i * 50 + 12;
    for (let v = 0; v < 9; v++, at += 4) view.setFloat32(at, triangles[i * 9 + v], true);
  }
  return bytes;
};

/** A ZIP of stored (uncompressed) entries, which is all a 3MF has to be to be read. */
function zip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const bytes = (length) => new Uint8Array(length);
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const header = bytes(30);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    chunks.push(header, nameBytes, data);

    const entry = bytes(46);
    const entryView = new DataView(entry.buffer);
    entryView.setUint32(0, 0x02014b50, true);
    entryView.setUint16(4, 20, true);
    entryView.setUint16(6, 20, true);
    entryView.setUint32(20, data.length, true);
    entryView.setUint32(24, data.length, true);
    entryView.setUint16(28, nameBytes.length, true);
    entryView.setUint32(42, offset, true);
    central.push(entry, nameBytes);
    offset += header.length + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((total, part) => total + part.length, 0);
  const end = bytes(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, Object.keys(files).length, true);
  endView.setUint16(10, Object.keys(files).length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A 3MF holding one box, in the unit and with the transform given. */
function threeMf({ unit = "millimeter", transform = null, size = [10, 10, 10] } = {}) {
  const triangles = box(...size);
  const points = [];
  const faces = [];
  const seen = new Map();
  for (let i = 0; i < triangles.length; i += 3) {
    const key = `${triangles[i]},${triangles[i + 1]},${triangles[i + 2]}`;
    if (!seen.has(key)) {
      seen.set(key, points.length);
      points.push([triangles[i], triangles[i + 1], triangles[i + 2]]);
    }
    faces.push(seen.get(key));
  }
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices>${points.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join("")}</vertices>
    <triangles>${Array.from({ length: faces.length / 3 }, (_, i) => `<triangle v1="${faces[i * 3]}" v2="${faces[i * 3 + 1]}" v3="${faces[i * 3 + 2]}"/>`).join("")}</triangles>
   </mesh>
  </object>
 </resources>
 <build><item objectid="1"${transform ? ` transform="${transform.join(" ")}"` : ""}/></build>
</model>`;
  return zip({ "[Content_Types].xml": "<Types/>", "3D/3dmodel.model": model });
}

/* --------------------------------------------------------------- the mesh */

test("a binary STL is read into the triangles it holds", async () => {
  const mesh = await readMesh(binaryStl(box(20, 20, 20)), "cube.stl");
  assert.equal(mesh.format, "STL");
  assert.equal(mesh.triangles.length, 12 * 9);
  assert.ok(Math.abs(measure(mesh.triangles).volume - 8000) < 1e-6);
});

test("a text STL is read, and told apart from a binary one", async () => {
  const triangles = box(10, 10, 10);
  let text = "solid cube\n";
  for (let i = 0; i < triangles.length; i += 9) {
    text += "facet normal 0 0 0\n outer loop\n";
    for (let v = 0; v < 3; v++) {
      text += `  vertex ${triangles[i + v * 3]} ${triangles[i + v * 3 + 1]} ${triangles[i + v * 3 + 2]}\n`;
    }
    text += " endloop\nendfacet\n";
  }
  text += "endsolid cube\n";
  const mesh = await readMesh(new TextEncoder().encode(text), "cube.stl");
  assert.equal(mesh.triangles.length, 12 * 9);
  assert.equal(Math.round(measure(mesh.triangles).volume), 1000);
});

test("an OBJ's quads are split, and an index from the end counts back", async () => {
  const obj = [
    "v 0 0 0",
    "v 10 0 0",
    "v 10 10 0",
    "v 0 10 0",
    "f 1 2 3 4", // one quad, which has to come out as two triangles
    "f -4 -3 -2", // the same corners again, counted from the end
  ].join("\n");
  const mesh = await readMesh(new TextEncoder().encode(obj), "plate.obj");
  assert.equal(mesh.triangles.length, 3 * 9);
  const measured = measure(mesh.triangles);
  assert.equal(Math.round(measured.area), 150); // 100 of quad + 50 of the loose triangle
});

test("a 3MF is read in its own unit, with the build's transform applied", async () => {
  const plain = await readMesh(threeMf(), "part.3mf");
  assert.equal(Math.round(measure(plain.triangles).volume), 1000);

  // Centimetres: every coordinate is ten times as long, so the volume is a thousand times as large.
  const centimetres = await readMesh(threeMf({ unit: "centimeter" }), "part.3mf");
  assert.equal(Math.round(measure(centimetres.triangles).volume), 1000 * 1000);

  // Twice as large in x, and moved: the volume doubles and the box moves with it.
  const scaledUp = await readMesh(threeMf({ transform: [2, 0, 0, 0, 1, 0, 0, 0, 1, 5, 0, 0] }), "part.3mf");
  const measured = measure(scaledUp.triangles);
  assert.equal(Math.round(measured.volume), 2000);
  assert.equal(measured.box.min[0], 5);
  assert.equal(measured.box.max[0], 25);
});

test("a file this can't measure says so, and says what to do", async () => {
  await assert.rejects(() => readMesh(new Uint8Array([1, 2, 3]), "part.step"), /STL or 3MF/);
  await assert.rejects(() => readMesh(new Uint8Array(0), "part.stl"), /empty/);
});

/* ---------------------------------------------------------- the measuring */

test("a closed box is closed, and one with a face missing isn't", () => {
  const whole = measure(box(20, 20, 20));
  assert.equal(whole.closed, true);
  assert.equal(whole.inverted, false);

  // The last two triangles are one face of the box; without them the mesh is open.
  const open = measure(box(20, 20, 20).slice(0, 10 * 9));
  assert.equal(open.closed, false);
});

test("faces wound the wrong way are noticed, and the volume is still right", () => {
  const triangles = box(20, 20, 20);
  const flipped = new Float32Array(triangles.length);
  // Swapping two corners of every triangle turns the solid inside out.
  for (let i = 0; i < triangles.length; i += 9) {
    for (let v = 0; v < 3; v++) {
      flipped[i + v] = triangles[i + v];
      flipped[i + 3 + v] = triangles[i + 6 + v];
      flipped[i + 6 + v] = triangles[i + 3 + v];
    }
  }
  const measured = measure(flipped);
  assert.equal(measured.inverted, true);
  assert.ok(Math.abs(measured.volume - 8000) < 1e-6);
});

test("the overhang is what needs holding up, not merely what points down", () => {
  // A box's underside faces straight down, but it sits on the plate: nothing has to be printed under it. A slicer
  // drops a part onto the bed, so the height that matters is above the part's own base, not above wherever the file
  // happens to put it.
  const onThePlate = measure(box(20, 20, 20));
  assert.equal(onThePlate.support.area, 0);
  assert.equal(onThePlate.support.volume, 0);
  assert.equal(
    onThePlate.faces.reduce((total, face) => total + face, 0),
    0,
  );
  assert.equal(measure(box(20, 20, 20, [0, 0, 37])).support.volume, 0);

  // A table: a 20 × 20 top 10 mm up, over a plate on the bed. Only the top's underside needs holding up.
  const table = measure(withBoth(box(20, 20, 2), box(20, 20, 2, [0, 0, 10])));
  assert.equal(Math.round(table.support.area), 400);
  assert.equal(Math.round(table.support.volume), 400 * 10);
  // Two triangles make that underside, and they are the two the viewer picks out.
  assert.equal(
    table.faces.reduce((total, face) => total + face, 0),
    2,
  );

  // Every face of a box is either flat or vertical, so a stricter threshold changes nothing about it.
  assert.equal(
    Math.round(measure(withBoth(box(20, 20, 2), box(20, 20, 2, [0, 0, 10])), { overhang: 10 }).support.area),
    400,
  );
});

test("a scale moves lengths, areas and volumes by the right power", () => {
  const measured = measure(box(10, 10, 10));
  const twice = scaled(measured, 200);
  assert.equal(twice.volume, measured.volume * 8);
  assert.equal(twice.area, measured.area * 4);
  assert.equal(twice.box.size[0], 20);
  assert.equal(scaled(measured, 100), measured);
});

test("a part too big for the bed is caught, turned or not", () => {
  const bed = { x: 256, y: 256, z: 256 };
  assert.equal(fits([100, 100, 100], bed).fits, true);
  assert.equal(fits([300, 100, 100], bed).fits, false);
  // Long one way and narrow the other: it fits, but only turned.
  const turned = fits([200, 100, 100], { x: 120, y: 240, z: 256 });
  assert.equal(turned.fits, true);
  assert.equal(turned.turned, true);
  // Too tall is too tall whichever way round it goes.
  assert.equal(fits([10, 10, 400], bed).fits, false);
});

/* ---------------------------------------------------------- the estimate */

const printer = { ...PRINTER, density: MATERIAL.density };

test("the skin is the walls and the solid layers, and the infill fills what's left", () => {
  const measured = measure(box(20, 20, 20));
  const estimated = estimate(measured, printer);
  // Two walls of 0.42 over 1600 mm² of wall, four layers of 0.2 over 800 mm² of top and bottom.
  assert.equal(Math.round(estimated.skinVolume), Math.round(1600 * 0.84 + 800 * 0.8));
  const inside = 8000 - estimated.skinVolume;
  assert.ok(Math.abs(estimated.infillVolume - inside * 0.15) < 0.01);
  assert.equal(estimated.solid, false);
});

test("more infill means more filament, and the time goes up with it", () => {
  const measured = measure(box(40, 40, 40));
  const light = estimate(measured, { ...printer, infill: 10 });
  const heavy = estimate(measured, { ...printer, infill: 60 });
  assert.ok(heavy.grams > light.grams * 2);
  assert.ok(heavy.seconds > light.seconds);
  // The layers are the same either way: infill doesn't make a part taller.
  assert.equal(light.layers, heavy.layers);
  assert.equal(light.layers, 200);
});

test("a thin part prints solid, and its infill makes no difference", () => {
  // A 0.8 mm plate: the walls and the solid layers meet in the middle.
  const measured = measure(box(40, 40, 0.8));
  const estimated = estimate(measured, printer);
  assert.equal(estimated.solid, true);
  assert.equal(estimated.infillVolume, 0);
  assert.equal(Math.round(estimated.skinVolume), Math.round(measured.volume));
  assert.equal(estimate(measured, { ...printer, infill: 90 }).grams, estimated.grams);
});

test("supports are counted only when they're asked for", () => {
  const table = measure(withBoth(box(20, 20, 2), box(20, 20, 2, [0, 0, 10])));
  const without = estimate(table, { ...printer, supports: false });
  const with_ = estimate(table, { ...printer, supports: true, supportDensity: 20 });
  assert.equal(without.supportGrams, 0);
  // 400 mm² lifted 10 mm, a fifth of it filled: 800 mm³, and PLA at 1.24 g/cm³.
  assert.ok(Math.abs(with_.supportVolume - 400 * 10 * 0.2) < 1);
  assert.ok(Math.abs(with_.supportGrams - (400 * 10 * 0.2 * 1.24) / 1000) < 0.02);
  assert.ok(with_.seconds > without.seconds);
});

test("the weight follows the filament's density", () => {
  const measured = measure(box(30, 30, 30));
  const pla = estimate(measured, { ...printer, density: DENSITIES.PLA });
  const abs = estimate(measured, { ...printer, density: DENSITIES.ABS });
  assert.ok(pla.grams > abs.grams); // PLA is the heavier of the two
  assert.ok(Math.abs(pla.grams / abs.grams - DENSITIES.PLA / DENSITIES.ABS) < 0.001);
  // The same volume, whatever it weighs.
  assert.equal(pla.partVolume, abs.partVolume);
});

test("a 20 mm cube lands where a slicer puts it", () => {
  // Not an exact figure to hit — the point is that it stays in the range a real slice gives, so a change to the
  // arithmetic that throws it out by a factor is caught here.
  const estimated = estimate(measure(box(20, 20, 20)), printer);
  assert.ok(estimated.grams > 2.5 && estimated.grams < 5.5, `${estimated.grams} g is not what a 20 mm cube weighs`);
  const minutes = estimated.seconds / 60;
  assert.ok(minutes > 8 && minutes < 30, `${minutes} minutes is not how long a 20 mm cube takes`);
});

/* ------------------------------------------------------------- the money */

const inputs = { ...PRINTER, ...MATERIAL, ...BUSINESS };

test("every layer of the cost is in the breakdown, and they add up to it", () => {
  const result = price({ grams: 50, purgeGrams: 5, hours: 4, quantity: 1, ...inputs });
  assert.deepEqual(
    Object.keys(result.parts),
    LAYERS.map((layer) => layer.key),
  );
  const added = Object.values(result.parts).reduce((total, part) => total + part, 0);
  assert.ok(Math.abs(added - result.cost) < 1e-9);
  // 55 g of a €20 kilo.
  assert.ok(Math.abs(result.parts.material - 55 * 0.02) < 1e-9);
  // 110 W for four hours at €0.15.
  assert.ok(Math.abs(result.parts.power - 0.11 * 4 * 0.15) < 1e-9);
  // €700 over 3000 hours, for four of them.
  assert.ok(Math.abs(result.parts.depreciation - (4 * 700) / 3000) < 1e-9);
});

test("the failure rate is charged on the filament and the hours, not on the packaging", () => {
  const none = price({ grams: 50, hours: 4, quantity: 1, ...inputs, failRate: 0 });
  const some = price({ grams: 50, hours: 4, quantity: 1, ...inputs, failRate: 10 });
  const risked = none.parts.material + none.parts.power + none.parts.depreciation;
  assert.ok(Math.abs(some.parts.failures - risked * 0.1) < 1e-9);
  assert.equal(some.parts.labour, none.parts.labour);
  assert.equal(some.parts.packaging, none.parts.packaging);
});

test("the platform's cut comes off the price, so the margin survives it", () => {
  const free = price({ grams: 50, hours: 4, quantity: 1, ...inputs, fee: 0, margin: 50 });
  // No fee: half again on top of the cost.
  assert.ok(Math.abs(free.recommended - free.cost * 1.5) < 1e-9);
  assert.ok(Math.abs(free.kept - free.cost * 0.5) < 1e-9);

  const taxed = price({ grams: 50, hours: 4, quantity: 1, ...inputs, fee: 20, margin: 50 });
  // With a fifth taken off the sale, the price has to be higher — and what's kept is the same margin as before.
  assert.ok(taxed.recommended > free.recommended);
  assert.ok(Math.abs(taxed.kept - taxed.cost * 0.5) < 1e-9);
  assert.ok(Math.abs(taxed.recommended * 0.8 - taxed.cost * 1.5) < 1e-9);
});

test("what's made at the price charged today, and what an order of them comes to", () => {
  const result = price({ grams: 50, hours: 4, quantity: 10, currentPrice: 20, ...inputs, fee: 10 });
  assert.ok(Math.abs(result.profit - (20 * 0.9 - result.cost)) < 1e-9);
  assert.ok(Math.abs(result.perHour - result.profit / 4) < 1e-9);
  assert.equal(result.quantity, 10);
  assert.ok(Math.abs(result.orderCost - result.cost * 10) < 1e-9);
  assert.ok(Math.abs(result.orderPrice - result.recommended * 10) < 1e-9);

  // Selling under cost shows as a loss, not as a small profit.
  const losing = price({ grams: 50, hours: 4, quantity: 1, currentPrice: 1, ...inputs });
  assert.ok(losing.profit < 0);
});

test("a figure left empty or absurd doesn't make the price NaN", () => {
  for (const broken of [
    { spoolWeight: 0 },
    { lifespan: 0 },
    { fee: 150 },
    { margin: -200 },
    { failRate: 900 },
    { quantity: 0 },
    { grams: NaN },
  ]) {
    const result = price({ grams: 50, hours: 4, quantity: 1, ...inputs, ...broken });
    assert.ok(Number.isFinite(result.cost), `cost went wrong with ${JSON.stringify(broken)}`);
    assert.ok(Number.isFinite(result.recommended), `the price went wrong with ${JSON.stringify(broken)}`);
  }
});

/* ------------------------------------------------------- the sliced files */

test("a duration is read in every wording a slicer writes", () => {
  assert.equal(parseDuration("1h 56m 9s"), 6969);
  assert.equal(parseDuration("13m 53s"), 833);
  assert.equal(parseDuration("1d 2h 3m 4s"), 93784);
  assert.equal(parseDuration("nothing here"), null);
});

test("PrusaSlicer's G-code gives its time, its grams and its purge", () => {
  const parsed = parseGcode(
    [
      "; generated by PrusaSlicer 2.8.1 on 2026-10-01 at 10:00:00",
      "; estimated printing time (normal mode) = 1h 14m 3s",
      "; filament used [g] = 9.36, 9.63",
      "; total filament used [g] = 18.99",
      "; total filament used for wipe tower [g] = 1.20",
      "; filament_type = PLA;PETG",
    ].join("\n"),
  );
  assert.equal(parsed.seconds, 4443);
  assert.equal(parsed.totalGrams, 18.99);
  assert.equal(parsed.purgeGrams, 1.2);
  assert.equal(parsed.filaments.length, 2);
  assert.equal(parsed.filaments[1].type, "PETG");
  assert.equal(parsed.estimated, false);
});

test("Bambu Studio's and Orca's headers are read", () => {
  const parsed = parseGcode(
    "; BambuStudio 01.09.05.51\n; total estimated time: 1h 56m 9s\n; total filament weight [g] : 32.60\n",
  );
  assert.equal(parsed.seconds, 6969);
  assert.equal(parsed.totalGrams, 32.6);
});

test("Cura's seconds and metres are read, and the weight is marked as worked out", () => {
  const parsed = parseGcode(";Generated with Cura_SteamEngine 5.7.0\n;TIME:5025\n;Filament used: 1.49416m\n");
  assert.equal(parsed.seconds, 5025);
  // 1.49 m of 1.75 mm filament, as PLA.
  assert.ok(Math.abs(parsed.totalGrams - 4.46) < 0.05);
  assert.equal(parsed.estimated, true);
});

test("a file with neither a time nor a weight in it is no sliced file", () => {
  assert.equal(parseGcode("G1 X10 Y10 E2\nG1 X20 Y20 E4\n"), null);
});

test("a sliced 3MF's plates are read, and one part's share worked out", () => {
  const plates = parseSliceInfo(
    [
      '<plate><metadata key="index" value="1"/><metadata key="prediction" value="4200"/><metadata key="weight" value="25.4"/>',
      '<filament id="1" type="PLA" color="#FF0000" used_g="25.4"/></plate>',
      '<plate><metadata key="index" value="2"/><metadata key="prediction" value="1800"/><metadata key="weight" value="10"/></plate>',
    ].join(""),
  );
  assert.equal(plates.length, 2);
  assert.equal(plates[0].seconds, 4200);
  assert.equal(plates[0].filaments[0].type, "PLA");

  // One plate, four copies on it.
  const one = platesToValues(plates, 1, 4);
  assert.equal(one.hours, 4200 / 3600 / 4);
  assert.equal(one.grams, 25.4 / 4);

  // Both plates together, one part.
  const all = platesToValues(plates, "all", 1);
  assert.equal(all.hours, 6000 / 3600);
  assert.equal(all.grams, 35.4);
});

test("a plain 3MF project isn't mistaken for a sliced one", async () => {
  // readSliced says null for a 3MF with no sliced plate in it, which is what sends it to be measured instead.
  assert.equal(await readSliced(threeMf(), "part.3mf"), null);
});

test("a sliced 3MF is read from the plate's own G-code when the slice info is thin", async () => {
  const archive = zip({
    "Metadata/slice_info.config": '<config><plate><metadata key="index" value="1"/></plate></config>',
    "Metadata/plate_1.gcode":
      "; BambuStudio 01.09\n; total estimated time: 2h 0m 0s\n; total filament weight [g] : 40.00\n",
  });
  const sliced = await readSliced(archive, "plate.gcode.3mf");
  assert.equal(sliced.plates.length, 1);
  assert.equal(sliced.plates[0].seconds, 7200);
  assert.equal(sliced.plates[0].totalGrams, 40);
});

/* ------------------------------------------------------------ the bundle */

test("the built tool.js is there, matches the source and mounts", async () => {
  const built = fs.readFileSync(path.join(here, "..", "tool.js"), "utf8");
  assert.match(built, /^\/\/ GENERATED by source\/build\.mjs/, "tool.js wasn't built by the build script");
  assert.match(built, /export default async function mount/, "tool.js has no mount to call");
  // Nothing may be fetched at run time: a tool is reviewed as the code that was read.
  assert.doesNotMatch(built, /\bimport\s*\(/, "tool.js loads something at run time");
  assert.doesNotMatch(built, /^import\s/m, "tool.js still has an import in it");
  for (const file of [
    "zip.js",
    "mesh.js",
    "geometry.js",
    "slicer.js",
    "estimate.js",
    "cost.js",
    "viewer.js",
    "ui.js",
  ]) {
    assert.ok(built.includes(`// ---- ${file} ----`), `${file} isn't in the bundle`);
  }
});
