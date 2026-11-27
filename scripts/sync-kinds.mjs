// Writes the file kinds page and the browser copy of the server's filename rules. Both are committed:
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
const NAME_RULES = "backend/src/files/names.ts";
const BROWSER_RULES = "frontend/src/utils/fileNames.generated.ts";

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

// The model editor needs the same normalization as the rename route to identify filename conflicts.
const compoundKinds = kinds
  .map(({ extensions = [] }) => ({ extensions: extensions.filter((ext) => ext.split(".").length > 2) }))
  .filter(({ extensions }) => extensions.length);
const browserRules =
  `// Generated from ${NAME_RULES} by scripts/sync-kinds.mjs.
` +
  readFileSync(path.join(ROOT, NAME_RULES), "utf8").replace(
    'import kinds from "./kinds.json";',
    `const kinds = ${JSON.stringify(compoundKinds)};`,
  );

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
