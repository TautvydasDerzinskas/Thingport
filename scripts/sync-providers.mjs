// Copies providers/ into the backend, frontend and extension, each of which builds on its own (their own Docker
// contexts and lockfiles), and writes the index that lists them. Each copy goes beside the package's own code for that
// provider, named <file>.generated.ts (src/providers/<id>/manifest.generated.ts, src/providers/_lib/,
// src/providers/index.generated.ts), and only *.generated.* files are ever written or removed there. It writes the docs
// from the manifests and each <id>/docs.ts too: the logos in docs/assets/providers/, the list and table between the
// providers: markers in docs/PROVIDER_SETUP.md, and the website's provider pages (web/src/lib/providers.generated.mjs).
// All of it is committed:
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
const TARGETS = ["backend/src/providers", "frontend/src/providers", "extension/src/providers"];
const GENERATED = /\.generated\.[a-z]+$/;
// Grab's manifest.json lists these sites; any change makes browsers disable it until each user approves the update.
const BUILTIN_SITES = ["makerworld", "printables", "thingiverse"];
// What each provider's folder holds, copied as they are. Its docs.ts is read here only.
const PROVIDER_FILES = ["manifest.ts", "urls.ts"];
const DOCS_LOGOS = "docs/assets/providers";
const SETUP_PAGE = "docs/PROVIDER_SETUP.md";
const WEB_DOCS = "web/src/lib/providers.generated.mjs";

/** `file.ts` as its copy is named. */
const generatedName = (file) => file.replace(/\.ts$/, ".generated.ts");

/** A copied file's relative imports, which are all of other copies, by their copies' names. */
const pointAtCopies = (text) => text.replace(/(from\s+"\.{1,2}\/[^"]+?)(")/g, "$1.generated$2");

const header = (from) =>
  `// GENERATED from ${from} by scripts/sync-providers.mjs. Don't edit it here:\n` +
  `// change providers/ and run npm run providers:sync.\n`;

async function loadManifests() {
  const ids = readdirSync(SOURCE, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name);
  const manifests = [];
  for (const id of ids) {
    for (const required of [...PROVIDER_FILES, "docs.ts"]) {
      if (!existsSync(path.join(SOURCE, id, required))) throw new Error(`providers/${id} has no ${required}`);
    }
    const file = path.join(SOURCE, id, "manifest.ts");
    const manifest = (await import(pathToFileURL(file).href)).default;
    if (manifest.id !== id) throw new Error(`providers/${id}/manifest.ts says its id is "${manifest.id}"`);
    manifest.docs = (await import(pathToFileURL(path.join(SOURCE, id, "docs.ts")).href)).default;
    manifests.push(manifest);
  }
  manifests.sort((a, b) => a.order - b.order);
  const orders = manifests.map((manifest) => manifest.order);
  if (new Set(orders).size !== orders.length) throw new Error(`Two providers share an order: ${orders.join(", ")}`);
  const builtin = manifests.filter((manifest) => manifest.extension.site === "builtin").map((manifest) => manifest.id);
  if (builtin.toSorted().join() !== BUILTIN_SITES.toSorted().join()) {
    throw new Error(`Only ${BUILTIN_SITES.join(", ")} may be built-in Grab sites; new ones are "optional"`);
  }
  const cookies = manifests.filter((m) => m.extension.cookies && m.extension.site !== "builtin").map((m) => m.id);
  if (cookies.length) throw new Error(`Only built-in sites take cookies in the manifest, not ${cookies.join(", ")}`);
  const ranks = manifests.flatMap((manifest) =>
    manifest.capabilities.trending ? [manifest.capabilities.trending.rank] : [],
  );
  if (new Set(ranks).size !== ranks.length) throw new Error(`Two providers share a trending rank: ${ranks.join(", ")}`);
  return manifests;
}

function index(manifests) {
  const ids = manifests.map((manifest) => manifest.id);
  const trending = manifests
    .filter((manifest) => manifest.capabilities.trending)
    .sort((a, b) => a.capabilities.trending.rank - b.capabilities.trending.rank)
    .map((manifest) => manifest.id);
  return `${header("providers/*/")}
import { hostIs } from "./_lib/hosts.generated";
import type { ListLink, ModelLink, ProviderManifest, ProviderUrls } from "./_lib/types.generated";
${ids.map((id) => `import ${id} from "./${id}/manifest.generated";\nimport { urls as ${id}Urls } from "./${id}/urls.generated";`).join("\n")}

export type {
  AuthField,
  AuthSlot,
  LegacyIdsField,
  ListKind,
  ListLink,
  Logo,
  ModelLink,
  Need,
  ProviderManifest,
  ProviderUrls,
  SignIn,
} from "./_lib/types.generated";
export { hostIs } from "./_lib/hosts.generated";
export { LIKES_ID_PREFIX } from "./_lib/lists.generated";

/** Every provider, in the order lists show them. */
export const PROVIDER_IDS = [${ids.map((id) => JSON.stringify(id)).join(", ")}] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const MANIFESTS = { ${ids.join(", ")} } as const;

/** The providers with a list for the dashboard's trending panel, in the panel's order. */
export const TRENDING_PROVIDER_IDS = [${trending.map((id) => JSON.stringify(id)).join(", ")}] as const;
export type TrendingProviderId = (typeof TRENDING_PROVIDER_IDS)[number];

export const URLS: { readonly [K in ProviderId]: ProviderUrls } = { ${ids.map((id) => `${id}: ${id}Urls`).join(", ")} };

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && Object.hasOwn(MANIFESTS, value);
}

/** A provider's manifest as the type says any can be, for the fields only some have. */
export function manifestOf(id: ProviderId): ProviderManifest {
  return MANIFESTS[id];
}

/** The provider whose site \`hostname\` is, subdomains included; null for any other site. */
export function providerOfHost(hostname: string): ProviderId | null {
  return PROVIDER_IDS.find((id) => MANIFESTS[id].hosts.some((domain) => hostIs(hostname, domain))) ?? null;
}

/** The provider whose links a URL's host is, as its parsers read them (narrower than providerOfHost: Snapmaker's
 *  are on space.snapmaker.com only); null for any other site or no URL. */
export function detectProvider(url: string): ProviderId | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  return PROVIDER_IDS.find((id) => URLS[id].isHost(hostname)) ?? null;
}

/** The model a link is the page of, on whichever provider. */
export function parseModelUrl(url: string): (ModelLink & { provider: ProviderId }) | null {
  const provider = detectProvider(url);
  const model = provider && URLS[provider].parseModel(url);
  return model ? { provider: provider!, ...model } : null;
}

/** The list (collection, likes, bookmarks) a link is the page of, on whichever provider. */
export function parseListUrl(url: string): (ListLink & { provider: ProviderId }) | null {
  const provider = detectProvider(url);
  const list = provider && URLS[provider].parseList(url);
  return list ? { provider: provider!, ...list } : null;
}

/** A model's page; null for a provider there's no manifest for. */
export function modelUrl(provider: string, externalId: string): string | null {
  return isProviderId(provider) ? URLS[provider].modelUrl(externalId) : null;
}
`;
}

/** Its logo on the white tile the docs show every provider's on. */
function docsLogo({ logo }) {
  const [x, y, w, h] = (logo.viewBox ?? "0 0 24 24").split(/\s+/).map(Number);
  const round = (value) => Number(value.toFixed(4));
  const pad = Math.max(w, h) * 0.22;
  const size = round(Math.max(w, h) * 1.44);
  const [left, top] = [round(x - pad), round(y - pad)];
  // A black-and-white mark is drawn near-black, as the tile is white in both themes.
  const fill = (color) => (color === "currentColor" ? "#111111" : color);
  const paths = [
    `<path d="${logo.path}" fill="${fill(logo.color)}"${logo.fillRule ? ` fill-rule="${logo.fillRule}"` : ""}/>`,
    ...(logo.layers ?? []).map(
      (layer) =>
        `<path d="${layer.d}" fill="${layer.color}"${layer.fillRule ? ` fill-rule="${layer.fillRule}"` : ""}/>`,
    ),
  ];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="${left} ${top} ${size} ${size}">` +
    `<rect x="${left}" y="${top}" width="${size}" height="${size}" rx="${round(size * 0.24)}" fill="#ffffff" ` +
    `stroke="#00000014" stroke-width="${round(size * 0.02)}"/>${paths.join("")}</svg>\n`
  );
}

const SUPERSCRIPTS = "¹²³⁴⁵⁶⁷⁸⁹";
const NEEDS = { required: "**Required**", recommended: "Recommended", optional: "Optional", none: "" };
const GENERATED_NOTE = "<!-- Written by scripts/sync-providers.mjs from providers/: change it there. -->";

/** The providers page's list and comparison table, between its markers. */
function setupPage(manifests, current) {
  const icon = ({ docsSlug }) =>
    `<img src="assets/providers/${docsSlug}.svg" alt="" width="18" height="18" align="absmiddle">`;
  const link = (m) => `${icon(m)} [${m.name}](providers/${m.docsSlug}.md)`;
  const list = manifests.map((m) => `- ${link(m)} -- ${m.docs.summary}`);
  const notes = manifests.filter((m) => m.docs.note).map((m) => m.docs.note);
  const mark = (m, column, text) => {
    const index = notes.indexOf(m.docs.note);
    return text && m.docs.note?.on.includes(column) ? `${text}${SUPERSCRIPTS[index]}` : text;
  };
  const tick = (on) => (on ? "✓" : "");
  const rows = manifests.map((m) => {
    const { capabilities: c, helpers } = m;
    const cells = [
      link(m),
      m.docs.signIn,
      mark(m, "grab", NEEDS[helpers.grab]),
      NEEDS[helpers.flaresolverr],
      c.collections ? (m.docs.collections ?? "✓") : "",
      mark(m, "likes", tick(c.likes)),
      tick(c.collections || c.likes),
      tick(c.profiles),
    ];
    return `| ${cells.join(" | ")} |`;
  });
  const table = [
    "| Provider | Sign-in | Thingport Grab | FlareSolverr | Collections | Likes | Sync | Print profiles |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    ...notes.map((note, i) => `${i + 1}. ${note.text}`),
  ];
  const fill = (text, name, lines) => {
    const open = `<!-- providers:${name} -->`;
    const close = `<!-- /providers:${name} -->`;
    const start = text.indexOf(open);
    const end = text.indexOf(close);
    if (start === -1 || end === -1) throw new Error(`${SETUP_PAGE} has no ${open} ... ${close}`);
    return `${text.slice(0, start + open.length)}\n${GENERATED_NOTE}\n\n${lines.join("\n")}\n\n${text.slice(end)}`;
  };
  return fill(fill(current, "list", list), "table", table);
}

/** The website's page for each provider, in docs/providers/. */
function webDocs(manifests) {
  const pages = manifests.map((m) => ({
    slug: `providers/${m.docsSlug}`,
    source: `docs/providers/${m.docsSlug}.md`,
    group: "Providers",
    title: m.name,
    nav: m.name,
    description: m.docs.description,
  }));
  return `${header("providers/*/")}
/** The providers' pages, in the order lists show them. */
export const PROVIDER_DOCS = ${JSON.stringify(pages, null, 2)};
`;
}

/** The docs files the generator owns, by path from the repository's root. */
async function docsOutputs(manifests) {
  const files = new Map();
  for (const m of manifests) files.set(`${DOCS_LOGOS}/${m.docsSlug}.svg`, docsLogo(m.brand));
  files.set(SETUP_PAGE, setupPage(manifests, readFileSync(path.join(ROOT, SETUP_PAGE), "utf8")));
  files.set(WEB_DOCS, webDocs(manifests));
  const config = await prettier.resolveConfig(path.join(ROOT, "package.json"));
  for (const file of [SETUP_PAGE, WEB_DOCS]) {
    files.set(file, await prettier.format(files.get(file), { ...config, filepath: file }));
  }
  return files;
}

/** Every file a target should hold, by path relative to it. */
async function outputs(manifests) {
  const files = new Map();
  for (const file of readdirSync(path.join(SOURCE, "_lib")).filter((file) => file.endsWith(".ts"))) {
    const text = readFileSync(path.join(SOURCE, "_lib", file), "utf8");
    files.set(`_lib/${generatedName(file)}`, header(`providers/_lib/${file}`) + pointAtCopies(text));
  }
  for (const { id } of manifests) {
    for (const file of PROVIDER_FILES) {
      const from = `providers/${id}/${file}`;
      files.set(
        `${id}/${generatedName(file)}`,
        header(from) + pointAtCopies(readFileSync(path.join(ROOT, from), "utf8")),
      );
    }
  }
  files.set("index.generated.ts", index(manifests));
  const config = await prettier.resolveConfig(path.join(ROOT, "package.json"));
  for (const [file, text] of files) files.set(file, await prettier.format(text, { ...config, filepath: file }));
  return files;
}

/** The generated files a target holds, beside the package's own. */
function listGenerated(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listGenerated(path.join(dir, entry.name), `${prefix}${entry.name}/`)
      : GENERATED.test(entry.name)
        ? [`${prefix}${entry.name}`]
        : [],
  );
}

const check = process.argv.includes("--check");
const manifests = await loadManifests();
const files = await outputs(manifests);
const stale = [];
const docs = await docsOutputs(manifests);
for (const file of readdirSync(path.join(ROOT, DOCS_LOGOS))) {
  if (docs.has(`${DOCS_LOGOS}/${file}`)) continue;
  stale.push(`${DOCS_LOGOS}/${file}`);
  if (!check) rmSync(path.join(ROOT, DOCS_LOGOS, file));
}
for (const [file, text] of docs) {
  const out = path.join(ROOT, file);
  if (existsSync(out) && readFileSync(out, "utf8") === text) continue;
  stale.push(file);
  if (!check) writeFileSync(out, text);
}
for (const target of TARGETS) {
  const dir = path.join(ROOT, target);
  for (const file of listGenerated(dir)) {
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
