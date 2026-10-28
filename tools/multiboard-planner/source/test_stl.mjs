// The binary STL reader, against files it should read and files it should refuse.
//   node source/test_stl.mjs            reads the joints in models/
//   node source/test_stl.mjs DIR        reads an installed copy instead, the folder named by its models sha
import fs from "node:fs";
import path from "node:path";
import { isBinaryStl, readBinaryStl } from "./stl.js";

const failures = [];
const check = (ok, what) => void (ok || failures.push(what));

/** A binary STL of the triangles given, to read back. */
function makeStl(triangles) {
  const bytes = new Uint8Array(84 + triangles.length * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((corners, t) => {
    const base = 84 + t * 50 + 12;
    corners.flat().forEach((v, i) => view.setFloat32(base + i * 4, v, true));
  });
  return bytes;
}

// One triangle, read back as it went in.
const one = readBinaryStl(
  makeStl([
    [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
  ]),
);
check(one.triangles.length === 3, `one triangle should give three indices, got ${one.triangles.length}`);
check(one.vertices.length === 9, `one triangle should give three corners, got ${one.vertices.length / 3}`);
check([...one.triangles].join(",") === "0,1,2", "its corners should be in the order they were written");

// Two triangles sharing an edge: four corners, not six.
const shared = readBinaryStl(
  makeStl([
    [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    [
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
  ]),
);
check(shared.vertices.length / 3 === 4, `a shared edge should give four corners, got ${shared.vertices.length / 3}`);
check(shared.triangles.length === 6, "two triangles should still have six indices");

// Corners a printer could never tell apart are one corner.
const nearly = readBinaryStl(
  makeStl([
    [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    [
      [0.0000001, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
  ]),
);
check(nearly.vertices.length / 3 === 4, `corners a micron apart should be one, got ${nearly.vertices.length / 3}`);

// What it should refuse.
check(!isBinaryStl(new Uint8Array(10)), "ten bytes is not an STL");
check(!isBinaryStl(new TextEncoder().encode("solid cube\nfacet normal 0 0 1\n")), "text is not a binary STL");
// A text STL long enough to get past the length check, which is where the two can be told apart.
const asciiStl = new TextEncoder().encode(
  `solid cube\n${"  facet normal 0 0 1\n    outer loop\n      vertex 0 0 0\n      vertex 1 0 0\n      vertex 0 1 0\n    endloop\n  endfacet\n".repeat(4)}endsolid cube\n`,
);
check(asciiStl.byteLength > 84, "the text sample should be past the length check to be a fair test");
let refused = "";
try {
  readBinaryStl(asciiStl);
} catch (err) {
  refused = err.message;
}
check(/not a binary STL/.test(refused), `text should be refused by name, got "${refused}"`);

// And something genuinely too short says that instead.
let short = "";
try {
  readBinaryStl(new Uint8Array(10));
} catch (err) {
  short = err.message;
}
check(/too short/.test(short), `ten bytes should be refused as short, got "${short}"`);
check(
  isBinaryStl(
    makeStl([
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
    ]),
  ),
  "a real one should be recognised",
);

// The joints the tool carries. Its own models/ folder by default, so the check holds whether or not the tool
// happens to be installed; a storage path may be given to read an installed copy instead, where the two layouts
// differ only by the files/ folder an install adds.
const installed = process.argv[2] ?? path.join(import.meta.dirname, "..", "models");
let real = 0;
if (fs.existsSync(installed)) {
  for (const key of fs.readdirSync(installed)) {
    const dir = [path.join(installed, key, "files"), path.join(installed, key)].find((d) => fs.existsSync(d));
    if (!dir || !fs.statSync(dir).isDirectory()) continue;
    const file = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith(".stl"));
    if (!file || /Octagon Plate/i.test(file)) continue;
    const bytes = fs.readFileSync(path.join(dir, file));
    const mesh = readBinaryStl(bytes);
    const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
    check(mesh.triangles.length === count * 3, `${file}: ${count} triangles, ${mesh.triangles.length / 3} read`);
    check(mesh.vertices.length / 3 < count * 3, `${file}: corners should be shared, not repeated`);
    check(Math.max(...mesh.triangles) < mesh.vertices.length / 3, `${file}: every index should name a corner`);
    real++;
    if (real >= 3) break;
  }
}

console.log(`made-up files: read, shared and refused as they should be`);
console.log(`joints read whole: ${real}${real ? "" : " (none found -- is models/ there?)"}`);
failures.forEach((f) => console.log("  FAIL " + f));
console.log(failures.length ? `${failures.length} failed` : "all passed");
process.exitCode = failures.length ? 1 : 0;
