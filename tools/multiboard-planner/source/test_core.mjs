// Runs the original planner's calculator tests (converted from GDScript) against the core as tool.js has it.
// Build first: node source/build.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { PlannerCore: C } = await import(pathToFileURL(path.join(here, "..", "tool.js")).href);
const tests = JSON.parse(fs.readFileSync(path.join(here, "original_tests.json"), "utf8"));
let pass = 0,
  fail = 0,
  renamed = 0;
const failures = [];
for (const t of tests) {
  const data = new C.DesignerData(t.args[0], t.args[1], t.args[2], t.units === "MM" ? C.MM : C.INCH, "Wall");
  const res = t.calc.endsWith("Advanced") ? C.placeAdvanced(data) : C.placeSimple(data);
  for (const chk of t.checks) {
    let ok, got;
    if (chk[0] === "size") {
      got = res.tiles.map.size;
      ok = got === chk[1];
    } else if (chk[0] === "remaining") {
      got = data.remaining;
      ok = Math.abs(got[0] - chk[1]) < 1e-9 && Math.abs(got[1] - chk[2]) < 1e-9;
    } else {
      const tile = res.tiles.get(chk[1], chk[2]);
      got = tile && [tile.sizeX, tile.sizeY, tile.type, tile.rotation][chk[3]];
      ok = got === chk[4];
      // The tests predate the strip tiles being split into Horizontal/Vertical names.
      if (!ok && chk[3] === 2 && typeof got === "string" && got.startsWith(chk[4] + " ")) {
        ok = true;
        renamed++;
      }
    }
    if (ok) pass++;
    else {
      fail++;
      failures.push(`${t.name}: ${JSON.stringify(chk)} got ${JSON.stringify(got)}`);
    }
  }
}
const sanitize = [
  ["", ""],
  ["a", ""],
  ["1a", "1"],
  ["0.2", "0.2"],
  ["0.2a", "0.2"],
  ["a0.2a3", "0.23"],
  ["0,23", "0.23"],
  ["00", "0"],
  ["0..", "0."],
  ["0.0.", "0.0"],
  [",1", "0.1"],
  ["aaaa00.1110asdss0", "0.11100"],
];
let sPass = 0;
for (const [input, want] of sanitize) {
  const got = C.sanitizeNumber(input);
  if (got === want) sPass++;
  else failures.push(`sanitize(${JSON.stringify(input)}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
console.log(`calculator checks: ${pass} passed, ${fail} failed (${renamed} matched after the strip rename)`);
console.log(`input sanitiser: ${sPass}/${sanitize.length}`);
failures.slice(0, 40).forEach((f) => console.log("  FAIL " + f));
process.exitCode = fail || sPass !== sanitize.length ? 1 : 0;
