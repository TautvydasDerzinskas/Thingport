// Checks community-widgets/ the way Thingport reads it when installing: every slug in index.json has a folder with
// valid metadata naming its author, a script with a default export and a README, every screenshot its metadata
// names is there, every language it names has labels that read, and every folder is listed.
// Run with: npx tsx scripts/validateCommunityWidgets.ts [path to community-widgets]

import fs from "node:fs";
import path from "node:path";
import {
  LOCALE_MAX_BYTES,
  LOCALES_MAX_BYTES,
  SCREENSHOT_MAX_BYTES,
  SLUG,
  localeFile,
  parseManifest,
  validateCode,
  validateLocale,
} from "../src/services/customWidgetFormat";

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
    const manifest = parseManifest(metadata);
    if (!manifest.author) throw new Error("its metadata has no `author`");
    // Saving drops it silently, so say so here: the icon is `iconUrl`, picked in the icon browser.
    if (/^\s*"?icon"?\s*:/m.test(metadata)) throw new Error("its metadata has an `icon`; use `iconUrl` instead");
    if (script === null) throw new Error("it has no widget.js");
    validateCode(script, read(path.join(dir, "widget.html")));
    if (read(path.join(dir, "README.md")) === null) throw new Error("it has no README.md");

    for (const shot of manifest.screenshots) {
      const full = path.join(dir, shot.file);
      if (!fs.existsSync(full)) throw new Error(`its metadata names the screenshot ${shot.file}, which isn't there`);
      if (fs.statSync(full).size > SCREENSHOT_MAX_BYTES)
        throw new Error(`${shot.file} is larger than ${SCREENSHOT_MAX_BYTES / 1048576} MB`);
    }

    // The labels, which Thingport reads itself rather than from the script: a language its metadata names but
    // whose file is missing or malformed would quietly not install, so it fails here instead.
    let labels = 0;
    const english: Record<string, string> | null = manifest.locales.includes("en")
      ? (JSON.parse(read(path.join(dir, localeFile("en"))) ?? "null") as Record<string, string> | null)
      : null;
    for (const code of manifest.locales) {
      const file = localeFile(code);
      const text = read(path.join(dir, file));
      if (text === null) throw new Error(`its metadata names the ${code} labels, and ${file} isn't there`);
      const size = Buffer.byteLength(text);
      if (size > LOCALE_MAX_BYTES) throw new Error(`${file} is larger than ${LOCALE_MAX_BYTES / 1024} KB`);
      labels += size;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(`${file} isn't valid JSON: ${err instanceof Error ? err.message : err}`, { cause: err });
      }
      const words = validateLocale(code, parsed);
      // English is the fallback, so a key only another language has can never be reached.
      if (english && code !== "en") {
        const stray = Object.keys(words).filter((key) => !(key in english));
        if (stray.length)
          throw new Error(`${file} has ${stray.length} label(s) English hasn't, starting with ${stray[0]}`);
      }
    }
    if (manifest.locales.length && !manifest.locales.includes("en"))
      throw new Error("it has labels but no English ones, which is what every other language falls back to");
    if (labels > LOCALES_MAX_BYTES) throw new Error(`its labels are larger than ${LOCALES_MAX_BYTES / 1024} KB`);
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
