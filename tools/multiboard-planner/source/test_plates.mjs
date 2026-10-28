// Checks the translation from the planner's tile types to plate.scad's parameters, against the plates the
// types used to link to: for each one, the model it names on Thangs is fetched from an installed copy of the
// tool and its title read, so the table is checked against what the plate is actually called rather than
// against the name beside it in the table.
//
//   node source/test_plates.mjs [<storage>/tools/multiboard-planner/<sha>]
//
// Without that folder the link check is skipped and the rest still runs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLATE_SIDES, cellsOf, plateLabel, plateParameters } from "./plates.js";

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

console.log(`tile types: ${types.length}, all mapped and sized`);
console.log(`tiles: ${data.tiles.length}, every one draws`);
console.log(`types checked against the plate they link to: ${checked}${checked ? "" : " (no installed copy given)"}`);
failures.forEach((f) => console.log("  FAIL " + f));
console.log(failures.length ? `${failures.length} failed` : "all passed");
process.exitCode = failures.length ? 1 : 0;
