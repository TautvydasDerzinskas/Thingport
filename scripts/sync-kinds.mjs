// Writes the file kinds page and the browser copy of the server's filename rules. Both are committed:
//
//   npm run kinds:sync    rewrite it
//   npm run kinds:check   fail when it's out of date (CI)

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TABLE = "backend/src/files/kinds.json";
const PAGE = "docs/features/file-kinds.md";
const NAME_RULES = "backend/src/files/names.ts";
const BROWSER_RULES = "frontend/src/utils/fileNames.generated.ts";

const stagedAt = process.argv.indexOf("--staged");
// The hook has already formatted these staged files. An input outside the task comes from the index.
const formattedFiles = new Set(
  stagedAt === -1 ? [] : process.argv.slice(stagedAt + 1).map((file) => path.relative(ROOT, path.resolve(file))),
);
const readInput = (file) =>
  stagedAt >= 0 && !formattedFiles.has(file)
    ? execFileSync("git", ["show", `:${file}`], { cwd: ROOT, encoding: "utf8" })
    : readFileSync(path.join(ROOT, file), "utf8");

const kinds = JSON.parse(readInput(TABLE));
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

// The model editor needs the same normalization as the rename route to identify filename conflicts.
const compoundKinds = kinds
  .map(({ extensions = [] }) => ({ extensions: extensions.filter((ext) => ext.split(".").length > 2) }))
  .filter(({ extensions }) => extensions.length);
const browserRules =
  `// Generated from ${NAME_RULES} by scripts/sync-kinds.mjs.
` +
  readInput(NAME_RULES).replace('import kinds from "./kinds.json";', `const kinds = ${JSON.stringify(compoundKinds)};`);

const check = process.argv.includes("--check");
for (const [file, source] of [
  [PAGE, page],
  [BROWSER_RULES, browserRules],
]) {
  const filepath = path.join(ROOT, file);
  const formatted = await prettier.format(source, { ...(await prettier.resolveConfig(filepath)), filepath });
  if (check) {
    let current = "";
    try {
      current = readFileSync(filepath, "utf8");
    } catch {}
    if (current !== formatted) {
      console.error(`${file} is out of date: run npm run kinds:sync.`);
      process.exitCode = 1;
    } else {
      console.log(`${file} is up to date.`);
    }
  } else {
    writeFileSync(filepath, formatted);
    console.log(`Wrote ${file}.`);
  }
}
