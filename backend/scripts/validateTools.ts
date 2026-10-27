// Checks tools/ the way Thingport reads it when an admin installs a tool: every slug in index.json has a folder with
// valid metadata naming its author, a script with a default export and a README, every model file its metadata names
// and screenshot is there, every language its metadata names has labels that read, and every folder is listed.
// Run with: npx tsx scripts/validateTools.ts [path to tools]

import fs from "node:fs";
import path from "node:path";
import {
  SLUG,
  TOOL_FILE_MAX_BYTES,
  TOOL_FILES_MAX_BYTES,
  TOOL_LOCALE_MAX_BYTES,
  TOOL_LOCALES_MAX_BYTES,
  TOOL_SCREENSHOT_MAX_BYTES,
  parseToolManifest,
  toolLocaleFile,
  toolModelFiles,
  validateCode,
  validateToolLocale,
} from "../src/services/toolFormat";

const root = path.resolve(process.argv[2] ?? path.join(__dirname, "../../tools"));
const problems: string[] = [];
const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

let slugs: unknown[] = [];
try {
  const index = JSON.parse(read(path.join(root, "index.json")) ?? "{}") as { tools?: unknown };
  if (Array.isArray(index.tools)) slugs = index.tools;
  else problems.push("index.json: `tools` isn't a list");
} catch (err) {
  problems.push(`index.json: ${err instanceof Error ? err.message : err}`);
}

if (new Set(slugs).size !== slugs.length) problems.push("index.json lists a tool twice");
for (const slug of slugs) {
  if (typeof slug !== "string" || !SLUG.test(slug)) {
    problems.push(`index.json: ${JSON.stringify(slug)} isn't a tool name (lowercase letters, digits and dashes)`);
    continue;
  }
  const dir = path.join(root, slug);
  const metadata = read(path.join(dir, "tool.json")) ?? read(path.join(dir, "tool.yml"));
  const script = read(path.join(dir, "tool.js"));
  try {
    if (metadata === null) throw new Error("it has no tool.json or tool.yml");
    const manifest = parseToolManifest(metadata);
    if (!manifest.author) throw new Error("its metadata has no `author`");
    if (script === null) throw new Error("it has no tool.js");
    validateCode(script, read(path.join(dir, "tool.html")));
    if (read(path.join(dir, "README.md")) === null) throw new Error("it has no README.md");
    let total = 0;
    for (const file of toolModelFiles(manifest)) {
      const full = path.join(dir, file);
      if (!fs.existsSync(full)) throw new Error(`its metadata names ${file}, which isn't there`);
      const size = fs.statSync(full).size;
      if (size > TOOL_FILE_MAX_BYTES) throw new Error(`${file} is larger than ${TOOL_FILE_MAX_BYTES / 1048576} MB`);
      total += size;
    }
    for (const shot of manifest.screenshots) {
      const full = path.join(dir, shot.file);
      if (!fs.existsSync(full)) throw new Error(`its metadata names the screenshot ${shot.file}, which isn't there`);
      if (fs.statSync(full).size > TOOL_SCREENSHOT_MAX_BYTES)
        throw new Error(`${shot.file} is larger than ${TOOL_SCREENSHOT_MAX_BYTES / 1048576} MB`);
    }
    if (total > TOOL_FILES_MAX_BYTES)
      throw new Error(`its model files are larger than ${TOOL_FILES_MAX_BYTES / 1048576} MB`);

    // The labels, which Thingport reads itself rather than from the script: a language its metadata names but
    // whose file is missing or malformed would quietly not install, so it fails here instead.
    let labels = 0;
    const english: Record<string, string> | null = manifest.locales.includes("en")
      ? JSON.parse(read(path.join(dir, toolLocaleFile("en"))) ?? "null")
      : null;
    for (const code of manifest.locales) {
      const file = toolLocaleFile(code);
      const text = read(path.join(dir, file));
      if (text === null) throw new Error(`its metadata names the ${code} labels, and ${file} isn't there`);
      const size = Buffer.byteLength(text);
      if (size > TOOL_LOCALE_MAX_BYTES) throw new Error(`${file} is larger than ${TOOL_LOCALE_MAX_BYTES / 1024} KB`);
      labels += size;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(`${file} isn't valid JSON: ${err instanceof Error ? err.message : err}`, { cause: err });
      }
      const words = validateToolLocale(code, parsed);
      // English is the fallback, so a key only another language has can never be reached.
      if (english && code !== "en") {
        const stray = Object.keys(words).filter((key) => !(key in english));
        if (stray.length)
          throw new Error(`${file} has ${stray.length} label(s) English hasn't, starting with ${stray[0]}`);
      }
    }
    if (manifest.locales.length && !manifest.locales.includes("en"))
      throw new Error("it has labels but no English ones, which is what every other language falls back to");
    if (labels > TOOL_LOCALES_MAX_BYTES)
      throw new Error(`its labels are larger than ${TOOL_LOCALES_MAX_BYTES / 1024} KB`);
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
console.log(`✓ ${slugs.length} tool${slugs.length === 1 ? "" : "s"} valid`);
