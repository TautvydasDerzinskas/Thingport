// Copies providers/ into the backend, frontend and extension, each of which builds on its own (their own Docker
// contexts and lockfiles), and writes the index that lists them. The copies are committed:
//
//   npm run providers:sync    rewrite them
//   npm run providers:check   fail when one is out of date (CI)
//
// Manifests import only types, so Node's own type stripping loads them; nothing needs compiling.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as prettier from "prettier";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "providers");
const TARGETS = [
  "backend/src/providers/_generated",
  "frontend/src/providers/_generated",
  "extension/src/shared/providers/_generated",
];
// Grab's manifest.json lists these sites; any change makes browsers disable it until each user approves the update.
const BUILTIN_SITES = ["makerworld", "printables", "thingiverse"];

const header = (from) =>
  `// GENERATED from ${from} by scripts/sync-providers.mjs. Don't edit it here:\n` +
  `// change providers/ and run npm run providers:sync.\n`;

async function loadManifests() {
  const ids = readdirSync(SOURCE, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name);
  const manifests = [];
  for (const id of ids) {
    const file = path.join(SOURCE, id, "manifest.ts");
    if (!existsSync(file)) throw new Error(`providers/${id} has no manifest.ts`);
    const manifest = (await import(pathToFileURL(file).href)).default;
    if (manifest.id !== id) throw new Error(`providers/${id}/manifest.ts says its id is "${manifest.id}"`);
    manifests.push(manifest);
  }
  manifests.sort((a, b) => a.order - b.order);
  const orders = manifests.map((manifest) => manifest.order);
  if (new Set(orders).size !== orders.length) throw new Error(`Two providers share an order: ${orders.join(", ")}`);
  const builtin = manifests.filter((manifest) => manifest.extension.site === "builtin").map((manifest) => manifest.id);
  if (builtin.toSorted().join() !== BUILTIN_SITES.toSorted().join()) {
    throw new Error(`Only ${BUILTIN_SITES.join(", ")} may be built-in Grab sites; new ones are "optional"`);
  }
  return manifests;
}

function index(manifests) {
  const ids = manifests.map((manifest) => manifest.id);
  const name = (id) => (/^[a-z_$][\w$]*$/i.test(id) ? id : JSON.stringify(id));
  return `${header("providers/*/manifest.ts")}
import { hostIs } from "./_lib/hosts";
${ids.map((id) => `import ${name(id)} from "./${id}/manifest";`).join("\n")}

export type { Chip, Logo, Need, ProviderManifest, SignIn } from "./_lib/types";
export { hostIs } from "./_lib/hosts";

/** Every provider, in the order lists show them. */
export const PROVIDER_IDS = [${ids.map((id) => JSON.stringify(id)).join(", ")}] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const MANIFESTS = { ${ids.map(name).join(", ")} } as const;

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && Object.hasOwn(MANIFESTS, value);
}

/** The provider whose site \`hostname\` is, subdomains included; null for any other site. */
export function providerOfHost(hostname: string): ProviderId | null {
  return PROVIDER_IDS.find((id) => MANIFESTS[id].hosts.some((domain) => hostIs(hostname, domain))) ?? null;
}
`;
}

/** Every file a target should hold, by path relative to it. */
async function outputs(manifests) {
  const files = new Map();
  for (const file of readdirSync(path.join(SOURCE, "_lib")).filter((file) => file.endsWith(".ts"))) {
    files.set(`_lib/${file}`, header(`providers/_lib/${file}`) + readFileSync(path.join(SOURCE, "_lib", file), "utf8"));
  }
  for (const { id } of manifests) {
    const from = `providers/${id}/manifest.ts`;
    files.set(`${id}/manifest.ts`, header(from) + readFileSync(path.join(ROOT, from), "utf8"));
  }
  files.set("index.ts", index(manifests));
  const config = await prettier.resolveConfig(path.join(ROOT, "package.json"));
  for (const [file, text] of files) files.set(file, await prettier.format(text, { ...config, filepath: file }));
  return files;
}

function listFiles(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
  );
}

const check = process.argv.includes("--check");
const files = await outputs(await loadManifests());
const stale = [];
for (const target of TARGETS) {
  const dir = path.join(ROOT, target);
  for (const file of listFiles(dir)) {
    if (files.has(file)) continue;
    stale.push(`${target}/${file}`);
    if (!check) rmSync(path.join(dir, file));
  }
  for (const [file, text] of files) {
    const out = path.join(dir, file);
    if (existsSync(out) && readFileSync(out, "utf8") === text) continue;
    stale.push(`${target}/${file}`);
    if (!check) {
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, text);
    }
  }
}
if (check && stale.length) {
  console.error(`Out of date with providers/ (run npm run providers:sync):\n  ${stale.join("\n  ")}`);
  process.exit(1);
}
if (!check) console.log(stale.length ? `Updated:\n  ${stale.join("\n  ")}` : "Up to date.");
