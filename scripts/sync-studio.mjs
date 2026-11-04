// Copies Studio's core, frontend/src/studio/, into backend/src/studio/ as <file>.generated.ts: the browser applies a
// command at once and the server keeps the result, so both run the same code. Each builds on its own (their own Docker
// contexts and lockfiles), which is why it's a copy. Tests stay behind, and only *.generated.ts files are ever written or
// removed there. The fonts text in a design is drawn in go along too, from frontend/src/assets/toolFonts/ into
// backend/assets/studio-fonts/, with their licence. The copies are committed:
//
//   npm run studio:sync    rewrite them
//   npm run studio:check   fail when one is out of date (CI)

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "frontend/src/studio";
const TARGET = "backend/src/studio";
const GENERATED = /\.generated\.ts$/;

const check = process.argv.includes("--check");

/** A copied file's relative imports, which are all of other copies, by their copies' names. */
const pointAtCopies = (text) => text.replace(/(from\s+"\.\/[^"]+?)(")/g, "$1.generated$2");

const header = (from) =>
  `// GENERATED from ${from} by scripts/sync-studio.mjs. Don't edit it here:\n` +
  `// change ${SOURCE}/ and run npm run studio:sync.\n`;

const sources = readdirSync(path.join(ROOT, SOURCE)).filter(
  (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
);
const options = await prettier.resolveConfig(path.join(ROOT, TARGET, "x.ts"));
const wanted = new Map();
for (const file of sources) {
  const from = `${SOURCE}/${file}`;
  const text = header(from) + pointAtCopies(readFileSync(path.join(ROOT, from), "utf8"));
  wanted.set(file.replace(/\.ts$/, ".generated.ts"), await prettier.format(text, { ...options, parser: "typescript" }));
}

const targetDir = path.join(ROOT, TARGET);
const existing = existsSync(targetDir) ? readdirSync(targetDir).filter((file) => GENERATED.test(file)) : [];
const stale = [];
for (const [file, text] of wanted) {
  const at = path.join(targetDir, file);
  if (existsSync(at) && readFileSync(at, "utf8") === text) continue;
  stale.push(`${TARGET}/${file}`);
  if (!check) {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(at, text);
  }
}
for (const file of existing) {
  if (wanted.has(file)) continue;
  stale.push(`${TARGET}/${file} (no longer in ${SOURCE})`);
  if (!check) rmSync(path.join(targetDir, file));
}

// The fonts, byte for byte, and the notices their licence asks to travel with them.
const FONTS = "frontend/src/assets/toolFonts";
const FONT_COPIES = "backend/assets/studio-fonts";
const fontFiles = readdirSync(path.join(ROOT, FONTS)).filter((file) => /\.ttf$|^OFL\.txt$|^README\.md$/.test(file));
const fontDir = path.join(ROOT, FONT_COPIES);
for (const file of fontFiles) {
  const from = path.join(ROOT, FONTS, file);
  const at = path.join(fontDir, file);
  if (existsSync(at) && readFileSync(at).equals(readFileSync(from))) continue;
  stale.push(`${FONT_COPIES}/${file}`);
  if (!check) {
    mkdirSync(fontDir, { recursive: true });
    copyFileSync(from, at);
  }
}
for (const file of existsSync(fontDir) ? readdirSync(fontDir) : []) {
  if (fontFiles.includes(file)) continue;
  stale.push(`${FONT_COPIES}/${file} (no longer in ${FONTS})`);
  if (!check) rmSync(path.join(fontDir, file));
}

if (check && stale.length) {
  console.error(`Studio's copies are out of date; run npm run studio:sync:\n  ${stale.join("\n  ")}`);
  process.exit(1);
}
if (!check) console.log(stale.length ? `Wrote ${stale.join(", ")}` : "Studio's copies were up to date");
