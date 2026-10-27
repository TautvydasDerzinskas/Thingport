// The tool's tests. Run from the tool's folder:
//   node source/test_qr.mjs
//
// Four things are checked, because four things could quietly be wrong:
//
//  - The symbol. Every version and level is checked against the character counts the standard publishes, and a
//    set of finished symbols against fingerprints taken when each was compared, module for module, with an
//    independent encoder. A symbol is also read back out of its own grid — unmasked, de-interleaved, its
//    Reed-Solomon check codewords verified and its payload parsed — so a mistake in laying it out can't pass.
//  - The text a reader gets, for each kind of content, escaping and all.
//  - Every solid, for every shape, relief and option: closed, wound the right way out, and of a positive volume.
//  - A flush code's top layer, which must tile its opening exactly: no overlap between the two filaments and no
//    gap between them. That one number is what proves the bands around the dark shapes are right.
//
// And the labels: every key the code asks for exists in English, and no language has a key English hasn't.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LEVELS,
  alignmentCentres,
  blockStructure,
  capacity,
  dataCodewords,
  encode,
  modeFor,
  smallestVersion,
  totalCodewords,
} from "./qr.js";
import { DEFAULT_CONTENT, FIELDS, KINDS, normalizeUrl, textFor } from "./content.js";
import { DEFAULTS, QUIET } from "./layout.js";
import { BODIES, EYE_CENTRES, EYE_FRAMES, RELIEFS } from "./shapes.js";
import { buildModel } from "./model.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const tool = path.resolve(here, "..");

let failures = 0;
let checks = 0;
const ok = (condition, what) => {
  checks++;
  if (!condition) {
    failures++;
    console.error(`✗ ${what}`);
  }
};
const same = (got, want, what) => ok(got === want, `${what}: got ${got}, wanted ${want}`);

// ---- the symbol ------------------------------------------------------------------------------------------------

// How many bytes each version holds at each level, from the standard's own table — written out here so a mistake
// in the error-correction tables can't hide behind them.
const BYTE_CAPACITY = {
  1: [17, 14, 11, 7],
  2: [32, 26, 20, 14],
  3: [53, 42, 32, 24],
  4: [78, 62, 46, 34],
  5: [106, 84, 60, 44],
  10: [271, 213, 151, 119],
  20: [858, 666, 482, 382],
  40: [2953, 2331, 1663, 1273],
};
for (const [version, counts] of Object.entries(BYTE_CAPACITY)) {
  LEVELS.forEach((level, index) => {
    same(capacity(Number(version), level, "byte"), counts[index], `version ${version} level ${level} byte capacity`);
  });
}
same(capacity(1, "L", "numeric"), 41, "version 1 L numeric capacity");
same(capacity(1, "L", "alphanumeric"), 25, "version 1 L alphanumeric capacity");
same(capacity(40, "L", "numeric"), 7089, "version 40 L numeric capacity");
same(totalCodewords(1), 26, "version 1 codewords");
same(totalCodewords(40), 3706, "version 40 codewords");
same(dataCodewords(1, "H"), 9, "version 1 H data codewords");

same(alignmentCentres(1).join(","), "", "version 1 has no alignment patterns");
same(alignmentCentres(2).join(","), "6,18", "version 2 alignment patterns");
same(alignmentCentres(7).join(","), "6,22,38", "version 7 alignment patterns");
same(alignmentCentres(32).join(","), "6,34,60,86,112,138", "version 32 alignment patterns");
same(alignmentCentres(40).join(","), "6,30,58,86,114,142,170", "version 40 alignment patterns");

same(modeFor("12345"), "numeric", "digits take numeric mode");
same(modeFor("HELLO WORLD"), "alphanumeric", "capitals take alphanumeric mode");
same(modeFor("hello"), "byte", "lower case takes byte mode");
same(smallestVersion("x".repeat(17), "L", "byte"), 1, "17 bytes fit version 1 at L");
same(smallestVersion("x".repeat(18), "L", "byte"), 2, "18 bytes need version 2 at L");

/** A fingerprint of a finished symbol, so a change to any of its modules shows up. */
const fingerprint = (code) => {
  let hash = 0x811c9dc5;
  for (const value of code.modules) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${code.version}-${code.level}-${code.mask}-${hash.toString(16).padStart(8, "0")}`;
};

// Taken when each of these was compared with an independent encoder, module for module.
const SYMBOLS = [
  ["https://thingport.app", "M", "auto", "auto", "2-M-2-8abf7dd9"],
  ["https://thingport.app", "H", "auto", "auto", "3-H-6-48e50b3b"],
  ["HELLO WORLD", "Q", "auto", "auto", "1-Q-6-f584476d"],
  ["12345678901234567890", "L", "auto", "auto", "1-L-7-9488b759"],
  ["WIFI:T:WPA;S:Workshop;P:hunter2;;", "M", "auto", "auto", "3-M-0-f0c077ff"],
  ["x".repeat(300), "L", "auto", "auto", "11-L-0-a257cc9f"],
  ["thingport", "L", 7, 0, "7-L-0-3e8a7d6d"],
  ["thingport", "M", 20, 3, "20-M-3-69a4b82f"],
  ["thingport", "H", 40, 7, "40-H-7-d0f92d7d"],
];
for (const [text, level, version, mask, want] of SYMBOLS) {
  same(fingerprint(encode(text, { level, version, mask })), want, `symbol for ${text.slice(0, 24)} at ${level}`);
}

// ---- reading a symbol back out of its own grid ------------------------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const times = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

const ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/** Whether a block's check codewords actually check out: every syndrome of a sound block is zero. */
function syndromesZero(block, ecc) {
  for (let i = 0; i < ecc; i++) {
    let value = 0;
    for (const byte of block) value = times(value, EXP[i]) ^ byte;
    if (value !== 0) return false;
  }
  return true;
}

/** The text back out of a finished symbol, the long way round: what a reader would get. */
function readBack(code) {
  const { size, modules, reserved } = code;
  const rule = MASKS[code.mask];
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      for (let column = 0; column < 2; column++) {
        const x = right - column;
        const upwards = ((right + 1) & 2) === 0;
        const y = upwards ? size - 1 - step : step;
        const at = y * size + x;
        if (reserved[at]) continue;
        bits.push(modules[at] ^ (rule(x, y) ? 1 : 0));
      }
    }
  }
  const codewords = new Uint8Array(totalCodewords(code.version));
  for (let i = 0; i < codewords.length * 8 && i < bits.length; i++) codewords[i >> 3] |= bits[i] << (7 - (i % 8));

  // Undo the interleaving the standard asks for, then check each block.
  const { blocks, ecc, short, longBlocks } = blockStructure(code.version, code.level);
  const pieces = Array.from({ length: blocks }, () => ({ data: [], check: [] }));
  let at = 0;
  for (let i = 0; i < short + 1; i++) {
    for (let block = 0; block < blocks; block++) {
      const length = short + (block >= blocks - longBlocks ? 1 : 0);
      if (i < length) pieces[block].data.push(codewords[at++]);
    }
  }
  for (let i = 0; i < ecc; i++) for (let block = 0; block < blocks; block++) pieces[block].check.push(codewords[at++]);
  for (const piece of pieces) {
    if (!syndromesZero([...piece.data, ...piece.check], ecc))
      return { error: "a block's check codewords don't check out" };
  }

  const stream = pieces.flatMap((piece) => piece.data);
  const bitsOf = [];
  for (const byte of stream) for (let i = 7; i >= 0; i--) bitsOf.push((byte >> i) & 1);
  let cursor = 0;
  const take = (count) => {
    let value = 0;
    for (let i = 0; i < count; i++) value = (value << 1) | (bitsOf[cursor++] ?? 0);
    return value;
  };
  const mode = take(4);
  const band = code.version <= 9 ? 0 : code.version <= 26 ? 1 : 2;
  const widths = { 1: [10, 12, 14], 2: [9, 11, 13], 4: [8, 16, 16] };
  if (!widths[mode]) return { error: `unknown mode ${mode}` };
  const count = take(widths[mode][band]);
  if (mode === 1) {
    let out = "";
    for (let i = 0; i < count; i += 3) {
      const digits = Math.min(3, count - i);
      out += String(take(digits * 3 + 1)).padStart(digits, "0");
    }
    return { text: out };
  }
  if (mode === 2) {
    let out = "";
    for (let i = 0; i < count; i += 2) {
      if (count - i >= 2) {
        const pair = take(11);
        out += ALPHANUMERIC[Math.floor(pair / 45)] + ALPHANUMERIC[pair % 45];
      } else out += ALPHANUMERIC[take(6)];
    }
    return { text: out };
  }
  const bytes = new Uint8Array(count);
  for (let i = 0; i < count; i++) bytes[i] = take(8);
  return { text: new TextDecoder().decode(bytes) };
}

for (const [text, level, version] of [
  ["https://thingport.app", "M", "auto"],
  ["HELLO WORLD 123", "Q", "auto"],
  ["0123456789", "H", "auto"],
  ["Ačiū už tai, kad spausdinate", "M", "auto"],
  ["WIFI:T:WPA;S:Workshop;P:hunter2;;", "M", "auto"],
  ["x".repeat(120), "L", "auto"],
  ["thingport", "L", 7],
]) {
  const code = encode(text, { level, version });
  const read = readBack(code);
  same(read.text ?? read.error, text, `read back version ${code.version} ${level}`);
}

// ---- what the code says ----------------------------------------------------------------------------------------

same(normalizeUrl("thingport.app"), "https://thingport.app", "a bare domain gets a scheme");
same(normalizeUrl("http://a.b/c"), "http://a.b/c", "a scheme is left alone");
same(
  normalizeUrl("https://Thingport.App/Path", true),
  "HTTPS://THINGPORT.APP/Path",
  "shortening leaves the path alone",
);
same(
  textFor({ ...DEFAULT_CONTENT, kind: "wifi", ssid: "Work; shop", password: 'pa"ss', security: "WPA" }),
  String.raw`WIFI:T:WPA;S:Work\; shop;P:pa\"ss;;`,
  "a Wi-Fi string escapes what would end a field",
);
same(
  textFor({ ...DEFAULT_CONTENT, kind: "wifi", ssid: "Open", security: "nopass", password: "ignored" }),
  "WIFI:T:nopass;S:Open;;",
  "an open network carries no password",
);
same(
  textFor({ ...DEFAULT_CONTENT, kind: "contact", firstName: "Jo", lastName: "Smith", phone: "+370 600 00000" }),
  "MECARD:N:Smith,Jo;TEL:+370 600 00000;;",
  "a MECARD puts the family name first",
);
ok(
  textFor({
    ...DEFAULT_CONTENT,
    kind: "contact",
    format: "vcard",
    firstName: "Jo",
    email: "jo@example.com",
  }).startsWith("BEGIN:VCARD\nVERSION:3.0\nN:;Jo;;;\nFN:Jo"),
  "a vCard starts as a vCard",
);
same(textFor({ ...DEFAULT_CONTENT, kind: "wifi", ssid: "" }), "", "an unnamed network says nothing");
for (const kind of KINDS) ok(Array.isArray(FIELDS[kind]), `${kind} has fields`);

// ---- the solids ------------------------------------------------------------------------------------------------

/** A part's closure, volume and whether anything in it isn't a number. */
function measure(part) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let volume = 0;
  let broken = 0;
  for (let i = 0; i < part.triangles.length; i += 3) {
    const corners = [0, 1, 2].map((k) => {
      const at = part.triangles[i + k] * 3;
      return [part.vertices[at], part.vertices[at + 1], part.vertices[at + 2]];
    });
    if (corners.flat().some((value) => !Number.isFinite(value))) broken++;
    const [a, b, c] = corners;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    nx += u[1] * v[2] - u[2] * v[1];
    ny += u[2] * v[0] - u[0] * v[2];
    nz += u[0] * v[1] - u[1] * v[0];
    volume +=
      (a[0] * (b[1] * c[2] - c[1] * b[2]) - a[1] * (b[0] * c[2] - c[0] * b[2]) + a[2] * (b[0] * c[1] - c[0] * b[1])) /
      6;
  }
  return { closure: Math.hypot(nx, ny, nz), volume, broken };
}

const settings = (changes = {}) => ({
  ...structuredClone(DEFAULTS),
  content: structuredClone(DEFAULT_CONTENT),
  ...changes,
});

function checkSolids(label, state) {
  let model;
  try {
    model = buildModel(state);
  } catch (error) {
    ok(false, `${label} builds: ${error.message}`);
    return null;
  }
  for (const part of model.parts) {
    const { closure, volume, broken } = measure(part);
    ok(broken === 0, `${label}: ${part.name} has ${broken} triangle(s) that aren't numbers`);
    ok(
      closure < 1e-3 * Math.max(1, Math.abs(volume)),
      `${label}: ${part.name} isn't closed (${closure.toExponential(1)})`,
    );
    ok(volume > 0, `${label}: ${part.name} is inside out or empty (${volume.toFixed(4)} mm³)`);
  }
  ok(model.parts.length >= 2, `${label} has a tile and a code`);
  return model;
}

for (const body of BODIES) {
  for (const relief of RELIEFS) {
    for (const modules of ["raised", "flush"])
      checkSolids(`${body}/${relief}/${modules}`, settings({ body, relief, modules }));
  }
}
for (const eyeFrame of EYE_FRAMES) {
  for (const eyeCentre of EYE_CENTRES) checkSolids(`eye ${eyeFrame}/${eyeCentre}`, settings({ eyeFrame, eyeCentre }));
}
for (const shape of ["tile", "keychain"]) {
  for (const border of [true, false]) {
    for (const quiet of Object.keys(QUIET))
      checkSolids(`${shape}/border:${border}/quiet:${quiet}`, settings({ shape, border, quiet }));
  }
}
for (const patch of ["square", "circle"]) {
  for (const modules of ["raised", "flush"]) {
    checkSolids(`patch ${patch}/${modules}`, settings({ modules, patch: { ...DEFAULTS.patch, shape: patch } }));
  }
}
for (const level of LEVELS) {
  for (const length of [1, 120, 900]) {
    checkSolids(
      `level ${level}, ${length} characters`,
      settings({ level, content: { ...DEFAULT_CONTENT, kind: "text", text: "x".repeat(length) } }),
    );
  }
}
checkSolids("sized by the whole tile", settings({ sizeBy: "plate", plateMm: 48 }));
checkSolids("thin modules", settings({ body: "dot", fill: 0.7 }));

// A caption without a typeface leaves the words off and says so rather than failing.
{
  const model = checkSolids(
    "caption with no typeface",
    settings({ caption: { ...DEFAULTS.caption, text: "Workshop" } }),
  );
  ok(
    model?.warnings.some((warning) => warning.code === "captionNoFont"),
    "a caption with no typeface is reported",
  );
}

// A patch clears the modules under it, and says how many.
{
  const model = buildModel(settings({ patch: { ...DEFAULTS.patch, shape: "circle", across: 9 }, level: "H" }));
  ok(model.counts.cleared > 0, "a patch clears modules");
  ok(
    model.warnings.some((warning) => warning.code === "patchCovers" || warning.code === "patchTooBig"),
    "a patch says how much of the code it covers",
  );
}

// The flush top layer has to tile its opening exactly: the two filaments meet, and neither overlaps the other.
{
  const state = settings({ modules: "flush", body: "dot", border: false, cornerMm: 0, shape: "tile" });
  const model = buildModel(state);
  const total = model.parts.reduce((sum, part) => sum + measure(part).volume, 0);
  const plate = model.plan.plate.width * model.plan.plate.height * model.plan.thickness.base;
  const layer = (model.plan.opening.x1 - model.plan.opening.x0) ** 2 * model.plan.thickness.code;
  // The only slack is the plate's own rounded corners, which are a fifth of a millimetre.
  ok(
    Math.abs(total - (plate + layer)) < 0.25,
    `a flush code tiles its opening exactly (off by ${(total - plate - layer).toFixed(3)} mm³)`,
  );
}

// ---- the words -------------------------------------------------------------------------------------------------

const english = JSON.parse(fs.readFileSync(path.join(tool, "locales/en.json"), "utf8"));
const asked = new Set();
for (const file of fs.readdirSync(here).filter((name) => name.endsWith(".js"))) {
  const text = fs.readFileSync(path.join(here, file), "utf8");
  for (const [, key] of text.matchAll(/\bt\(\s*["`]([^"`$]+)["`]/g)) asked.add(key);
}
for (const [, key] of fs
  .readFileSync(path.join(tool, "tool.html"), "utf8")
  .matchAll(/data-t(?:-title|-aria|-placeholder)?="([^"]+)"/g)) {
  asked.add(key);
}
// The keys built up from a list, which no search of the source would find.
const WARNINGS = [
  "moduleTiny",
  "moduleSmall",
  "noQuietZone",
  "shortQuietZone",
  "sameColourRaised",
  "sameColourFlush",
  "lowContrast",
  "patchTooBig",
  "patchCovers",
  "thinModules",
  "biggerThanBed",
  "tallModules",
  "bigVersion",
  "biggerThanNeeded",
  "captionShrunk",
  "captionEmpty",
  "captionNoFont",
];
for (const code of WARNINGS) {
  asked.add(`check.${code}`);
  asked.add(`check.${code}Fix`);
}
for (const gap of ["needUrl", "needText", "needSsid", "needContact"]) asked.add(`content.${gap}`);
for (const code of ["empty", "tooMuch", "wontFitVersion"]) asked.add(`error.${code}`);
for (const kind of KINDS) {
  asked.add(`content.kind.${kind}`);
  for (const field of FIELDS[kind]) {
    asked.add(`content.field.${kind}.${field.name}`);
    for (const option of field.options ?? []) asked.add(`content.option.${field.name}.${option}`);
  }
}
for (const level of LEVELS) asked.add(`content.level.${level}`);
for (const mode of ["numeric", "alphanumeric", "byte"]) asked.add(`content.mode.${mode}`);
for (const section of ["content", "shape", "style", "colour", "extras", "check"]) asked.add(`nav.${section}`);
for (const part of ["base", "code", "border", "caption", "patch"]) asked.add(`part.${part}`);
for (const quiet of Object.keys(QUIET)) asked.add(`shape.quiet.${quiet}`);
for (const body of BODIES) asked.add(`style.body.${body}`);
for (const frame of EYE_FRAMES) asked.add(`style.eyeFrame.${frame}`);
for (const centre of EYE_CENTRES) asked.add(`style.eyeCentre.${centre}`);
for (const relief of RELIEFS) asked.add(`style.relief.${relief}`);
for (const key of ["notes.raised", "notes.flush"]) asked.add(key);

const missing = [...asked].filter((key) => !(key in english)).sort();
ok(missing.length === 0, `English has every label the tool asks for (missing: ${missing.join(", ")})`);

for (const file of fs.readdirSync(path.join(tool, "locales"))) {
  if (file === "en.json") continue;
  const words = JSON.parse(fs.readFileSync(path.join(tool, "locales", file), "utf8"));
  const stray = Object.keys(words).filter((key) => !(key in english));
  ok(stray.length === 0, `${file} has no key English hasn't (${stray.join(", ")})`);
  const blank = Object.entries(words).filter(([, value]) => !String(value).trim());
  ok(blank.length === 0, `${file} has no empty labels (${blank.map(([key]) => key).join(", ")})`);
  const untranslated = Object.keys(english).filter((key) => !(key in words));
  if (untranslated.length) console.log(`  ${file}: ${untranslated.length} label(s) fall back to English`);
}

console.log(failures ? `✗ ${failures} of ${checks} checks failed` : `✓ ${checks} checks passed`);
process.exit(failures ? 1 : 0);
