// Copies the 3MF adapter, backend/src/adapter/, where else it runs, as <file>.generated.ts: the server makes the
// adapted copies, the web app needs the same plan to know which slicers get one, and Thingport Grab makes copies in
// the browser for people without an instance. Each package builds on its own
// (its own Docker context and lockfile), which is why it's a copy. Only *.generated.ts files are ever written or
// removed there. The copies are committed:
//
//   npm run adapter:sync    rewrite them
//   npm run adapter:check   fail when one is out of date (CI)
//
// --staged <files> takes the sources as they're about to be committed, for the commit hook: the staged files it names
// as they are on disk (where the hook's own fixes are), every other source as git's index has it.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "backend/src/adapter";
const GENERATED = /\.generated\.ts$/;

// What each copy takes: the web app plans but makes no copies, so it has no writers (nor JSZip); Grab takes it all.
const TARGETS = [
  { dir: "frontend/src/adapter", files: ["format.ts", "plan.ts", "settings.ts", "slicers/"] },
  { dir: "extension/src/adapter", files: ["/"] },
];

const check = process.argv.includes("--check");

// The sources, by their path relative to SOURCE with "/" between folders: on disk, or as they're about to be committed.
const disk = {
  list: (dir, recursive) =>
    readdirSync(path.join(ROOT, SOURCE, dir), { recursive }).map((file) => String(file).split(path.sep).join("/")),
  read: (rel) => readFileSync(path.join(ROOT, SOURCE, rel), "utf8"),
  isFolder: (rel) => existsSync(path.join(ROOT, SOURCE, rel)) && statSync(path.join(ROOT, SOURCE, rel)).isDirectory(),
};
function committed(staged) {
  const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const files = git("ls-files", "-z", "--cached", "--", SOURCE)
    .split("\0")
    .filter(Boolean)
    .map((file) => file.slice(SOURCE.length + 1));
  const fromDisk = new Set(
    staged
      .map((file) => path.relative(path.join(ROOT, SOURCE), path.resolve(ROOT, file)).split(path.sep).join("/"))
      .filter((rel) => !rel.startsWith("../")),
  );
  return {
    list: (dir, recursive) =>
      files
        .filter((file) => file.startsWith(dir) && (recursive || !file.slice(dir.length).includes("/")))
        .map((file) => file.slice(dir.length)),
    read: (rel) => (fromDisk.has(rel) ? disk.read(rel) : git("show", `:${SOURCE}/${rel}`)),
    isFolder: (rel) => files.some((file) => file.startsWith(`${rel}/`)),
  };
}
const stagedAt = process.argv.indexOf("--staged");
const sources =
  stagedAt >= 0 ? committed(process.argv.slice(stagedAt + 1).filter((arg) => !arg.startsWith("--"))) : disk;

/** Every .ts file of `rel`, relative to SOURCE: a file, a folder's own ("slicers/"), or the whole tree ("/"). */
function sourceFiles(rel) {
  if (!rel.endsWith("/")) return [rel];
  const recursive = rel === "/";
  const dir = recursive ? "" : rel;
  return sources
    .list(dir, recursive)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => `${dir}${file}`);
}

/** A copied file's relative imports, which are all of other copies, by their copies' names. */
function pointAtCopies(text, rel) {
  return text.replace(/(from\s+")(\.{1,2}\/[^"]+)(")/g, (_all, open, spec, close) => {
    const isFolder = sources.isFolder(path.posix.join(path.posix.dirname(rel), spec));
    return `${open}${spec}${isFolder ? "/index" : ""}.generated${close}`;
  });
}

const header = (from) =>
  `// GENERATED from ${from} by scripts/sync-adapter.mjs. Don't edit it here:\n` +
  `// change ${SOURCE}/ and run npm run adapter:sync.\n`;

// With "/" between folders, as `wanted` names them; readdirSync gives the platform's separator.
function generatedIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map((file) => String(file).split(path.sep).join("/"))
    .filter((file) => GENERATED.test(file));
}

const stale = [];
for (const target of TARGETS) {
  const options = await prettier.resolveConfig(path.join(ROOT, target.dir, "x.ts"));
  const wanted = new Map();
  for (const rel of target.files.flatMap(sourceFiles)) {
    const from = `${SOURCE}/${rel}`;
    const text = header(from) + pointAtCopies(sources.read(rel), rel);
    wanted.set(
      rel.replace(/\.ts$/, ".generated.ts"),
      await prettier.format(text, { ...options, parser: "typescript" }),
    );
  }
  const targetDir = path.join(ROOT, target.dir);
  for (const [file, text] of wanted) {
    const at = path.join(targetDir, file);
    if (existsSync(at) && readFileSync(at, "utf8") === text) continue;
    stale.push(`${target.dir}/${file}`);
    if (!check) {
      mkdirSync(path.dirname(at), { recursive: true });
      writeFileSync(at, text);
    }
  }
  for (const file of generatedIn(targetDir)) {
    if (wanted.has(file)) continue;
    stale.push(`${target.dir}/${file} (no longer in ${SOURCE})`);
    if (!check) rmSync(path.join(targetDir, file));
  }
}

if (check && stale.length) {
  console.error(`The adapter's copies are out of date; run npm run adapter:sync:\n  ${stale.join("\n  ")}`);
  process.exit(1);
}
if (!check && stale.length) console.log(`Wrote ${stale.length} adapter cop${stale.length === 1 ? "y" : "ies"}.`);
