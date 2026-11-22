// Writes docs/features/file-kinds.md from the kind table, backend/src/files/kinds.json, so the page can't drift from
// what the code reads a file as. The page is committed, and the website renders it:
//
//   npm run kinds:sync    rewrite it
//   npm run kinds:check   fail when it's out of date (CI)

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TABLE = "backend/src/files/kinds.json";
const PAGE = "docs/features/file-kinds.md";

const kinds = JSON.parse(readFileSync(path.join(ROOT, TABLE), "utf8"));
const code = (items) => items.map((item) => `\`${item}\``).join(", ");

const rows = kinds.map(({ label, about, extensions, names }) => {
  const by = [extensions?.length ? code(extensions) : "", names?.length ? `named ${code(names)}` : ""].filter(Boolean);
  return `| ${label} | ${by.join("; ") || "by their names"} | ${about} |`;
});

const page = `<!-- Written by scripts/sync-kinds.mjs from ${TABLE}: change the table, then run npm run kinds:sync. -->

# File kinds

Thingport tells what a file is by its name: its extension, or for a few kinds the whole name. Case doesn't count, and
a name is read as Thingport keeps it, so \`part.STL \` with a space at the end is an STL.

| Kind | Files | What they are |
| --- | --- | --- |
${rows.join("\n")}
`;

const formatted = await prettier.format(page, {
  ...(await prettier.resolveConfig(path.join(ROOT, PAGE))),
  filepath: path.join(ROOT, PAGE),
});

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(path.join(ROOT, PAGE), "utf8");
  } catch {}
  if (current !== formatted) {
    console.error(`${PAGE} is out of date: run npm run kinds:sync.`);
    process.exit(1);
  }
  console.log(`${PAGE} is up to date.`);
} else {
  writeFileSync(path.join(ROOT, PAGE), formatted);
  console.log(`Wrote ${PAGE}.`);
}
