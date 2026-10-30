// Tests for the keyring generator. Run from the tool's folder:
//   node source/test_keyring.mjs
//
// The parts that are pure arithmetic — flattening a curve, laying letters against each other, the colour rules,
// the magnets, the files that come out — are checked here on their own and always run.
//
// The engine itself needs a real font parser and a real solid modeller, which Thingport carries in the frontend
// rather than the backend, so that part runs when the frontend's packages are installed and says it skipped them
// when they aren't. That keeps the repository's check honest about what it did and didn't prove.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { flattenPath } from "./curves.js";
import { MAX_CHARACTERS, MAX_LINES, limitText, normalizeText, textStats } from "./text.js";
import {
  bounds,
  componentLinks,
  distanceToPolys,
  pointInPolys,
  shiftPolys,
  signedArea,
  touchingShift,
} from "./geometry2d.js";
import { DEFAULT_COLOURS, colourIssues, colourSlot, normalizeColours, palette, targetLetters } from "./colours.js";
import { MAGNET_SIZES, effectiveBase, magnetMinimum, normalizeMagnets } from "./magnets.js";
import { edgeSizes } from "./finishing.js";
import { creasedGeometry } from "./meshNormals.js";
import { obj, stl, threeMf } from "./files.js";
import { DEFAULTS } from "./engine.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../../..");

let passed = 0;
let skipped = 0;
const failures = [];
const test = async (name, body) => {
  try {
    await body();
    passed++;
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
};
const near = (actual, expected, tolerance, what) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: got ${actual}, wanted ${expected} ± ${tolerance}`);

// ---- the curves -------------------------------------------------------------------------------------------------

await test("a straight path comes back as its corners, with y flipped for a model", () => {
  const polys = flattenPath(
    { commands: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }, { type: "L", x: 10, y: 10 }, { type: "Z" }] },
    0.01,
  );
  assert.equal(polys.length, 1);
  assert.equal(polys[0].length, 3);
  // The font's y grows downwards and a model's grows up, so the sign has to turn over.
  assert.deepEqual(polys[0][2], [10, -10]);
});

await test("a tighter tolerance cuts a curve into more pieces", () => {
  const curve = { commands: [{ type: "M", x: 0, y: 0 }, { type: "Q", x1: 50, y1: 100, x: 100, y: 0 }, { type: "Z" }] };
  const coarse = flattenPath(curve, 1)[0].length;
  const fine = flattenPath(curve, 0.01)[0].length;
  assert.ok(fine > coarse * 2, `fine ${fine} should be well past coarse ${coarse}`);
});

await test("a letter with a counter keeps both contours", () => {
  const polys = flattenPath(
    {
      commands: [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 20, y: 0 },
        { type: "L", x: 20, y: 20 },
        { type: "L", x: 0, y: 20 },
        { type: "Z" },
        { type: "M", x: 6, y: 6 },
        { type: "L", x: 6, y: 14 },
        { type: "L", x: 14, y: 14 },
        { type: "L", x: 14, y: 6 },
        { type: "Z" },
      ],
    },
    0.01,
  );
  assert.equal(polys.length, 2, "the outside and the hole are two contours");
  // One winds one way and the other the opposite way, which is what makes the hole a hole.
  assert.ok(signedArea(polys[0]) * signedArea(polys[1]) < 0, "the contours wind opposite ways");
});

// ---- the text ---------------------------------------------------------------------------------------------------

await test("text is tidied without being mangled", () => {
  assert.equal(normalizeText("a\r\nb"), "a\nb", "one kind of line ending");
  assert.equal(normalizeText("a\tb"), "a b", "a tab has no width a font agrees on");
  assert.equal(normalizeText("  hi  "), "  hi  ", "spaces are left alone: they are part of what was typed");
  assert.equal(normalizeText(null), "");
});

await test("counting lines and characters", () => {
  const stats = textStats("Pop\nAgain");
  assert.equal(stats.lines, 2);
  assert.equal(stats.characters, 8, "the newline isn't a character to print");
});

await test("too much text is cut to what will fit", () => {
  const long = limitText("abcdefghijklmnopqrstuvwxyz");
  assert.equal(textStats(long).characters, MAX_CHARACTERS);
  const many = limitText("a\nb\nc\nd\ne\nf\ng\nh");
  assert.equal(textStats(many).lines, MAX_LINES);
});

// ---- the flat geometry ------------------------------------------------------------------------------------------

const square = (x, y, size) => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
];

await test("area and winding", () => {
  near(signedArea(square(0, 0, 10)), 100, 1e-9, "anticlockwise area");
  near(signedArea([...square(0, 0, 10)].reverse()), -100, 1e-9, "clockwise area");
});

await test("bounds of a set of contours", () => {
  const box = bounds([square(0, 0, 10), square(20, -5, 5)]);
  assert.deepEqual(box.min, [0, -5]);
  assert.deepEqual(box.max, [25, 10]);
});

await test("letters slide together until their outlines touch", () => {
  // Two squares 6 mm apart: the shift should close exactly that gap.
  const left = [square(0, 0, 10)];
  const right = [square(16, 0, 10)];
  near(touchingShift(left, right, 0), -6, 1e-6, "the gap closed");
});

await test("letters whose outlines never meet fall back to their boxes", () => {
  // One high, one low: no height where both have an edge, so there is nothing to slide against.
  const high = [square(0, 40, 10)];
  const low = [square(16, 0, 10)];
  near(touchingShift(high, low, true), -6, 1e-6, "the boxes are used instead");
  assert.equal(touchingShift(high, low, false), -Infinity, "or it says there was nothing to go on");
});

await test("separate pieces are linked by the shortest bridges", () => {
  const links = componentLinks([square(0, 0, 10), square(20, 0, 10), square(40, 0, 10)]);
  assert.equal(links.length, 2, "three pieces need two bridges to join them");
  // A spanning set never links the far ends directly when a middle piece is nearer both: each bar is the 10 mm
  // gap between neighbours, never the 30 mm across the middle one. `d` is the squared distance.
  assert.ok(
    links.every((link) => Math.sqrt(link.d) < 15),
    `bars of ${links.map((link) => Math.sqrt(link.d).toFixed(1)).join(", ")} mm`,
  );
  for (const link of links) assert.ok(Array.isArray(link.p) && Array.isArray(link.q), "each bar has both ends");
});

await test("inside and outside, and how far out", () => {
  const shape = [square(0, 0, 10)];
  assert.equal(pointInPolys(shape, 5, 5), true);
  assert.equal(pointInPolys(shape, 15, 5), false);
  near(distanceToPolys(shape, 15, 5), 5, 1e-6, "5 mm past the edge");
});

await test("a hole in a letter counts as outside the material", () => {
  const ring = [square(0, 0, 20), [...square(6, 6, 8)].reverse()];
  assert.equal(pointInPolys(ring, 10, 10), false, "the middle of the counter is not material");
  assert.equal(pointInPolys(ring, 3, 10), true, "the wall is");
});

// ---- the colours ------------------------------------------------------------------------------------------------

await test("colours are brought back to something usable", () => {
  const settled = normalizeColours({ border: "nonsense", letter: "#ABCDEF", extras: [{ enabled: 1, targets: "7" }] });
  assert.equal(settled.border, DEFAULT_COLOURS.border, "a colour that isn't one falls back");
  assert.equal(settled.letter, "#abcdef");
  assert.equal(settled.extras[0].enabled, true);
  assert.equal(settled.extras.length, 2, "always both extras, on or not");
});

await test("the characters an extra colour names, however they were typed", () => {
  assert.deepEqual(targetLetters("a,b"), ["a", "b"]);
  assert.deepEqual(targetLetters("ab"), ["a", "b"]);
  assert.deepEqual(targetLetters("7"), ["7"]);
  assert.deepEqual(targetLetters(" a , a "), ["a"], "named twice is still once");
});

await test("each part gets the right filament", () => {
  const colours = normalizeColours({ extras: [{ enabled: true, targets: "7", mode: "text" }, { enabled: false }] });
  assert.equal(colourSlot({ kind: "border" }, colours), 0);
  assert.equal(colourSlot({ kind: "letter", char: "A", index: 0 }, colours), 1);
  assert.equal(colourSlot({ kind: "letter", char: "7", index: 1 }, colours), 2);
});

await test("a colour can be sent by position instead of by character", () => {
  const colours = normalizeColours({
    extras: [{ enabled: true, mode: "positions", indices: [2] }, { enabled: false }],
  });
  assert.equal(colourSlot({ kind: "letter", char: "o", index: 2 }, colours), 2);
  assert.equal(
    colourSlot({ kind: "letter", char: "o", index: 1 }, colours),
    1,
    "the same letter elsewhere stays plain",
  );
});

await test("the palette lists the border, the letters, then the extras", () => {
  const list = palette({ border: "#111111", letter: "#222222" });
  assert.equal(list.length, 4);
  assert.deepEqual(list.slice(0, 2), ["#111111", "#222222"]);
});

await test("a letter named by both extras, and a colour aimed at nothing, are reported", () => {
  const both = {
    extras: [
      { enabled: true, targets: "a" },
      { enabled: true, targets: "a" },
    ],
  };
  assert.deepEqual(colourIssues("cat", both).duplicates, ["a"]);
  const absent = { extras: [{ enabled: true, targets: "z" }, { enabled: false }] };
  assert.deepEqual(colourIssues("cat", absent).missing, ["z"]);
});

// ---- the magnets ------------------------------------------------------------------------------------------------

await test("magnets are brought inside what can be made", () => {
  const list = normalizeMagnets({
    magnets: [{ diameter: 30, depth: 99, x: 5, y: -5 }, ...Array(9).fill({ diameter: 6 })],
  });
  assert.equal(list.length, 6, "six at most");
  assert.equal(list[0].diameter, 8, "8 mm across at most");
  assert.equal(list[0].depth, 5);
  assert.deepEqual([list[0].x, list[0].y], [1, -1], "a position outside the piece is pulled to its edge");
});

await test("the base is thickened to hold the deepest magnet", () => {
  const settings = {
    base: 1,
    magnetEnabled: true,
    magnetAutoHeight: true,
    magnetDepthGap: 0.1,
    magnetMode: "open",
    magnets: [{ diameter: 6, depth: 2 }],
  };
  const least = magnetMinimum(settings);
  near(least, 2.7, 1e-9, "2 deep + 0.1 gap + 0.6 left over");
  near(effectiveBase(settings), least, 1e-9, "and that is what gets used");
  near(effectiveBase({ ...settings, magnetEnabled: false }), 1, 1e-9, "without magnets the base is the one asked for");
});

await test("a magnet dropped in mid-print needs a little more under the lid", () => {
  const open = magnetMinimum({ magnetEnabled: true, magnetMode: "open", magnets: [{ diameter: 6, depth: 2 }] });
  const closed = magnetMinimum({ magnetEnabled: true, magnetMode: "embedded", magnets: [{ diameter: 6, depth: 2 }] });
  assert.ok(closed > open, `${closed} should be more than ${open}`);
});

await test("a base set by hand is never thinner than the magnets allow", () => {
  const settings = {
    base: 1,
    magnetEnabled: true,
    magnetAutoHeight: false,
    magnetBase: 0.8,
    magnetMode: "open",
    magnets: [{ diameter: 8, depth: 3 }],
  };
  near(effectiveBase(settings), magnetMinimum(settings), 1e-9, "the thinner figure is refused");
});

await test("the sizes offered are real ones, smallest first", () => {
  assert.ok(MAGNET_SIZES.length >= 8);
  assert.ok(MAGNET_SIZES.every(([diameter, depth]) => diameter >= 2 && diameter <= 8 && depth > 0));
});

// ---- the edges --------------------------------------------------------------------------------------------------

await test("an edge size given outright wins over the tick box", () => {
  assert.equal(edgeSizes({ letterTopSize: 0.8, letterRound: false }).letter, 0.8);
  assert.equal(edgeSizes({ letterRound: true, roundRadius: 0.5 }).letter, 0.5, "ticked with no size uses the radius");
  assert.equal(edgeSizes({}).letter, 0, "neither leaves the edge square");
  assert.equal(edgeSizes({ letterTopSize: 99 }).letter, 3, "and it can't run away");
});

// ---- the preview normals ----------------------------------------------------------------------------------------

await test("a flat face gets one normal, and a sharp edge is kept sharp", () => {
  // Two triangles making a flat square in z = 0, and one wall standing up from its edge.
  const vertices = new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 10, 10, 0, 10]);
  const triangles = new Uint32Array([0, 1, 2, 0, 2, 3, 0, 4, 5, 0, 5, 1]);
  const { positions, normals } = creasedGeometry(vertices, triangles);
  assert.equal(positions.length, triangles.length * 3);
  // The corner of the flat face away from the wall points straight up.
  const faceCorner = [normals[6], normals[7], normals[8]];
  near(faceCorner[2], 1, 1e-5, "the flat face points up");
  near(Math.hypot(...faceCorner), 1, 1e-5, "and the normal is a unit length");
});

// ---- the files --------------------------------------------------------------------------------------------------

const sample = [
  {
    name: "border_and_base",
    kind: "border",
    vertices: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 0, 2, 10, 0, 2, 10, 10, 2]),
    triangles: new Uint32Array([0, 1, 2, 3, 5, 4, 0, 3, 4, 0, 4, 1]),
  },
  {
    name: "letter_1",
    kind: "letter",
    char: "A",
    index: 0,
    vertices: new Float32Array([2, 2, 2, 4, 2, 2, 4, 4, 2]),
    triangles: new Uint32Array([0, 1, 2]),
  },
];

await test("the 3MF is a real zip, with the parts, the colours and the filament for each", async () => {
  const bytes = await threeMf(sample, { border: "#112233", letter: "#445566" }, { title: "Test ring" });
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], "starts with a zip local header");
  const text = Buffer.from(bytes).toString("latin1");
  assert.ok(text.includes("[Content_Types].xml"), "the content types are in there");
  assert.ok(text.includes("3D/3dmodel.model"));
  assert.ok(text.includes("Metadata/model_settings.config"), "and the per-part filament assignment");
  // The end-of-central-directory record says how many files went in.
  const end = bytes.length - 22;
  const count = bytes[end + 8] | (bytes[end + 9] << 8);
  assert.equal(count, 5, "five files in the package");
});

await test("the 3MF lists only the filaments actually used", async () => {
  const letters = [
    sample[0],
    sample[1],
    {
      name: "letter_2",
      kind: "letter",
      char: "7",
      index: 1,
      vertices: sample[1].vertices,
      triangles: sample[1].triangles,
    },
  ];
  const filaments = async (colours) => {
    const bytes = await threeMf(letters, colours);
    // The material list is deflated inside the package, so count what the settings part assigns instead.
    const text = Buffer.from(bytes).toString("latin1");
    assert.ok(text.includes("Metadata/model_settings.config"));
    return bytes;
  };
  const one = await filaments({ single: true, border: "#112233" });
  const two = await filaments({ border: "#112233", letter: "#445566" });
  const three = await filaments({
    border: "#112233",
    letter: "#445566",
    extras: [{ enabled: true, targets: "7", colour: "#ff0000" }, { enabled: false }],
  });
  // An unused extra colour shouldn't make the package bigger: one filament < two < three.
  assert.ok(one.length < two.length, "one colour writes less than two");
  assert.ok(two.length < three.length, "and a third colour writes more again");
});

await test("the OBJ names every piece and counts its corners from one", () => {
  const text = obj(sample, { title: "Test ring" });
  assert.ok(text.includes("o border_and_base"));
  assert.ok(text.includes("o letter_1"));
  // The letter's triangle refers to the vertices after the border's six, 1-based: 7 8 9.
  assert.ok(text.includes("f 7 8 9"), "the second piece's faces carry on from the first");
  assert.equal(text.match(/^v /gm).length, 9);
});

await test("the STL is the right length and has a normal per triangle", () => {
  const bytes = stl(sample, { title: "Test ring" });
  const count = new DataView(bytes.buffer).getUint32(80, true);
  assert.equal(count, 5, "four triangles in the border, one in the letter");
  assert.equal(bytes.length, 84 + count * 50);
  const first = new DataView(bytes.buffer).getFloat32(84 + 8, true); // the z of the first normal
  near(Math.abs(first), 1, 1e-5, "the base triangle's normal points along z");
});

await test("printing the pieces apart moves them so they don't overlap", () => {
  const together = obj(sample, { separate: false });
  const apart = obj(sample, { separate: true });
  assert.notEqual(together, apart);
  const xs = [...apart.matchAll(/^v (\S+)/gm)].map((match) => Number(match[1]));
  assert.ok(Math.max(...xs) > 10, "the second piece has been slid along");
});

await test("a letter sent to both extra colours is refused rather than quietly mis-assigned", async () => {
  const both = {
    extras: [
      { enabled: true, targets: "A" },
      { enabled: true, targets: "A" },
    ],
  };
  await assert.rejects(() => threeMf(sample, both), /two colours at once/);
});

// ---- the words ---------------------------------------------------------------------------------------------------

// The labels aren't in the script: Thingport reads locales/<code>.json itself and hands the window `t()`.
const localeDir = path.resolve(here, "../locales");
const STRINGS = Object.fromEntries(
  fs
    .readdirSync(localeDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [name.slice(0, -".json".length), JSON.parse(fs.readFileSync(path.join(localeDir, name), "utf8"))]),
);

// ---- the words ---------------------------------------------------------------------------------------------------

await test("every language says everything, and nothing extra", () => {
  const english = Object.keys(STRINGS.en);
  assert.ok(english.length > 150, `only ${english.length} strings`);
  for (const [code, words] of Object.entries(STRINGS)) {
    const keys = Object.keys(words);
    assert.deepEqual(
      english.filter((key) => !keys.includes(key)),
      [],
      `${code} is missing these`,
    );
    assert.deepEqual(
      keys.filter((key) => !english.includes(key)),
      [],
      `${code} has these and English doesn't`,
    );
  }
});

await test("a translation fills in the same blanks as the English", () => {
  const blanks = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [code, words] of Object.entries(STRINGS)) {
    if (code === "en") continue;
    for (const [key, text] of Object.entries(words)) {
      assert.deepEqual(blanks(text), blanks(STRINGS.en[key]), `${code} ${key} fills in different things`);
    }
  }
});

await test("nothing was left in English by accident", () => {
  // A few are the same word in every language, and a few are names; everything else should differ somewhere.
  const same = new Set(["view.home", "file.3mf", "file.obj", "file.stl", "magnets.spec", "notes.magnetList"]);
  for (const [code, words] of Object.entries(STRINGS)) {
    if (code === "en") continue;
    const copied = Object.keys(words).filter((key) => !same.has(key) && words[key] === STRINGS.en[key]);
    assert.ok(
      copied.length < 12,
      `${code} still has ${copied.length} English strings: ${copied.slice(0, 12).join(", ")}`,
    );
  }
});

await test("the metadata names exactly the languages that are there", () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(here, "tool.base.json"), "utf8"));
  assert.deepEqual([...(manifest.locales ?? [])].sort(), Object.keys(STRINGS).sort());
});

await test("a label key is one Thingport will accept", () => {
  // The server checks these, so a key it would refuse means a language that silently doesn't install.
  const allowed = /^[A-Za-z0-9][\w.-]*$/;
  for (const [code, words] of Object.entries(STRINGS)) {
    for (const key of Object.keys(words)) assert.ok(allowed.test(key), `${code} has an unusable key: ${key}`);
    for (const [key, text] of Object.entries(words)) {
      assert.ok(text.length <= 2000, `${code} ${key} is longer than the server allows`);
    }
  }
});

await test("the window asks for labels that exist, and none are left unused", () => {
  // What caught this before: a panel was taken out and its labels stayed behind, translated into four languages
  // nobody would ever read. This checks both directions.
  const window = fs.readFileSync(path.join(here, "ui.js"), "utf8");
  const english = Object.keys(STRINGS.en);

  // Asked for by name — anywhere, since a label is often picked by a ternary inside the call.
  const asked = new Set([...window.matchAll(/"([a-z][\w-]*(?:\.[\w-]+)+)"/g)].map((match) => match[1]));
  // Asked for by family, e.g. t(`error.${code}`) or t(`nav.${id}`).
  const families = [...window.matchAll(/\bt\(\s*`([\w.-]+)\.\$\{/g)].map((match) => match[1]);

  const missing = [...asked].filter((key) => !english.includes(key));
  assert.deepEqual(missing, [], "the window asks for labels that aren't in en.json");

  const unused = english.filter((key) => !asked.has(key) && !families.some((family) => key.startsWith(`${family}.`)));
  assert.deepEqual(unused, [], "these labels are translated but never shown");
});

await test("every engine refusal has words to show for it", () => {
  // The engine attaches a code to each; the window looks up `error.<code>`, so one without a string would
  // show the key instead of a sentence.
  const source = fs.readFileSync(path.join(here, "engine.js"), "utf8");
  const codes = [...source.matchAll(/throw fail\("(\w+)"/g)].map((match) => match[1]);
  assert.ok(codes.length >= 15, `only found ${codes.length} refusals`);
  for (const code of new Set(codes)) {
    assert.ok(STRINGS.en[`error.${code}`], `no English for error.${code}`);
  }
});

// ---- the engine, when the libraries are here --------------------------------------------------------------------

const frontend = path.join(repository, "frontend");
// Resolved as files rather than by name: these packages describe themselves for a bundler, not for a bare `node`.
const load = async (file) => {
  const module = await import(pathToFileURL(path.join(frontend, "node_modules", file)).href);
  return module.default ?? module;
};

let engine = null;
try {
  const [opentype, Manifold] = await Promise.all([
    load("opentype.js/dist/opentype.mjs"),
    load("manifold-3d/manifold.js"),
  ]);
  const api = await Manifold();
  api.setup();
  const file = path.join(frontend, "src/assets/toolFonts/pt-sans.ttf");
  const data = fs.readFileSync(file);
  const font = opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
  const { buildModel } = await import("./engine.js");
  engine = { api, font, buildModel, opentype };
} catch (error) {
  skipped = 1;
  console.log(`  (the engine's own tests need the frontend's packages: ${error.message})`);
}

if (engine) {
  const { api, font, buildModel } = engine;
  const run = (settings) => buildModel(font, api, { ...DEFAULTS, ...settings }, flattenPath);

  await test("a keyring comes out at the width asked for", () => {
    const built = run({ text: "Keyring", width: 60 });
    near(built.size[0], 60, 0.6, "the overall width");
    assert.ok(built.models.length >= 2, "a border and some letters");
    assert.equal(built.connected, true, "and it's all one piece");
  });

  await test("the letters keep their counters: the holes go right through", () => {
    const built = run({ text: "Boa", width: 70 });
    const genus = (char) => {
      const model = built.models.find((item) => item.char === char);
      assert.ok(model, `no ${char} came out`);
      return model.genus;
    };
    // Manifold's genus counts the holes through a solid: B has two, o and a have one each.
    assert.equal(genus("B"), 2, "B keeps both of its counters");
    assert.equal(genus("o"), 1, "o is a ring, not a disc");
    assert.equal(genus("a"), 1, "a keeps its counter");
  });

  await test("a letter without a counter has no hole invented for it", () => {
    const built = run({ text: "lx", width: 50 });
    for (const char of ["l", "x"]) {
      assert.equal(built.models.find((item) => item.char === char).genus, 0, `${char} is solid`);
    }
  });

  await test("thickening the strokes makes the letters heavier, not bigger", () => {
    const plain = run({ text: "Keyring", width: 60, stroke: 0 });
    const heavy = run({ text: "Keyring", width: 60, stroke: 0.4 });
    const volume = (built) => built.models.filter((m) => m.kind === "letter").reduce((total, m) => total + m.volume, 0);
    assert.ok(volume(heavy) > volume(plain) * 1.1, "there is more letter there");
    near(heavy.size[0], plain.size[0], 0.6, "and it is still the width asked for");
  });

  await test("the width can be let go, and then it follows the letters", () => {
    const built = run({ text: "Keyring", width: 60, widthLocked: false, textScale: 0.5 });
    assert.ok(built.size[0] > 0);
    assert.ok(Number.isFinite(built.textScale));
  });

  await test("a ring puts a hole through the piece, with a collar of material round it", () => {
    const plain = run({ text: "Tag", holes: [] });
    const ringed = run({
      text: "Tag",
      holes: [{ x: -0.94, y: 0.2, inner: 4, outer: 8, localJoin: true, reinforce: true }],
    });
    assert.equal(ringed.holes.length, 1);
    const border = (built) => built.models.find((model) => model.kind === "border");
    // The width is held, so the collar shows up as one more hole through the border and more material in it,
    // rather than as a wider keyring.
    assert.equal(border(ringed).genus, border(plain).genus + 1, "exactly one more hole through the border");
    assert.ok(border(ringed).volume > border(plain).volume, "and the collar adds material");
  });

  await test("a ring asked for outside the piece is slid back onto it", () => {
    const built = run({ text: "Tag", holes: [{ x: -9, y: 9, inner: 4, outer: 8, localJoin: true, reinforce: true }] });
    const hole = built.holes[0];
    const { min, max } = built.bounds;
    assert.ok(hole.x > min[0] && hole.x < max[0], `x ${hole.x} is inside ${min[0]}..${max[0]}`);
    assert.ok(hole.y > min[1] && hole.y < max[1], `y ${hole.y} is inside ${min[1]}..${max[1]}`);
  });

  await test("printing the letters apart opens up their recesses, and leaves the letters true to the font", () => {
    const joined = run({ text: "Ab", assembled: true, separate: false });
    const apart = run({ text: "Ab", assembled: false, separate: true, clearance: 0.2 });
    const letters = (built) =>
      built.models.filter((model) => model.kind === "letter").reduce((total, model) => total + model.volume, 0);
    const shell = (built) => built.models.find((model) => model.kind === "border").volume;
    // The gap is taken out of the hole, not off the letter: a letter that was shaved would no longer be the
    // shape the font drew.
    near(letters(apart), letters(joined), 0.01, "the letters are untouched");
    assert.ok(shell(apart) < shell(joined), "the recesses in the shell were opened up instead");
  });

  await test("magnet pockets take material out of the back", () => {
    const plain = run({ text: "Tag" });
    const magnetised = run({
      text: "Tag",
      magnetEnabled: true,
      magnetMode: "open",
      magnets: [{ diameter: 6, depth: 2, x: 0, y: 0 }],
    });
    const border = (built) => built.models.find((model) => model.kind === "border");
    assert.ok(magnetised.effectiveBase > plain.effectiveBase, "the base was thickened for the magnet");
    assert.equal(magnetised.magnets.length, 1);
    assert.ok(Number.isFinite(magnetised.magnets[0].normalizedX), "and its settled position comes back");
    assert.ok(border(magnetised).volume > 0);
  });

  await test("every solid that comes out is watertight", () => {
    const built = run({ text: "Hey\nyou", width: 70, borderRound: true, letterRound: true, roundRadius: 0.4 });
    for (const model of built.models) {
      assert.ok(model.vertices.length > 0 && model.triangles.length > 0, `${model.name} is empty`);
      assert.equal(model.triangles.length % 3, 0);
      assert.ok(model.volume > 0, `${model.name} has no volume`);
    }
  });

  await test("nonsense settings are refused with something a person can act on", () => {
    assert.throws(() => run({ text: "" }), /Type something/);
    assert.throws(() => run({ text: "Hi", width: 2 }), /at least 15 mm/);
    assert.throws(() => run({ text: "Hi", letterDepth: 0 }), /more than nothing/);
    assert.throws(() => run({ text: "Hi", align: "middle" }), /line up/);
    assert.throws(() => run({ text: "Hi 中" }), /no 中/);
  });

  await test("every font Thingport ships keeps its letters' counters", () => {
    // What went wrong once: a variable font's outlines only come out right once its deltas are applied, which
    // the parser doesn't do, so letters came back collapsed or with every contour wound the same way — and a
    // counter that has lost its winding fills in when it is made solid. This measures all of them for that.
    const folder = path.join(frontend, "src/assets/toolFonts");
    const files = fs.readdirSync(folder).filter((name) => name.endsWith(".ttf"));
    assert.ok(files.length >= 15, `only ${files.length} fonts found`);
    const faults = [];
    for (const file of files.sort()) {
      const data = fs.readFileSync(path.join(folder, file));
      let face;
      try {
        face = engine.opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
      } catch (error) {
        faults.push(`${file}: won't parse (${error.message})`);
        continue;
      }
      for (const character of [..."ABDOPRaebdgopq068"]) {
        if (!face.charToGlyphIndex(character)) continue;
        const polys = flattenPath(face.charToGlyph(character).getPath(0, 0, 100), 0.02);
        if (!polys.length) {
          faults.push(`${file}: ${character} has no outline`);
          continue;
        }
        const areas = polys.map(signedArea);
        const outer = Math.max(...areas.map(Math.abs));
        const ink = Math.abs(areas.reduce((total, area) => total + area, 0));
        // A counter never eats most of its letter, so little ink left means the contours came back wrong.
        if (ink < outer * 0.3)
          faults.push(`${file}: ${character}'s ink is ${Math.round((ink / outer) * 100)}% of its outline`);
        // How many contours a letter has is the typeface's business — an open 4, a caps-only g and a swash B
        // have no counter at all — but where there are several, one has to wind against the rest.
        if (polys.length > 1 && new Set(areas.map(Math.sign)).size < 2) {
          faults.push(`${file}: ${character}'s ${polys.length} contours are all wound the same way`);
        }
      }
      // And it has to come out of the engine as a ring, not a disc.
      const built = buildModel(face, api, { ...DEFAULTS, text: "Bogen 8", width: 90 }, flattenPath);
      const o = built.models.find((model) => model.char === "o");
      if (o && o.genus !== 1) faults.push(`${file}: o came out with ${o.genus} holes through it, not 1`);
      for (const model of built.models) if (!(model.volume > 0)) faults.push(`${file}: ${model.name} has no volume`);
    }
    assert.deepEqual(faults, [], `\n    ${faults.join("\n    ")}`);
  });

  await test("the whole thing exports after a real build", async () => {
    const built = run({ text: "Keyring", width: 60 });
    const bytes = await threeMf(built.models, DEFAULT_COLOURS, { title: "Keyring" });
    assert.ok(bytes.length > 2000, `a real 3MF, got ${bytes.length} bytes`);
    const text = obj(built.models);
    assert.ok(text.split("\n").filter((line) => line.startsWith("o ")).length === built.models.length);
  });
}

console.log(
  `\n${passed} passed${skipped ? ", engine tests skipped" : ""}${failures.length ? `, ${failures.length} failed` : ""}`,
);
if (failures.length) {
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
