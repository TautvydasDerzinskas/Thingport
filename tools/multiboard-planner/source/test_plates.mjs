// Checks the translation from the planner's tile types to plate.scad's parameters, against the plates the
// types used to link to: for each one, the model it names on Thangs is fetched from an installed copy of the
// tool and its title read, so the table is checked against what the plate is actually called rather than
// against the name beside it in the table.
//
//   node source/test_plates.mjs [<storage>/tools/multiboard-planner/<sha>]
//
// Without that folder the link check is skipped and the rest still runs.
//
// Read from the built tool.js rather than from plates.js: source/ is concatenated into one module, so
// plates.js takes the STL writer from that shared scope and on its own has no such name.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLATE_SIDES, buildWall, cellsOf, partName, plateIndex, plateLabel, plateParameters } from "../tool.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(here, "data", "parts.json"), "utf8"));
const failures = [];
const check = (ok, what) => void (ok || failures.push(what));

// Every type the planner uses can be drawn, at every size it offers.
const types = [...new Set(data.tiles.map((tile) => tile.type))];
for (const type of types) check(PLATE_SIDES[type], `no sides known for ${type}`);
for (const tile of data.tiles) check(plateParameters(tile.type, tile.size), `no plate for a ${tile.size} ${tile.type}`);

// Sizes it should refuse rather than guess at.
for (const bad of ["4x6", "", "x", "1x1", "17x17", null, undefined])
  check(cellsOf(bad) === null, `cellsOf(${JSON.stringify(bad)}) should be null`);
check(cellsOf("16x16") === 16, "cellsOf('16x16') should be 16");

// The table against the plates themselves: the type links to a model, that model has a title, and the title
// says which plate it is. Only where an installed copy is at hand.
const installed = process.argv[2];
let checked = 0;
if (installed && fs.existsSync(installed)) {
  const seen = new Set();
  for (const tile of data.tiles) {
    if (seen.has(tile.type) || !tile.link) continue;
    const id = /\/m\/(\d+)/.exec(tile.link)?.[1];
    if (!id) continue;
    const file = path.join(installed, `thangs-${id}`, "model.json");
    if (!fs.existsSync(file)) continue;
    seen.add(tile.type);
    const title = JSON.parse(fs.readFileSync(file, "utf8")).title ?? "";
    const named = /MU\s*-\s*(.+?)\s*-\s*MultiBoard/i.exec(title)?.[1] ?? "plain";
    const want = PLATE_SIDES[tile.type]?.plate ?? "?";
    // The titles say "Interfitted" where the table doesn't; otherwise they are the same words.
    check(named.replace(/\s*Interfitted$/, "") === want, `${tile.type} links to "${named}", table says "${want}"`);
    checked++;
  }
}

// The name is where a count is read, since a 3MF holds one copy of a shape however many are wanted.
const four = plateLabel("C1", "8x8", 4, data.tileNames);
check(four.name === "8x8 Core Multiboard x4", `label for four reads "${four.name}"`);
check(four.file.endsWith(".3mf"), `file name should be a .3mf, got "${four.file}"`);
check(!/[^\w.-]/.test(four.file), `file name should be safe, got "${four.file}"`);
const one = plateLabel("C1", "8x8", 1, data.tileNames);
check(one.name === "8x8 Core Multiboard", `label for one reads "${one.name}"`);

// --- what a wall asks for, and the drawing of it ------------------------------------------------------
const index = plateIndex(data.tiles);
check(index.size === data.tiles.filter((t) => t.link).length, "every linked tile should be in the index");
const first = data.tiles.find((t) => t.link);
check(index.get(first.link)?.type === first.type, "a link should give back its own type");
check(index.get("https://than.gs/m/nope") === undefined, "an unknown link should give back nothing");

// A stand-in engine: it records what it was asked for and hands back a mesh of the right shape.
const fakeMesh = { vertices: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), triangles: new Uint32Array([0, 1, 2]) };
const asked = [];
const fakeScad = {
  render: async (script_, options) => {
    asked.push(options.parameters);
    return { bytes: new Uint8Array(), mesh: fakeMesh, log: [], seconds: 0 };
  },
};

const wanted = [
  { type: "C1", size: "8x8", name: "8x8 Core Multiboard x4" },
  { type: "CR2", size: "4x4", name: "4x4 Top Right Corner" },
];
const seen = [];
const plan = { plates: wanted, joints: [] };
const built = await buildWall(fakeScad, "// script", plan, { onProgress: (p) => seen.push(p) });
check(built.length === 2, `two plates wanted, ${built.length} drawn`);
// Numbered in plan order and written as STL, with the name it was given, count and all, in between.
check(built[0].name === `01 - ${wanted[0].name}.stl`, `the first plate's file reads "${built[0].name}"`);
check(built[1].name === `02 - ${wanted[1].name}.stl`, `the second plate's file reads "${built[1].name}"`);
// One triangle makes an 84-byte header and one 50-byte facet, so the bytes are the mesh rather than a stub.
check(built[0].data?.length === 134, `a plate should come back as STL bytes, got ${built[0].data?.length}`);

// Joints come through whatever reads them, counted in the same progress and kept byte for byte.
const jointPlan = { plates: [wanted[0]], joints: [{ name: "Dual Clip", quantity: 2 }] };
const jointSeen = [];
const packed = new Uint8Array([1, 2, 3]);
const withJoints = await buildWall(fakeScad, "// script", jointPlan, {
  readJoint: async (joint) => [{ name: partName(joint), data: packed, extension: ".3mf" }],
  onProgress: (p) => jointSeen.push(p),
});
check(withJoints.length === 2, `a plate and a joint should give two pieces, got ${withJoints.length}`);
// A joint keeps its count and its own extension: it is handed over as it was packed, not re-written.
check(withJoints[1].name === "02 - Dual Clip x2.3mf", `a joint's file reads "${withJoints[1].name}"`);
check(withJoints[1].data === packed, "a joint's bytes should be the ones it was read as");
check(jointSeen.at(-1).done === 2 && jointSeen.at(-1).total === 2, "progress should count the joint too");

// A joint with nothing to read it is said so rather than quietly dropped.
let unread = "";
await buildWall(fakeScad, "// script", { plates: [], joints: [{ name: "Snap", quantity: 1 }] }).catch(
  (e) => (unread = e.message),
);
check(/Snap/.test(unread), `a joint with no reader should say which, got "${unread}"`);

check(partName({ name: "Tile", quantity: 1 }) === "Tile", "one of a thing carries no count");
check(asked[0].cells === 8 && asked[0].neighbour_px === true, "a core tile should be drawn surrounded");
check(asked[1].cells === 4 && asked[1].neighbour_py === false, "a top-right corner should have nothing above it");
// Said once per piece: the report at the end repeats the last one's count, and a repeat is dropped.
check(seen.length === 2, `progress should be told once per piece, got ${seen.length}`);
check(seen[0].total === 2 && seen.at(-1).done === 2, "progress should count towards the total and reach it");

// Stopping between plates.
const stop = { aborted: true };
let stopped = false;
await buildWall(fakeScad, "// script", plan, { signal: stop }).catch(() => (stopped = true));
check(stopped, "an aborted signal should stop it");

// A tile it cannot draw is said so by name rather than drawn wrong.
let refused = "";
await buildWall(fakeScad, "// script", { plates: [{ type: "C1", size: "4x6", name: "odd" }], joints: [] }).catch(
  (e) => (refused = e.message),
);
check(/4x6/.test(refused), `a size it cannot draw should say which, got "${refused}"`);

// --- the preview draws the plate the generator draws ---------------------------------------------------
// The preview's lattice is the plate seen from above, so its numbers have to be plate.scad's. Drawn from
// memory they would drift, and a picture that quietly stops matching the thing it shows is worse than none.
const scad = fs.readFileSync(path.join(here, "plate.scad"), "utf8");
const ui = fs.readFileSync(path.join(here, "ui.js"), "utf8");
const scadValue = (name) => Number(new RegExp(`^${name}\\s*=\\s*([\\d.]+)`, "m").exec(scad)?.[1]);
const uiValue = (name) => Number(new RegExp(`${name}\\s*=\\s*([\\d.]+)`).exec(ui)?.[1]);

const thin = scadValue("MULTI_THIN");
const drawnFlats = uiValue("const flats");
check(thin === 23.4, `plate.scad's face octagon should be 23.4 across, reads ${thin}`);
check(drawnFlats === thin, `the preview draws ${drawnFlats} across where the plate is ${thin}`);

const pegThin = scadValue("PEG_THIN");
const drawnHole = Number(/el\("circle", \{ cx, cy, r: ([\d.]+)/.exec(ui)?.[1]);
check(pegThin === 7.9, `plate.scad's face hole should be 7.9 across, reads ${pegThin}`);
check(drawnHole === pegThin / 2, `the preview draws a hole of ${drawnHole} where the plate's is ${pegThin / 2}`);

// And the cell the pattern repeats on is the lattice the plates sit on.
check(/width: PlannerCore\.TILE_CELL_OFFSET/.test(ui), "the lattice should repeat on the planner's own cell pitch");

console.log(`tile types: ${types.length}, all mapped and sized`);
console.log(`tiles: ${data.tiles.length}, every one draws`);
console.log(`types checked against the plate they link to: ${checked}${checked ? "" : " (no installed copy given)"}`);
failures.forEach((f) => console.log("  FAIL " + f));
console.log(failures.length ? `${failures.length} failed` : "all passed");
process.exitCode = failures.length ? 1 : 0;
