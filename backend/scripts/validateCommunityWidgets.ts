// Checks community-widgets/ the way Thingport reads it when installing: every slug in index.json has a folder with
// valid metadata, a script with a default export and a README, and every folder is listed.
// Run with: npx tsx scripts/validateCommunityWidgets.ts [path to community-widgets]

import fs from "node:fs";
import path from "node:path";
import { SLUG, parseManifest, validateCode } from "../src/services/customWidgetFormat";

const root = path.resolve(process.argv[2] ?? path.join(__dirname, "../../community-widgets"));
const problems: string[] = [];
const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

let slugs: unknown[] = [];
try {
  const index = JSON.parse(read(path.join(root, "index.json")) ?? "{}") as { widgets?: unknown };
  if (Array.isArray(index.widgets)) slugs = index.widgets;
  else problems.push("index.json: `widgets` isn't a list");
} catch (err) {
  problems.push(`index.json: ${err instanceof Error ? err.message : err}`);
}

if (new Set(slugs).size !== slugs.length) problems.push("index.json lists a widget twice");
for (const slug of slugs) {
  if (typeof slug !== "string" || !SLUG.test(slug)) {
    problems.push(`index.json: ${JSON.stringify(slug)} isn't a widget name (lowercase letters, digits and dashes)`);
    continue;
  }
  const dir = path.join(root, slug);
  const metadata = read(path.join(dir, "widget.json")) ?? read(path.join(dir, "widget.yml"));
  const script = read(path.join(dir, "widget.js"));
  try {
    if (metadata === null) throw new Error("it has no widget.json or widget.yml");
    parseManifest(metadata);
    if (script === null) throw new Error("it has no widget.js");
    validateCode(script, read(path.join(dir, "widget.html")));
    if (read(path.join(dir, "README.md")) === null) throw new Error("it has no README.md");
  } catch (err) {
    problems.push(`${slug}: ${err instanceof Error ? err.message : err}`);
  }
}

for (const entry of fs.readdirSync(root, { withFileTypes: true }))
  if (entry.isDirectory() && !slugs.includes(entry.name)) problems.push(`${entry.name}: not listed in index.json`);

if (problems.length) {
  console.error(problems.map((problem) => `✗ ${problem}`).join("\n"));
  process.exit(1);
}
console.log(`✓ ${slugs.length} community widget${slugs.length === 1 ? "" : "s"} valid`);
